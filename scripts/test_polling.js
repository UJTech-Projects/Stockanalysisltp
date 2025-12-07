const PollingClient = require('../src/ws/pollingClient');
const logger = require('../src/logger');
const db = require('../src/db');

async function test() {
    logger.info('Starting PollingClient test...');

    // Ensure we have at least one item in watchlist to test
    const res = await db.query('SELECT instrument_token FROM watchlist_item LIMIT 1');
    if (res.rows.length === 0) {
        logger.warn('No items in watchlist to test. Please add one first.');
        process.exit(0);
    }

    const client = new PollingClient({ interval: 3000 });
    await client.start();

    const tokens = res.rows.map(r => r.instrument_token);
    logger.info(`Subscribing to tokens: ${tokens.join(', ')}`);

    await client.subscribeTokens(tokens);

    logger.info('Waiting 10 seconds for poll cycles...');

    setTimeout(() => {
        logger.info('Test complete. Disconnecting...');
        client.disconnect();
        process.exit(0);
    }, 10000);
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
