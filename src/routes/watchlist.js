const express = require('express');
const db = require('../db');
const router = express.Router();
const subManager = require('../ws/manager');
const { getCandleData, generateSessionOrToken } = require('../clients/angelClient');

// Search for stocks by symbol or name
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'search query required' });
  }

  try {
    const searchTerm = `%${q.toUpperCase()}%`;
    const results = await db.query(
      `SELECT token, symbol, name, exch_seg 
       FROM instrument_master 
       WHERE symbol ILIKE $1 OR name ILIKE $1
       ORDER BY 
         CASE WHEN symbol ILIKE $2 THEN 0 ELSE 1 END,
         CASE WHEN exch_seg = 'NSE' THEN 0 ELSE 1 END,
         CASE WHEN symbol LIKE '%-EQ' THEN 0 ELSE 1 END,
         symbol
       LIMIT 20`,
      [searchTerm, q.toUpperCase()]
    );

    res.json({ results: results.rows });
  } catch (err) {
    console.error('Error searching instruments:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

// Add a stock to the default watchlist (create watchlist row if needed)
router.post('/add', async (req, res) => {
  const { symbol, exchange, instrument_token } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    let finalToken = instrument_token;
    let finalExchange = exchange;
    let finalSymbol = symbol;
    let tokenFound = !!instrument_token; // Track if we found a token

    // If token is missing, try to look it up in instrument_master
    if (!finalToken) {
      const lookup = await db.query(
        `SELECT token, symbol, exch_seg, name FROM instrument_master 
             WHERE symbol=$1 OR name=$1 
             ORDER BY 
               CASE WHEN exch_seg = 'NSE' THEN 1 ELSE 2 END,
               CASE WHEN symbol LIKE '%-EQ' THEN 1 ELSE 2 END,
               exch_seg
             LIMIT 1`,
        [symbol]
      );

      if (lookup.rows.length > 0) {
        finalToken = lookup.rows[0].token;
        finalExchange = lookup.rows[0].exch_seg;
        finalSymbol = lookup.rows[0].symbol; // Use the official trading symbol
        tokenFound = true;
      } else {
        // Token not found - we can still add to watchlist, but warn the user
        console.warn(`No instrument found for symbol: ${symbol} - adding to watchlist without token`);
      }
    }

    // ensure default watchlist exists
    const wlRes = await db.query("INSERT INTO watchlist(id, name) VALUES (gen_random_uuid(), 'default') ON CONFLICT DO NOTHING RETURNING id");
    // get default watchlist id
    const wl = await db.query("SELECT id FROM watchlist WHERE name='default' LIMIT 1");
    const watchlistId = wl.rows[0].id;

    await db.query(
      `INSERT INTO watchlist_item(watchlist_id, symbol, exchange, instrument_token) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [watchlistId, finalSymbol, finalExchange || null, finalToken || null]
    );

    // Only attempt to subscribe if we have a valid token AND there's an active WebSocket
    if (finalToken && tokenFound) {
      try {
        await subManager.subscribeOneToken(finalToken);
      } catch (err) {
        console.warn('subscribeOneToken failed:', err.message || err);
      }
    } else if (!finalToken) {
      console.warn(`Skipping subscription for ${symbol} - no instrument token found`);
    }

    // --- On-Demand Backfill (Last 10 Days) ---
    if (finalToken && tokenFound) {
      (async () => {
        try {
          console.log(`Backfilling 10-day history for ${finalSymbol}...`);
          // Ensure valid session (rare race condition if token expired, but worth trying)
          try { await generateSessionOrToken(); } catch (e) { }

          const toDate = new Date();
          const fromDate = new Date(toDate.getTime() - (10 * 24 * 60 * 60 * 1000));

          // Helper to format date for Angel: YYYY-MM-DD HH:MM
          const fmt = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd} 09:00`;
          };

          const data = await getCandleData({
            symbolToken: finalToken,
            exchange: finalExchange || 'NSE',
            interval: 'ONE_DAY',
            fromdate: fmt(fromDate),
            todate: fmt(toDate)
          });

          if (data.status && data.data) {
            for (const candle of data.data) {
              // candle: [timestamp_str, open, high, low, close, vol]
              const dateStr = candle[0].split('T')[0];
              const closePrice = candle[4];
              await db.query(`
                            INSERT INTO ltp_history(symbol, exchange, date, ltp, fetched_at)
                            VALUES($1, $2, $3, $4, now())
                            ON CONFLICT (symbol, date) DO UPDATE SET ltp = EXCLUDED.ltp
                        `, [finalSymbol, finalExchange, dateStr, closePrice]);
            }
            console.log(`Backfilled ${data.data.length} days for ${finalSymbol}`);
          }
        } catch (err) {
          console.error(`Backfill failed for ${finalSymbol}:`, err.message);
        }
      })();
    }
    // -----------------------------------------

    // Return response with warning if token wasn't found
    const response = { ok: true, symbol: finalSymbol, token: finalToken, exchange: finalExchange };
    if (!finalToken) {
      response.warning = `Token not found for ${symbol}. Added to watchlist but cannot receive live updates.`;
    }
    res.json(response);
  } catch (err) {
    console.error('Error adding stock:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/remove', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    await db.query('DELETE FROM watchlist_item WHERE symbol=$1', [symbol]);
    // after removal, re-subscribe from DB to ensure subscriptions reflect the latest watchlist
    subManager.resubscribeFromDB().catch(err => console.warn('resubscribeFromDB failed:', err.message || err));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    const rows = (await db.query('SELECT symbol, exchange, instrument_token, added_at FROM watchlist_item ORDER BY added_at DESC')).rows;
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:symbol', async (req, res) => {
  const { symbol } = req.params;
  try {
    const rows = (await db.query('SELECT date, ltp FROM ltp_history WHERE symbol=$1 ORDER BY date DESC LIMIT 10', [symbol])).rows;
    res.json({ symbol, history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/matrix', async (req, res) => {
  try {
    // 1. Get all distinct dates (columns)
    const datesRes = await db.query('SELECT DISTINCT date FROM ltp_history ORDER BY date DESC LIMIT 30');
    const dates = datesRes.rows.map(r => r.date.toISOString().split('T')[0]);

    // 2. Get all stocks currently in watchlist (rows)
    const stocksRes = await db.query('SELECT symbol FROM watchlist_item ORDER BY symbol ASC');
    const stocks = stocksRes.rows.map(r => r.symbol);

    // 3. Get all price data for these stocks and dates
    const dataRes = await db.query(`
      SELECT symbol, date, ltp 
      FROM ltp_history 
      WHERE date >= $1
    `, [dates[dates.length - 1] || new Date().toISOString()]); // Optimization: filter by oldest date

    // 4. Construct the matrix map
    // Structure: { "TCS-EQ": { "2023-10-01": 3500, "2023-10-02": 3520 } }
    const priceMap = {};
    dataRes.rows.forEach(r => {
      const d = r.date.toISOString().split('T')[0];
      if (!priceMap[r.symbol]) priceMap[r.symbol] = {};
      priceMap[r.symbol][d] = r.ltp;
    });

    // 5. Build final array for frontend
    const matrix = stocks.map(sym => {
      const row = { symbol: sym };
      dates.forEach(d => {
        row[d] = priceMap[sym]?.[d] || '-';
      });
      return row;
    });

    res.json({ dates, matrix });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
