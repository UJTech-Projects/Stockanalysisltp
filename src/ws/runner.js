require('dotenv').config();
const WebSocketManager = require('./wsClient');
const db = require('../db');

async function run() {
  try {
    const manager = new WebSocketManager();
    const connected = await manager.start();

    if (!connected) {
      console.warn('WebSocket failed to connect initially, but will keep retrying...');
    }

    // Fetch instrument tokens from watchlist and subscribe
    const res = await db.query('SELECT DISTINCT instrument_token FROM watchlist_item WHERE instrument_token IS NOT NULL');
    const tokens = res.rows.map(r => String(r.instrument_token)).filter(Boolean);
    if (tokens.length === 0) {
      console.log('No instrument tokens found. Use REST fetch or add instrument tokens.');
      // Don't exit, keep running in case tokens are added later
      console.log('WebSocket runner waiting for tokens to be added...');
    } else {
      // subscribe in batches of 100 to avoid overlarge requests
      const BATCH = parseInt(process.env.WS_BATCH_SIZE || '100', 10);
      for (let i = 0; i < tokens.length; i += BATCH) {
        const batch = tokens.slice(i, i + BATCH);
        const subscribed = await manager.subscribeTokens(batch);
        if (!subscribed) {
          console.warn(`Failed to subscribe batch ${i / BATCH + 1}, will retry on next reconnect...`);
        }
      }
    }

    console.log('WebSocket runner started; listening for ticks.');
    
    // Keep the process alive
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down...');
      manager.disconnect();
      process.exit(0);
    });

  } catch (err) {
    console.error('WebSocket runner error:', err.message || err);
    // Don't exit, let it try again
    setTimeout(run, 5000);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message || err);
  console.error('WebSocket runner will restart in 5 seconds...');
  setTimeout(run, 5000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('WebSocket runner will continue running...');
});


if (require.main === module) run();

module.exports = run;
