const db = require('../db');
const { getLTPBatch } = require('../clients/angelClient');
const logger = require('../logger');

class PollingClient {
    constructor(options = {}) {
        this.intervalMs = options.interval || 3000; // Poll every 3 seconds
        this.running = false;
        this.timer = null;

        // Tokens to poll: Map<token, { symbol, exchange, token }>
        this.subscribedTokens = new Map();
    }

    async start() {
        if (this.running) return true;
        this.running = true;
        logger.info('PollingClient started.');
        this._pollLoop();
        return true;
    }

    disconnect() {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
        logger.info('PollingClient stopped.');
    }

    getStatus() {
        return {
            running: this.running,
            subscribed_count: this.subscribedTokens.size
        };
    }

    async subscribeTokens(tokens = []) {
        if (!tokens.length) return;

        // We need exchange and symbol for these tokens.
        // Bulk lookup from DB for tokens we don't know yet.
        const missingTokens = tokens.filter(t => !this.subscribedTokens.has(String(t)));
        if (missingTokens.length === 0) return true;

        try {
            const res = await db.query('SELECT instrument_token, symbol, exchange FROM watchlist_item WHERE instrument_token = ANY($1::text[])', [missingTokens.map(String)]);

            for (const row of res.rows) {
                const t = String(row.instrument_token);
                this.subscribedTokens.set(t, {
                    token: t,
                    symbol: row.symbol,
                    exchange: row.exchange
                });
            }
            logger.info(`PollingClient: Subscribed to ${missingTokens.length} new tokens. Total: ${this.subscribedTokens.size}`);
            return true;
        } catch (err) {
            logger.error('PollingClient: Error looking up tokens:', { error: err.message });
            return false;
        }
    }

    async _pollLoop() {
        if (!this.running) return;

        try {
            if (this.subscribedTokens.size > 0) {
                await this._fetchAndSave();
            }
        } catch (err) {
            logger.error('PollingClient: Poll cycle failed:', { error: err.message });
        }

        if (this.running) {
            this.timer = setTimeout(() => this._pollLoop(), this.intervalMs);
        }
    }

    async _fetchAndSave() {
        // Group by exchange
        const exchangeMap = {};
        for (const item of this.subscribedTokens.values()) {
            if (!item.exchange) continue;
            if (!exchangeMap[item.exchange]) exchangeMap[item.exchange] = [];
            exchangeMap[item.exchange].push(item.token);
        }

        if (Object.keys(exchangeMap).length === 0) return;

        // Fetch batch
        // Note: getLTPBatch handles batching internally? No, we implemented batching in fetchLTP.js but not in the client wrapper.
        // The client wrapper `getLTPBatch` takes a map.
        // We should probably implement batching here if list is huge.
        // For now, let's assume < 500 tokens. If > 50, we might need to split.
        // Angel One limit is 50 tokens per request? 
        // "POST /rest/secure/angelbroking/market/v1/quote" -> "exchangeTokens": { "NSE": ["..."] }
        // Documentation says "upto 50".

        // So we MUST split.

        const BATCH_SIZE = 50;
        const requests = [];

        for (const [exch, tokens] of Object.entries(exchangeMap)) {
            for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
                const chunk = tokens.slice(i, i + BATCH_SIZE);
                requests.push({ [exch]: chunk });
            }
        }

        for (const reqMap of requests) {
            try {
                const resp = await getLTPBatch(reqMap);
                // Handle response
                let fetchedList = [];
                if (resp.data && resp.data.fetched) {
                    fetchedList = resp.data.fetched;
                } else if (resp.fetched) {
                    fetchedList = resp.fetched;
                }

                // Save to DB
                for (const r of fetchedList) {
                    const token = r.symbolToken || r.instrumentToken;
                    const ltp = r.ltp || r.lastPrice;
                    if (!token || ltp == null) continue;

                    const item = this.subscribedTokens.get(String(token));
                    if (!item) continue;

                    await db.query(
                        `INSERT INTO ltp_history(symbol, exchange, date, ltp, fetched_at) VALUES($1,$2,current_date,$3,now())
                   ON CONFLICT (symbol, date) DO UPDATE SET ltp = EXCLUDED.ltp, fetched_at = now()`,
                        [item.symbol, item.exchange, ltp]
                    );
                }
            } catch (err) {
                logger.error('PollingClient: Batch fetch failed:', { error: err.message });
            }
        }
    }
}

module.exports = PollingClient;
