#!/usr/bin/env node
require('dotenv').config();
const refresh = require('../src/jobs/refreshToken');

refresh().catch(err => {
  console.error(err);
  process.exit(1);
});
