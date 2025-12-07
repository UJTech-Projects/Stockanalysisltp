#!/usr/bin/env node
require('dotenv').config();
const subManager = require('../src/ws/manager');

async function run() {
  try {
    console.log('Testing resubscribeFromDB...');
    await subManager.resubscribeFromDB();
    console.log('resubscribeFromDB invoked successfully (check logs for details).');
  } catch (err) {
    console.error('resubscribe test failed:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) run();
