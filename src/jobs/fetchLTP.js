const db = require('../db');
const { getLTPBatch } = require('../clients/angelClient');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BATCH_SIZE = parseInt(process.env.LTP_BATCH_SIZE || '50', 10);
const BATCH_DELAY_MS = parseInt(process.env.LTP_BATCH_DELAY_MS || '1000', 10);

async function run() {
  try {
    console.log('Fetching watchlist items from DB...');
    const res = await db.query('SELECT id, symbol, exchange, instrument_token FROM watchlist_item');
    const items = res.rows;
    if (!items.length) return console.log('No watchlist items found.');

    // prefer instrument_token if available, else symbol map
    const tokens = items.map(i => i.instrument_token).filter(Boolean);

    if (tokens.length === 0) {
      console.log('No instrument tokens available; cannot fetch LTP in batch.');
      return;
    }

    // chunk tokens into batches to avoid hitting rate limits when many symbols exist
    // But now we need to group by exchange.
    // Simple approach: Process all at once if < 50, else logic gets complex. 
    // Assuming reasonable watchlist size for now.
    
    const exchangeMap = {};
    items.forEach(item => {
        if (item.exchange && item.instrument_token) {
            if (!exchangeMap[item.exchange]) exchangeMap[item.exchange] = [];
            exchangeMap[item.exchange].push(String(item.instrument_token));
        }
    });

    if (Object.keys(exchangeMap).length === 0) {
        console.log('No valid items with exchange and token found.');
        return;
    }

    console.log(`Fetching LTP for exchanges: ${Object.keys(exchangeMap).join(', ')}`);
    const resp = await getLTPBatch(exchangeMap);
    // console.log('DEBUG: API Response:', JSON.stringify(resp).substring(0, 200));

    // resp handling
    // The API returns { status: true, data: { fetched: [...], ... } } OR directly data?
    // The SDK wrapper returns response.data usually.
    // Let's assume resp is the full response object or data object.
    
    let fetchedList = [];
    if (resp.data && resp.data.fetched) {
        fetchedList = resp.data.fetched;
    } else if (resp.fetched) {
        fetchedList = resp.fetched;
    } else {
        // Fallback if it returns array directly (unlikely for this endpoint)
        // or if structure is nested differently.
        console.log('Unexpected response structure:', JSON.stringify(resp));
    }

    for (const r of fetchedList) {
        const token = r.symbolToken || r.instrumentToken;
        const ltp = r.ltp || r.lastPrice;
        if (!token || ltp == null) continue;

        // find symbol from token. Caution: token in DB is string/bigint.
        // item.instrument_token match
        const item = items.find(it => String(it.instrument_token) === String(token));
        const symbol = item?.symbol || token;

        await db.query(
          `INSERT INTO ltp_history(symbol, exchange, date, ltp) VALUES($1,$2,current_date,$3)
           ON CONFLICT (symbol, date) DO UPDATE SET ltp = EXCLUDED.ltp, fetched_at = now()`,
          [symbol, item?.exchange || null, ltp]
        );
    }

    await sleep(BATCH_DELAY_MS);


    // prune older than 10 days
    await db.query(`DELETE FROM ltp_history WHERE date < current_date - interval '10 days'`);
    console.log('LTP fetch complete.');
  } catch (err) {
    console.error('Failed to fetch LTPs:', err.message || err);
    throw err;
  }
}

if (require.main === module) {
  run().catch(err => process.exit(1));
}

module.exports = run;
