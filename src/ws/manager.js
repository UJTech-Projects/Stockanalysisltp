const db = require('../db');
// const WebSocketManager = require('./wsClient'); // Deprecated due to instability
const PollingClient = require('./pollingClient');
const logger = require('../logger');
require('dotenv').config();

// Singleton wrapper around PollingClient (formerly WebSocketManager). Handles lazy start and re-subscribe from DB.
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
      this.manager = new PollingClient({ interval: 7000 }); // Poll every 7s
      const connected = await this.manager.start();
      if (connected) {
        this.started = true;
        logger.info('SubscriptionManager: PollingClient started');
      } else {
        logger.warn('SubscriptionManager: PollingClient failed to start');
      }
    } catch (err) {
      logger.warn('SubscriptionManager: failed to start PollingClient:', { error: err.message });
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
      logger.warn('SubscriptionManager: cannot subscribe because client is not started');
      return false;
    }

    try {
      return await this.manager.subscribeTokens(tokens);
    } catch (err) {
      logger.error('SubscriptionManager: error subscribing tokens:', { error: err.message });
      return false;
    }
  }

  async resubscribeFromDB() {
    try {
      const res = await db.query('SELECT DISTINCT instrument_token FROM watchlist_item WHERE instrument_token IS NOT NULL');
      const tokens = res.rows.map(r => String(r.instrument_token)).filter(Boolean);
      if (tokens.length === 0) {
        logger.info('SubscriptionManager: no tokens to subscribe');
        return false;
      }
      return await this.subscribeTokens(tokens);
    } catch (err) {
      logger.error('SubscriptionManager: error resubscribing from DB:', { error: err.message });
      return false;
    }
  }

  async subscribeOneToken(token) {
    if (!token) return false;
    try {
      return await this.subscribeTokens([String(token)]);
    } catch (err) {
      logger.error('SubscriptionManager: error subscribing to single token:', { error: err.message });
      return false;
    }
  }

  getStatus() {
    if (!this.manager) return { running: false, subscribed_count: 0 };
    return this.manager.getStatus();
  }
}

module.exports = new SubscriptionManager();
