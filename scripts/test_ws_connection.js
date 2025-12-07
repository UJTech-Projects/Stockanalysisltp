const WebSocketManager = require('../src/ws/wsClient');
const logger = require('../src/logger');

async function test() {
    logger.info('Starting WebSocket connection test...');
    const ws = new WebSocketManager();

    // Mock DB query for token if needed, or rely on real DB
    // Assuming DB is accessible and has tokens

    const connected = await ws.start();
    if (!connected) {
        logger.error('Failed to connect.');
        process.exit(1);
    }

    logger.info('Connected! Waiting for 10 seconds to receive ticks...');

    // Subscribe to a common token (e.g., SBIN-NSE or similar if known, or just wait for heartbeat)
    // We need a valid token to subscribe.
    // Let's try to subscribe to a dummy token if we can't find one, or just rely on connection success.

    setTimeout(() => {
        logger.info('Test complete. Disconnecting...');
        ws.disconnect();
        process.exit(0);
    }, 10000);
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
