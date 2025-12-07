const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Enforce SSL for cloud databases (e.g., Aiven)
  ssl: { rejectUnauthorized: false },
  // Pool configuration to prevent connection timeouts
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  keepAlive: true
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
