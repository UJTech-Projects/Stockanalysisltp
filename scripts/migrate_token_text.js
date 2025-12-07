const db = require('../src/db');

async function migrate() {
    try {
        console.log('Migrating watchlist_item.instrument_token to TEXT...');
        await db.query('ALTER TABLE watchlist_item ALTER COLUMN instrument_token TYPE text');
        console.log('Migration successful.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
