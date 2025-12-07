require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const watchlistRouter = require('./routes/watchlist');
const refreshTokenJob = require('./jobs/refreshToken');
const fetchLTPJob = require('./jobs/fetchLTP');
const subManager = require('./ws/manager');
const logger = require('./logger');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/status', (req, res) => {
  const status = subManager.getStatus();
  res.json({ ok: true, status });
});
app.use('/api/watchlist', watchlistRouter);

// Job endpoints for cron runners to call
app.post('/jobs/refresh-token', async (req, res) => {
  try {
    await refreshTokenJob();
    res.json({ ok: true });
  } catch (err) {
    logger.error('refresh-token job failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/fetch-ltp', async (req, res) => {
  try {
    await fetchLTPJob();
    res.json({ ok: true });
  } catch (err) {
    logger.error('fetch-ltp job failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Trigger resubscribe from DB (useful for cron or manual reconciliation)
app.post('/jobs/resubscribe', async (req, res) => {
  try {
    const result = await subManager.resubscribeFromDB();
    res.json({ ok: true, subscribed: result });
  } catch (err) {
    logger.error('resubscribe job failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason });
});

const port = process.env.PORT || 5000;
const server = app.listen(port, () => logger.info(`Server listening on port ${port}`));

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
