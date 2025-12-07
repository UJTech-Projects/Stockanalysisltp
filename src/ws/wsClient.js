const { WebSocketV2 } = (() => {
  try {
    return require('smartapi-javascript');
  } catch (e) {
    return {};
  }
})();
const db = require('../db');
const logger = require('../logger');
require('dotenv').config();

class WebSocketManager {
  constructor(options = {}) {
    this.clientcode = process.env.ANGEL_CLIENT_CODE;
    this.apikey = process.env.ANGEL_API_KEY;
    this.feedtype = options.feedtype || 'market_feed';
    this.ws = null;
    this.connected = false;

    // Optimization buffers
    this.tickBuffer = new Map(); // key: token, value: tick data
    this.knownToday = new Set(); // set of symbols that have an entry for today
    this.tokenSymbolMap = new Map(); // cache token -> symbol
    this.lastDateStr = '';
    this.flushInterval = null;

    // Reconnection logic
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10; // Increased attempts
    this.reconnectDelay = 2000; // Start with 2 seconds
    this.reconnectTimeout = null;

    // Heartbeat
    this.lastHeartbeat = Date.now();
    this.heartbeatInterval = null;
  }

  async _getAccessToken() {
    try {
      const r = await db.query('SELECT access_token, refresh_token, last_refreshed FROM angel_tokens ORDER BY last_refreshed DESC LIMIT 1');
      if (!r.rows[0]) {
        logger.warn('WebSocketManager: No tokens in database');
        return { accessToken: null, feedToken: null };
      }

      const accessToken = r.rows[0]?.access_token || null;
      const feedToken = r.rows[0]?.refresh_token || null;

      if (!accessToken) {
        logger.warn('WebSocketManager: No access token in database');
      }
      return { accessToken, feedToken };
    } catch (err) {
      logger.error('WebSocketManager: Error fetching token from DB:', { error: err.message });
      return { accessToken: null, feedToken: null };
    }
  }

  async start() {
    try {
      const { accessToken, feedToken } = await this._getAccessToken();
      if (!accessToken) {
        logger.warn('No access token available; run token refresh first');
        return false;
      }

      if (!WebSocketV2) {
        throw new Error('SmartAPI WebSocket SDK not available. Install `smartapi-javascript`.');
      }

      // Try feedToken first, fallback to accessToken
      const tokenToUse = accessToken;
      logger.info('WebSocket connecting...', { tokenPrefix: tokenToUse?.substring(0, 10) });

      this.ws = new WebSocketV2({ jwttoken: tokenToUse, apikey: this.apikey, clientcode: this.clientcode, feedtype: this.feedtype });

      // Set up error handler BEFORE connecting
      this.ws.on('error', (err) => {
        logger.error('WebSocket error event:', { error: err.message || err });
        this.connected = false;
        // Don't reconnect immediately on connection error, let it be handled by connect promise or close event
      });

      this.ws.on('close', () => {
        logger.warn('WebSocket closed.');
        this.connected = false;
        this._scheduleReconnect();
      });

      return this.ws.connect().then(() => {
        this.connected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        this.reconnectDelay = 2000;
        this.lastHeartbeat = Date.now();
        logger.info('WebSocket connected.');

        // Start flush loop
        if (this.flushInterval) clearInterval(this.flushInterval);
        this.flushInterval = setInterval(() => this._flushBuffer(), 2000);

        // Start heartbeat check
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => this._checkHeartbeat(), 10000);

        this.ws.on('tick', (data) => {
          this.lastHeartbeat = Date.now();
          this._onTick(data);
        });

        return true;
      }).catch(err => {
        logger.error('WebSocket connect failed:', { error: err.message || err });
        this._scheduleReconnect();
        return false;
      });
    } catch (err) {
      logger.error('WebSocket start error:', { error: err.message || err });
      this._scheduleReconnect();
      return false;
    }
  }

  _checkHeartbeat() {
    if (!this.connected) return;
    // If no tick for 60 seconds, assume dead
    if (Date.now() - this.lastHeartbeat > 60000) {
      logger.warn('WebSocket heartbeat missing for 60s. Reconnecting...');
      this.disconnect();
      this._scheduleReconnect();
    }
  }

  _onError(err) {
    logger.error('WebSocket error:', { error: err.message || err });
    this.connected = false;
    this._scheduleReconnect();
  }

  _onClose() {
    logger.warn('WebSocket closed.');
    this.connected = false;
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    logger.info(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect WebSocket...');
      this.start().catch(err => logger.error('Reconnect failed:', { error: err.message }));
    }, delay);
  }

  disconnect() {
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        logger.error('Error closing WebSocket:', { error: err.message });
      }
    }
    this.connected = false;
  }

  async subscribeTokens(tokens = []) {
    if (!this.connected) {
      logger.warn('WebSocket not connected; cannot subscribe to tokens');
      return false;
    }
    try {
      // Build request as per SDK examples
      const json_req = {
        correlationID: `sub_${Date.now()}`,
        action: 1, // subscribe
        mode: 1, // LTP mode
        exchangeType: 1, // NSE (mostly) - wait, this assumes all are NSE. 
        // Ideally we should group by exchange type if mixed. 
        // For now, assuming NSE (1) or BSE (3) or NFO (2).
        // The SDK might handle this if we pass tokens correctly? 
        // Actually the `exchangeType` param is top level. 
        // If we have mixed exchanges, we must send separate requests.
        tokens: tokens.map(String)
      };

      // TODO: Handle mixed exchanges properly. 
      // For now, let's assume NSE (1) as default or check if we can infer.
      // But `exchangeType` is required. 

      this.ws.fetchData(json_req);
      logger.info('Subscribed to tokens', { count: tokens.length });
      return true;
    } catch (err) {
      logger.error('Error subscribing to tokens:', { error: err.message });
      return false;
    }
  }

  async _onTick(data) {
    try {
      // data may be a batch or single tick; normalise
      const ticks = Array.isArray(data) ? data : [data];
      for (const t of ticks) {
        // Common shapes: { token / instrumentToken, last_price / ltp }
        const token = t?.token || t?.instrumentToken || t?.instrument_token || t?.symboltoken || t?.tokenid;
        const ltp = t?.last_price || t?.ltp || t?.lastPrice || t?.last_price;
        const symbol = t?.symbol || t?.tradingsymbol || null;

        // If we don't have ltp, we can't update price
        if (!token || ltp == null) continue;

        this.tickBuffer.set(String(token), {
          ltp,
          exchange: t.exchange || null,
          symbol,
          token: String(token)
        });
      }
    } catch (err) {
      logger.error('Error handling tick:', { error: err.message });
    }
  }

  async _flushBuffer() {
    if (this.tickBuffer.size === 0) return;

    // Snapshot and clear buffer
    const buffer = new Map(this.tickBuffer);
    this.tickBuffer.clear();

    // Check for date rollover to clear cache
    const todayStr = new Date().toDateString();
    if (this.lastDateStr !== todayStr) {
      this.knownToday.clear();
      this.lastDateStr = todayStr;
    }

    // Process updates
    // logger.debug(`Flushing ${buffer.size} ticks...`);

    for (const [token, data] of buffer.entries()) {
      try {
        let sym = data.symbol;

        // Resolve symbol if missing
        if (!sym) {
          if (this.tokenSymbolMap.has(token)) {
            sym = this.tokenSymbolMap.get(token);
          } else {
            const r = await db.query('SELECT symbol FROM watchlist_item WHERE instrument_token=$1 LIMIT 1', [token]);
            if (r.rows.length > 0) {
              sym = r.rows[0].symbol;
              this.tokenSymbolMap.set(token, sym);
            } else {
              sym = String(token); // Fallback
            }
          }
        }

        // Now upsert LTP
        if (this.knownToday.has(sym)) {
          // We know the row exists for today, just update
          await db.query('UPDATE ltp_history SET ltp=$1, fetched_at=now() WHERE symbol=$2 AND date=current_date', [data.ltp, sym]);
        } else {
          // Check existence
          const exists = await db.query('SELECT id FROM ltp_history WHERE symbol=$1 AND date=current_date', [sym]);
          if (exists.rows.length) {
            await db.query('UPDATE ltp_history SET ltp=$1, fetched_at=now() WHERE id=$2', [data.ltp, exists.rows[0].id]);
            this.knownToday.add(sym);
          } else {
            await db.query('INSERT INTO ltp_history(symbol, exchange, date, ltp, fetched_at) VALUES($1,$2,current_date,$3,now())', [sym, data.exchange, data.ltp]);
            this.knownToday.add(sym);
          }
        }
      } catch (err) {
        logger.error(`Error flushing tick for token ${token}:`, { error: err.message });
      }
    }
  }
}

module.exports = WebSocketManager;
