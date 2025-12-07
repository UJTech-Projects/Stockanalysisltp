# GEMINI - Angel One Watchlist Backend

Summary
- Backend scaffold for a watchlist and daily LTP persistence using Angel One (SmartAPI).
- Built with Node.js, Express, and Postgres (`pg`). Uses official `smartapi-javascript` SDK when available.

What I built (files)
- `package.json` - scripts and dependencies
- `sql/init.sql` - DB schema (watchlist, watchlist_item, ltp_history, angel_tokens)
- `src/db.js` - Postgres helper (pg Pool)
- `src/index.js` - Express server, routes, job endpoints
- `src/routes/watchlist.js` - add/remove/list/history endpoints
- `src/clients/angelClient.js` - wrapper for SmartAPI SDK and HTTP fallbacks (generate session/token, market quote)
- `src/jobs/refreshToken.js` - refresh token job (upserts latest token)
- `src/jobs/fetchLTP.js` - batch LTP fetch job with pruning to last 10 days
- `src/ws/wsClient.js` - WebSocket V2 manager that persists ticks into `ltp_history`
- `src/ws/runner.js` - runner to subscribe tokens from DB
- `src/ws/manager.js` - subscription manager singleton that starts WS lazily and resubscribes
- `scripts/run_migrate.js` - Node migration runner (executes `sql/init.sql`)
- `scripts/refreshToken.js`, `scripts/fetchLTP.js`, `scripts/test_resubscribe.js` - runnable scripts
- `.github/workflows/scheduled-jobs.yml` - example GitHub Actions schedule for token refresh and fetch LTP
- `.env.example` and `README.md`

How it works
- Authentication: `src/jobs/refreshToken.js` calls SmartAPI via `src/clients/angelClient.js`. The token response is stored in `angel_tokens` table.
- LTP polling: `src/jobs/fetchLTP.js` reads instrument tokens from `watchlist_item` and fetches LTP in batches, inserting one row per symbol per day into `ltp_history`. Older rows (>10 days) are deleted.
- WebSocket: `src/ws/wsClient.js` uses SmartAPI's `WebSocketV2` (SDK) to receive tick data and upserts the latest LTP for the current date into `ltp_history`.
- Subscription manager: `src/ws/manager.js` provides `resubscribeFromDB()` and `subscribeOneToken()` to update subscriptions when watchlist changes.
- Cron jobs: Two scheduled jobs are recommended — (A) token refresh (every 6–12 hours) and (B) post-market LTP fetch (once daily after market close). Example workflows and Render instructions are in `README.md` and `.github/workflows`.

What is missing / limitations (based on your client requirements)
- Full production-ready error handling & monitoring: currently logs to console; no centralized logging or alerting.
- Robust reconnection/backoff for WebSocket: basic connect logic exists, but needs reconnection strategies and dedup subscribe/unsubscribe flows.
- Exact SmartAPI payloads: SDK is used when available; HTTP fallbacks use documented endpoints but may need payload shaping based on your account responses. I tested shapes from the SDK, but account-specific variations may exist.
- Credentials security & rotation: `.env` is used locally. Use Render/GitHub Secrets in production and rotate client secrets regularly.
- Tests: no automated unit/integration tests yet. I can add tests using Jest and testcontainers for Postgres if desired.
- UI/dashboard: this repo exposes REST endpoints; you'll need a frontend to consume them (I can scaffold a minimal React dashboard if requested).
- User & multi-watchlist support: schema has a simple `watchlist.owner_id` but auth and multi-user considerations are not implemented.

How I tested locally (recommended steps)
1. Ensure `.env` in repo root contains required env vars (you already provided one): `DATABASE_URL`, `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_CLIENT_PASSWORD`, `ANGEL_TOTP_SECRET`, etc.
2. Install dependencies:
```powershell
npm install
```
3. Run migration (creates tables):
```powershell
node scripts/run_migrate.js
```
4. Refresh token (populates `angel_tokens`):
```powershell
npm run refresh-token
```
5. Start server:
```powershell
npm start
```
6. Optional: start WebSocket runner to receive live ticks (after token present):
```powershell
npm run ws
```
7. Add/remove watchlist items using API or curl to test subscriptions and LTP fetch.

Quick test commands
- Add symbol (example):
```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:5000/api/watchlist/add -Body (ConvertTo-Json @{ symbol='RELIANCE-EQ'; exchange='NSE'; instrument_token='3045' }) -ContentType 'application/json'
```
- Trigger resubscribe via endpoint:
```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:5000/jobs/resubscribe -UseBasicParsing
```
- Run resubscribe test (without HTTP):
```powershell
node scripts/test_resubscribe.js
```

Next recommended work
- Harden WebSocket reconnection and implement unsubscribe semantics.
- Add automated tests and CI (unit + integration against a test Postgres).
- Add production deployment configs (Render service + scheduled jobs) and secrets provisioning guide.
- Build a minimal frontend dashboard to add/remove symbols and show 10-day LTP history.

If you want, I will now run the migration and the resubscribe test script and report exact outputs. (This will connect to your DB using `DATABASE_URL` from `.env`.)
