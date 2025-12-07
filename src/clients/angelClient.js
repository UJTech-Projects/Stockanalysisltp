const axios = require('axios');
const pRetry = require('p-retry').default;
const { TOTP } = require('totp-generator');
require('dotenv').config();
const db = require('../db');

// Use official SDK when available for convenience
let SmartAPI = null;
try {
  SmartAPI = require('smartapi-javascript').SmartAPI;
} catch (e) {
  SmartAPI = null;
}

const API_ROOT = process.env.ANGEL_API_ROOT || 'https://apiconnect.angelone.in';

async function generateSessionOrToken({ useRefresh = false } = {}) {
  // If SDK is available, use it. If a refresh token exists and useRefresh=true, call generateToken(refresh_token)
  if (SmartAPI) {
    const client = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
    if (useRefresh) {
      // read latest refresh token from DB
      const r = await db.query('SELECT refresh_token FROM angel_tokens ORDER BY last_refreshed DESC LIMIT 1');
      const refreshToken = r.rows[0]?.refresh_token;
      if (refreshToken) {
        console.log('Attempting to use refresh token...');
        return client.generateToken(refreshToken);
      }
    }
    // generate fresh session via client credentials
    console.log('Generating new session with client code:', process.env.ANGEL_CLIENT_CODE);
    const { otp } = await TOTP.generate(process.env.ANGEL_TOTP_SECRET);
    console.log('OTP generated successfully');
    const result = await client.generateSession(process.env.ANGEL_CLIENT_CODE, process.env.ANGEL_MPIN, otp);
    console.log('Session generation result:', JSON.stringify(result, null, 2));
    return result;
  }

  // Fallback HTTP implementation
  if (useRefresh) {
    const r = await db.query('SELECT refresh_token FROM angel_tokens ORDER BY last_refreshed DESC LIMIT 1');
    const refreshToken = r.rows[0]?.refresh_token;
    if (!refreshToken) throw new Error('No refresh token available');
    console.log('Using HTTP fallback for token refresh...');
    const url = `${API_ROOT}/rest/auth/angelbroking/jwt/v1/generateTokens`;
    return pRetry(() => axios.post(url, { refreshToken }, {
      headers: { 'X-PrivateKey': process.env.ANGEL_API_KEY }
    }).then(r => r.data), { retries: 3 });
  }

  console.log('Using HTTP fallback for new session...');
  const url = `${API_ROOT}/rest/auth/angelbroking/user/v1/loginByPassword`;
  const { otp } = await TOTP.generate(process.env.ANGEL_TOTP_SECRET);
  console.log('OTP generated successfully for HTTP fallback');
  const body = {
    clientcode: process.env.ANGEL_CLIENT_CODE,
    password: process.env.ANGEL_MPIN,
    totp: otp
  };
  console.log('Calling Angel One API at:', url);
  try {
    const result = await pRetry(() => axios.post(url, body, { headers: { 'X-PrivateKey': process.env.ANGEL_API_KEY } }).then(r => r.data), { retries: 3 });
    console.log('API response:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('API call failed:', err.response?.data || err.message);
    throw err;
  }
}

async function getLTPBatch(exchangeTokensMap) {
  if (!exchangeTokensMap || Object.keys(exchangeTokensMap).length === 0) return [];

  // get latest access token from DB
  const r = await db.query('SELECT access_token FROM angel_tokens ORDER BY last_refreshed DESC LIMIT 1');
  const accessToken = r.rows[0]?.access_token;

  const params = {
      mode: "LTP",
      exchangeTokens: exchangeTokensMap
  };

  // If SDK available and has marketData, use it
  if (SmartAPI && accessToken) {
    const client = new SmartAPI({ api_key: process.env.ANGEL_API_KEY, access_token: accessToken });
    if (typeof client.marketData === 'function') {
      return client.marketData(params);
    }
  }

  // Fallback to direct HTTP call to the quote endpoint
  const url = `${API_ROOT}/rest/secure/angelbroking/market/v1/quote`;
  const headers = {
    'X-PrivateKey': process.env.ANGEL_API_KEY,
    'Content-Type': 'application/json'
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const resp = await pRetry(() => axios.post(url, params, { headers }).then(r => r.data), { retries: 3 });
  return resp;
}

module.exports = { generateSessionOrToken, getLTPBatch };
