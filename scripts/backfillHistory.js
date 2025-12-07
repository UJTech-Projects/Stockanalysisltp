require('dotenv').config();
const db = require('../src/db');
const { getCandleData, generateSessionOrToken } = require('../src/clients/angelClient');
const logger = require('../src/logger');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 90;

async function backfill() {
    logger.info('Starting historical data backfill...');

    // Ensure we have a valid session
    try {
        await generateSessionOrToken({ useRefresh: true });
    } catch (err) {
        logger.error('Failed to get token:', err.message);
        process.exit(1);
    }

    // Get all watchlist items
    const res = await db.query('SELECT symbol, exchange, instrument_token FROM watchlist_item WHERE instrument_token IS NOT NULL');
    const items = res.rows;

    logger.info(`Found ${items.length} items to backfill.`);

    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - (BACKFILL_DAYS * ONE_DAY_MS));

    // Format dates as YYYY-MM-DD HH:MM
    const fmt = (d) => d.toISOString().split('T')[0] + ' 09:15'; // Angel format usually YYYY-MM-DD HH:MM

    // Angel API format requires: "YYYY-MM-DD HH:MM"
    const formatAngelDate = (date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} 09:00`;
    };

    const fromDateStr = formatAngelDate(fromDate);
    const toDateStr = formatAngelDate(toDate);

    for (const item of items) {
        logger.info(`Fetching data for ${item.symbol} (${item.instrument_token})...`);
        try {
            const data = await getCandleData({
                symbolToken: item.instrument_token,
                exchange: item.exchange || 'NSE',
                interval: 'ONE_DAY', // Daily candles
                fromdate: fromDateStr,
                todate: toDateStr
            });

            // Angel response structure: { status: true, data: [ [timestamp, open, high, low, close, volume], ... ] }
            if (data.status && data.data) {
                logger.info(`Received ${data.data.length} candles for ${item.symbol}`);

                for (const candle of data.data) {
                    // candle: [timestamp_str, open, high, low, close, vol]
                    const dateStr = candle[0].split('T')[0]; // Extract just YYYY-MM-DD
                    const closePrice = candle[4];

                    await db.query(`
                        INSERT INTO ltp_history(symbol, exchange, date, ltp, fetched_at)
                        VALUES($1, $2, $3, $4, now())
                        ON CONFLICT (symbol, date) 
                        DO UPDATE SET ltp = EXCLUDED.ltp
                    `, [item.symbol, item.exchange, dateStr, closePrice]);
                }
            } else {
                logger.warn(`No data returned for ${item.symbol}: ${data.message || 'Unknown error'}`);
            }

            // Rate limit civility
            await new Promise(r => setTimeout(r, 500));

        } catch (err) {
            logger.error(`Error backfilling ${item.symbol}:`, err.message);
        }
    }

    logger.info('Backfill complete.');
    process.exit(0);
}

backfill();
