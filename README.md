# Angel One Watchlist & LTP History Backend

A robust Node.js application to manage stock watchlists and persist daily Last Traded Price (LTP) history using the Angel One SmartAPI. It includes a smart lookup system, daily batch fetchers, real-time WebSocket updates, and a **modern frontend dashboard**.

## 🚀 Features

*   **Smart Watchlist Management**: Add stocks simply by symbol (e.g., "RELIANCE", "INFY"). The system automatically looks up the correct Instrument Token and Exchange (NSE/BSE).
*   **LTP Persistence**:
    *   **Daily Batch**: Fetches closing prices for all watchlist stocks once a day.
    *   **Real-Time**: Optional WebSocket integration to update prices in real-time during market hours.
*   **Historical Data**: Stores daily price history in PostgreSQL for analysis.
*   **Secure Auth**: Handles Angel One authentication automatically using MPIN and TOTP generation.
*   **Frontend Dashboard**: A premium, dark-mode web interface to manage stocks, view an LTP matrix, and analyze history.
*   **Robust Architecture**:
    *   PostgreSQL for reliable data storage.
    *   Background jobs for token refreshing and data fetching.
    *   Comprehensive error handling and retry logic.

---

## 🛠️ Prerequisites

*   **Node.js** (v16 or higher)
*   **PostgreSQL Database** (Local or Cloud like Aiven/Supabase)
*   **Angel One Account** with SmartAPI access enabled ([Sign up here](https://smartapi.angelone.in/)).
    *   You need: `API Key`, `Client Code`, `MPIN`, and `TOTP Secret`.

---

## ⚙️ Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone <repo-url>
    cd stock
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory:
    ```env
    PORT=5000
    DATABASE_URL=postgres://user:pass@host:port/dbname?sslmode=require

    # Angel One Credentials
    ANGEL_API_KEY=your_api_key
    ANGEL_CLIENT_CODE=your_client_id
    ANGEL_MPIN=your_mpin
    ANGEL_TOTP_SECRET=your_totp_secret_base32
    ```

4.  **Initialize Database**
    Run the migration script to create tables (`watchlist`, `ltp_history`, `instrument_master`, etc.).
    ```bash
    node scripts/run_migrate.js
    ```

5.  **Populate Stock Master Data**
    Fetch the latest list of 140k+ instruments from Angel One to enable smart lookup.
    ```bash
    node scripts/syncInstruments.js
    ```

---

## 🏃‍♂️ Running the Application

### 1. Start the Server
Starts the REST API and the Frontend Dashboard.
```bash
npx pm2 start ecosystem.config.js
# Or for development: npm start
```
*   **Access Dashboard**: Open `http://localhost:5000` in your browser.

### 2. (Optional) Start Real-Time WebSocket
Listens for live ticks during market hours and updates the DB.
```bash
npm run ws
```

---

## 📡 Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for a detailed guide on deploying to **Render.com** and setting up **GitHub Actions** for automated cron jobs.

---

## ⚠️ Troubleshooting & FAQ

### Connection terminated unexpectedly
If you see `Batch fetch failed: {"error":"Connection terminated unexpectedly"}`, it usually means the database connection was closed by the remote server (common with cloud DBs).
*   **Fix**: The code handles this with auto-reconnection pools, but ensure your `DATABASE_URL` is correct and allows external connections.

### What if my TOTP Secret expires?
If your TOTP secret changes (e.g., you regenerated it on the Angel One portal):
1.  Get the new TOTP Secret (Base32 string).
2.  Update the `ANGEL_TOTP_SECRET` variable in your `.env` file (locally) or in your Render Environment Variables (production).
3.  Restart the application (`npx pm2 restart 0`).

### Login Failed / Invalid TOTP
Ensure your system time is synced correctly. TOTP generation depends on accurate clock time.

### No Instrument Found
If adding a stock fails, try running `node scripts/syncInstruments.js` to update the master list of instruments from Angel One.
