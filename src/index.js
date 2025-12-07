require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const watchlistRouter = require('./routes/watchlist');
const refreshTokenJob = require('./jobs/refreshToken');
const fetchLTPJob = require('./jobs/fetchLTP');
const subManager = require('./ws/manager');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/watchlist', watchlistRouter);

// Job endpoints for cron runners to call
app.post('/jobs/refresh-token', async (req, res) => {
  try {
    await refreshTokenJob();
    res.json({ ok: true });
  } catch (err) {
    console.error('refresh-token job failed:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/fetch-ltp', async (req, res) => {
  try {
    await fetchLTPJob();
    res.json({ ok: true });
  } catch (err) {
    console.error('fetch-ltp job failed:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

// Trigger resubscribe from DB (useful for cron or manual reconciliation)
app.post('/jobs/resubscribe', async (req, res) => {
  try {
    const result = await subManager.resubscribeFromDB();
    res.json({ ok: true, subscribed: result });
  } catch (err) {
    console.error('resubscribe job failed:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const port = process.env.PORT || 5000;
const server = app.listen(port, () => console.log(`Server listening on port ${port}`));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
