require('dotenv').config();
const db = require('../src/db');

async function checkPrices() {
    const res = await db.query('SELECT symbol, date, ltp, fetched_at FROM ltp_history ORDER BY fetched_at DESC LIMIT 20');
    console.table(res.rows.map(r => ({
        symbol: r.symbol,
        date: r.date.toISOString().split('T')[0],
        ltp: r.ltp, 
        is_recent: (new Date() - r.fetched_at) < 1000 * 60 * 60 // less than an hour ago
    })));
    db.pool.end();
}
checkPrices();
