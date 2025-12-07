const { WebSocketV2 } = (() => {
  try {
    return require('smartapi-javascript');
  } catch (e) {
    return {};
  }
})();
const db = require('../db');
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
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000; // Start with 2 seconds
    this.reconnectTimeout = null;
  }

  async _getAccessToken() {
    try {
      const r = await db.query('SELECT access_token, refresh_token FROM angel_tokens ORDER BY last_refreshed DESC LIMIT 1');
      if (!r.rows[0]) {
        console.warn('WebSocketManager: No tokens in database');
        return { accessToken: null, feedToken: null };
      }
      
      // Try to parse feedToken from refresh_token field (where we stored it)
      // Or just use access token directly
      const accessToken = r.rows[0]?.access_token || null;
      const feedToken = r.rows[0]?.refresh_token || null;
      
      if (!accessToken) {
        console.warn('WebSocketManager: No access token in database');
      }
      return { accessToken, feedToken };
    } catch (err) {
      console.error('WebSocketManager: Error fetching token from DB:', err.message || err);
      return { accessToken: null, feedToken: null };
    }
  }

  async start() {
    try {
      const { accessToken, feedToken } = await this._getAccessToken();
      if (!accessToken) {
        console.warn('No access token available; run token refresh first');
        return false;
      }

      if (!WebSocketV2) {
        throw new Error('SmartAPI WebSocket SDK not available. Install `smartapi-javascript`.');
      }

      // Try feedToken first, fallback to accessToken
      const tokenToUse = feedToken || accessToken;
      console.log('WebSocket connecting with token:', tokenToUse?.substring(0, 50) + '...');
      
      this.ws = new WebSocketV2({ jwttoken: tokenToUse, apikey: this.apikey, clientcode: this.clientcode, feedtype: this.feedtype });
      
      // Set up error handler BEFORE connecting
      this.ws.on('error', (err) => {
        console.error('WebSocket error event:', err.message || err);
        this.connected = false;
        // Don't reconnect immediately on connection error, let it be handled by connect promise
      });
      
      this.ws.on('close', () => {
        console.log('WebSocket closed.');
        this.connected = false;
        this._scheduleReconnect();
      });

      return this.ws.connect().then(() => {
        this.connected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        this.reconnectDelay = 2000;
        console.log('WebSocket connected.');
        
        // Start flush loop
        if (this.flushInterval) clearInterval(this.flushInterval);
        this.flushInterval = setInterval(() => this._flushBuffer(), 2000);

        this.ws.on('tick', (data) => this._onTick(data));
        
        return true;
      }).catch(err => {
        console.error('WebSocket connect failed:', err.message || err);
        this._scheduleReconnect();
        return false;
      });
    } catch (err) {
      console.error('WebSocket start error:', err.message || err);
      this._scheduleReconnect();
      return false;
    }
  }

  _onError(err) {
    console.error('WebSocket error:', err.message || err);
    this.connected = false;
    this._scheduleReconnect();
  }

  _onClose() {
    console.log('WebSocket closed.');
    this.connected = false;
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    console.log(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      console.log('Attempting to reconnect WebSocket...');
      this.start().catch(err => console.error('Reconnect failed:', err.message || err));
    }, delay);
  }

  disconnect() {
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        console.error('Error closing WebSocket:', err.message || err);
      }
    }
    this.connected = false;
  }

  async subscribeTokens(tokens = []) {
    if (!this.connected) {
      console.warn('WebSocket not connected; cannot subscribe to tokens');
      return false;
    }
    try {
      // Build request as per SDK examples
      const json_req = {
        correlationID: `sub_${Date.now()}`,
        action: 1, // subscribe
        mode: 1,
        exchangeType: 1,
        tokens: tokens.map(String)
      };
      this.ws.fetchData(json_req);
      console.log('Subscribed to', tokens.length, 'tokens');
      return true;
    } catch (err) {
      console.error('Error subscribing to tokens:', err.message || err);
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

        // Resolve symbol if not present by lookup in watchlist_item
        // We can't easily lookup in the tick handler without async, 
        // but we can buffer the token and lookup in flush
        
        // For optimization, we store by token in buffer if symbol missing, 
        // or by symbol if present.
        // Actually, let's just store the raw tick data keyed by token, 
        // and resolve symbol in flush to keep _onTick fast.
        
        this.tickBuffer.set(token, { 
           ltp, 
           exchange: t.exchange || null, 
           symbol,
           token
        });
      }
    } catch (err) {
      console.error('Error handling tick:', err.message || err);
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
    // console.log(`Flushing ${buffer.size} ticks...`);

    for (const [token, data] of buffer.entries()) {
        try {
            let sym = data.symbol;
            
            // Resolve symbol if missing
            if (!sym) {
                // Try cache first? No, simple DB lookup. 
                // Ideally we cache token->symbol mapping too, but let's trust the DB is fast enough for 300 lookups or user provided symbol.
                // Wait, querying DB for symbol in loop is slow.
                // Let's cache token->symbol mappings in memory.
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
            console.error(`Error flushing tick for token ${token}:`, err.message);
        }
    }
  }
}

module.exports = WebSocketManager;
