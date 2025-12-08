const db = require('../db');
const { generateSessionOrToken } = require('../clients/angelClient');

async function run() {
  try {
    console.log('Refreshing Angel One token...');
    // Try refresh token flow first if available
    let resp;
    try {
      resp = await generateSessionOrToken({ useRefresh: true });
      console.log('Refresh token attempt result:', resp);
      if (resp?.success === false) {
        throw new Error(`Refresh failed: ${resp.message}`);
      }
    } catch (e) {
      // fallback to generate new session
      console.warn('Refresh token failed, trying to generate new session:', e.message);
      resp = await generateSessionOrToken({ useRefresh: false });
    }

    console.log('API Response received');

    // Response shape from SDK: { status: true, data: { jwtToken, refreshToken, feedToken, ... } }
    const data = resp?.data || resp;
    const accessToken = data?.jwtToken || data?.access_token || data?.accessToken || null;
    const refreshToken = data?.refreshToken || data?.refresh_token || null;
    const feedToken = data?.feedToken || data?.feed_token || null;
    const expiresAt = data?.expiry || null;

    console.log('Extracted - accessToken:', !!accessToken, 'feedToken:', !!feedToken, 'refreshToken:', !!refreshToken, 'expiresAt:', expiresAt);

    if (!accessToken) {
      throw new Error('No access token received from Angel One');
    }

    // Keep single latest row: delete old and insert new
    // Store feedToken in refresh_token field for WebSocket use
    await db.query('DELETE FROM angel_tokens');
    await db.query(
      `INSERT INTO angel_tokens(access_token, refresh_token, expires_at, last_refreshed) VALUES($1,$2,$3,now())`,
      [accessToken, feedToken || refreshToken, expiresAt]
    );
    console.log('Token refreshed and stored.');
    if (feedToken) {
      console.log('Feed Token (for WebSocket):', feedToken.substring(0, 50) + '...');
    }
  } catch (err) {
    console.error('Failed to refresh token:', err.message || err);
    console.error('Full error:', err);
    throw err;
  }
}

if (require.main === module) {
  run().catch(err => process.exit(1));
}

module.exports = run;

