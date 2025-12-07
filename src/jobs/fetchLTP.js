const db = require('../db');
const { getLTPBatch } = require('../clients/angelClient');
const logger = require('../logger');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BATCH_SIZE = parseInt(process.env.LTP_BATCH_SIZE || '50', 10);
const BATCH_DELAY_MS = parseInt(process.env.LTP_BATCH_DELAY_MS || '1000', 10);

async function run() {
  try {
    logger.info('Fetching watchlist items from DB...');
    const res = await db.query('SELECT id, symbol, exchange, instrument_token FROM watchlist_item');
    const items = res.rows;
    if (!items.length) return logger.info('No watchlist items found.');

    // prefer instrument_token if available, else symbol map
    const tokens = items.map(i => i.instrument_token).filter(Boolean);

    if (tokens.length === 0) {
      logger.warn('No instrument tokens available; cannot fetch LTP in batch.');
      return;
    }

    // Group by exchange
    const exchangeMap = {};
    items.forEach(item => {
      if (item.exchange && item.instrument_token) {
        if (!exchangeMap[item.exchange]) exchangeMap[item.exchange] = [];
        exchangeMap[item.exchange].push(String(item.instrument_token));
      }
    });

    if (Object.keys(exchangeMap).length === 0) {
      logger.warn('No valid items with exchange and token found.');
      return;
    }

    logger.info(`Fetching LTP for exchanges: ${Object.keys(exchangeMap).join(', ')}`);

    // Process each exchange separately to handle batching if needed
    // Angel One API might support multiple exchanges in one call, but let's be safe.
    // Actually getLTPBatch usually takes { "NSE": ["123", "456"], "BSE": [...] }

    // We need to chunk tokens if > 50 per exchange? 
    // The documentation says "upto 50 tokens". 
    // So we must split exchangeMap if any array > 50.

    const chunkedRequests = [];

    for (const [exch, tokens] of Object.entries(exchangeMap)) {
      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const chunk = tokens.slice(i, i + BATCH_SIZE);
        chunkedRequests.push({ [exch]: chunk });
      }
    }

    logger.info(`Split into ${chunkedRequests.length} batch requests`);

    for (const reqBody of chunkedRequests) {
      try {
        const resp = await getLTPBatch(reqBody);

        let fetchedList = [];
        if (resp.data && resp.data.fetched) {
          fetchedList = resp.data.fetched;
        } else if (resp.fetched) {
          fetchedList = resp.fetched;
        } else {
          logger.warn('Unexpected response structure:', { resp: JSON.stringify(resp) });
        }

        for (const r of fetchedList) {
          const token = r.symbolToken || r.instrumentToken;
          const ltp = r.ltp || r.lastPrice;
          if (!token || ltp == null) continue;

          // find symbol from token. Caution: token in DB is string/bigint.
          const item = items.find(it => String(it.instrument_token) === String(token));
          const symbol = item?.symbol || token;

          await db.query(
            `INSERT INTO ltp_history(symbol, exchange, date, ltp, fetched_at) VALUES($1,$2,current_date,$3,now())
                   ON CONFLICT (symbol, date) DO UPDATE SET ltp = EXCLUDED.ltp, fetched_at = now()`,
            [symbol, item?.exchange || null, ltp]
          );
        }

        await sleep(BATCH_DELAY_MS);
      } catch (err) {
        logger.error('Error processing batch:', { error: err.message, req: JSON.stringify(reqBody) });
        // Continue to next batch
      }
    }

    // prune older than 10 days
    await db.query(`DELETE FROM ltp_history WHERE date < current_date - interval '10 days'`);
    logger.info('LTP fetch complete.');
  } catch (err) {
    logger.error('Failed to fetch LTPs:', { error: err.message });
    throw err;
  }
}

if (require.main === module) {
  run().catch(err => process.exit(1));
}

module.exports = run;
