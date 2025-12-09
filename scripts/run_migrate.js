#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function run() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'init.sql');
  if (!fs.existsSync(sqlPath)) throw new Error('sql/init.sql not found');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Force SSL for cloud databases (Aiven requires it)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  const client = await pool.connect();
  try {
    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = run;
