#!/usr/bin/env node
require('dotenv').config();
const fetchLTP = require('../src/jobs/fetchLTP');

fetchLTP().catch(err => {
  console.error(err);
  process.exit(1);
});
