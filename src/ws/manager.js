const db = require('../db');
const WebSocketManager = require('./wsClient');
require('dotenv').config();

// Singleton wrapper around WebSocketManager. Handles lazy start and re-subscribe from DB.
class SubscriptionManager {
  constructor() {
    this.manager = null;
    this.started = false;
    this.isInitializing = false;
  }

  async init() {
    // Prevent multiple concurrent initialization attempts
    if (this.isInitializing) {
      let attempts = 0;
      while (this.isInitializing && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      return;
    }

    if (this.started) return;
    
    this.isInitializing = true;
    try {
      this.manager = new WebSocketManager();
      const connected = await this.manager.start();
      if (connected) {
        this.started = true;
        console.log('SubscriptionManager: WebSocket started');
      } else {
        console.warn('SubscriptionManager: WebSocket failed to start (will retry on next subscribe attempt)');
      }
    } catch (err) {
      console.warn('SubscriptionManager: failed to start WS:', err.message || err);
    } finally {
      this.isInitializing = false;
    }
  }

  async subscribeTokens(tokens = []) {
    if (!tokens || tokens.length === 0) return false;
    if (!this.started) {
      await this.init();
    }
    if (!this.started) {
      console.warn('SubscriptionManager: cannot subscribe because WS is not started (will retry on next attempt)');
      return false;
    }
    // batch subscribing handled by wsClient.subscribeTokens
    try {
      return await this.manager.subscribeTokens(tokens);
    } catch (err) {
      console.error('SubscriptionManager: error subscribing tokens:', err.message || err);
      return false;
    }
  }

  async resubscribeFromDB() {
    try {
      const res = await db.query('SELECT DISTINCT instrument_token FROM watchlist_item WHERE instrument_token IS NOT NULL');
      const tokens = res.rows.map(r => String(r.instrument_token)).filter(Boolean);
      if (tokens.length === 0) {
        console.log('SubscriptionManager: no tokens to subscribe');
        return false;
      }
      // unsubscribe + resubscribe not available in wsClient; safest is just subscribe all (server will ignore duplicates)
      return await this.subscribeTokens(tokens);
    } catch (err) {
      console.error('SubscriptionManager: error resubscribing from DB:', err.message || err);
      return false;
    }
  }

  async subscribeOneToken(token) {
    if (!token) return false;
    try {
      return await this.subscribeTokens([String(token)]);
    } catch (err) {
      console.error('SubscriptionManager: error subscribing to single token:', err.message || err);
      return false;
    }
  }
}

module.exports = new SubscriptionManager();
