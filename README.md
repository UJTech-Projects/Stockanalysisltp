# Angel One Watchlist & LTP History Backend

A robust Node.js application to manage stock watchlists and persist daily Last Traded Price (LTP) history using the Angel One SmartAPI. It includes a smart lookup system, daily batch fetchers, real-time WebSocket updates, and a basic frontend dashboard.

## 🚀 Features

*   **Smart Watchlist Management**: Add stocks simply by symbol (e.g., "RELIANCE", "INFY"). The system automatically looks up the correct Instrument Token and Exchange (NSE/BSE).
*   **LTP Persistence**:
    *   **Daily Batch**: Fetches closing prices for all watchlist stocks once a day.
    *   **Real-Time**: Optional WebSocket integration to update prices in real-time during market hours.
*   **Historical Data**: Stores daily price history in PostgreSQL for analysis.
*   **Secure Auth**: Handles Angel One authentication automatically using MPIN and TOTP generation.
*   **Frontend Dashboard**: A clean web interface to manage stocks and view history.
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
npm start
```
*   **Access Frontend**: Open `http://localhost:5000` in your browser.

### 2. (Optional) Start Real-Time WebSocket
Listens for live ticks during market hours and updates the DB.
```bash
npm run ws
```

---

## 📡 API Reference

### 1. Add Stock to Watchlist
Adds a stock. You only need to provide the `symbol`. The backend will resolve the rest.

*   **Endpoint**: `POST /api/watchlist/add`
*   **Body**:
    ```json
    {
      "symbol": "TCS" 
    }
    ```
    *(Note: You can also pass specific `exchange` and `instrument_token` if you know them, but it's optional.)*

*   **Response (Success)**:
    ```json
    {
      "ok": true,
      "symbol": "TCS-EQ",
      "token": "11536",
      "exchange": "NSE"
    }
    ```

### 2. Remove Stock
*   **Endpoint**: `POST /api/watchlist/remove`
*   **Body**:
    ```json
    {
      "symbol": "TCS-EQ"
    }
    ```
*   **Response**: `{ "ok": true }`

### 3. List Watchlist
Returns all tracked stocks.

*   **Endpoint**: `GET /api/watchlist/list`
*   **Response**:
    ```json
    {
      "items": [
        {
          "symbol": "TCS-EQ",
          "exchange": "NSE",
          "instrument_token": "11536",
          "added_at": "2025-12-06T10:00:00.000Z"
        },
        ...
      ]
    }
    ```

### 4. Get Price History
Returns the stored daily LTPs for a specific stock.

*   **Endpoint**: `GET /api/watchlist/history/:symbol`
*   **Example**: `GET /api/watchlist/history/TCS-EQ`
*   **Response**:
    ```json
    {
      "symbol": "TCS-EQ",
      "history": [
        {
          "date": "2025-12-06T00:00:00.000Z",
          "ltp": "3525.50"
        },
        {
          "date": "2025-12-05T00:00:00.000Z",
          "ltp": "3480.00"
        }
      ]
    }
    ```

---

## 🤖 Automated Jobs (Scripts)

To keep your data fresh without manual intervention, you should schedule these scripts (e.g., via Cron, Windows Task Scheduler, or GitHub Actions).

### 1. `scripts/refreshToken.js`
*   **Purpose**: Generates a new Access Token (valid for 24h) using your MPIN/TOTP.
*   **Frequency**: Run every **6-12 hours**.
*   **Command**: `node scripts/refreshToken.js`

### 2. `scripts/fetchLTP.js`
*   **Purpose**: Fetches the closing price (LTP) for ALL stocks in your watchlist and saves it to the database.
*   **Frequency**: Run **once daily** (e.g., at 4:00 PM after market close).
*   **Command**: `node scripts/fetchLTP.js`

### 3. `scripts/syncInstruments.js`
*   **Purpose**: Downloads the latest instrument list (new IPOs, symbol changes) from Angel One.
*   **Frequency**: Run **once a week** or month.
*   **Command**: `node scripts/syncInstruments.js`

---

## 🗄️ Database Schema

*   **`watchlist_item`**: Stores your tracked stocks (Symbol, Token, Exchange).
*   **`ltp_history`**: Stores the price data.
    *   Columns: `symbol`, `date`, `ltp`, `exchange`, `fetched_at`.
    *   Constraint: Unique combination of `(symbol, date)` ensures only one price entry per day per stock.
*   **`instrument_master`**: A cached copy of all ~140k tradable instruments on Angel One, used for lookups.
*   **`angel_tokens`**: Stores the active API Access/Refresh tokens.

---

## ⚠️ Troubleshooting

*   **Login Failed / Invalid TOTP**: ensure your system time is synced correctly, as TOTP is time-based. Verify `ANGEL_TOTP_SECRET` in `.env`.
*   **No Instrument Found**: If adding a stock fails, try running `node scripts/syncInstruments.js` to update the master list.
*   **Database Connection Error**: Check your `DATABASE_URL` and ensure your IP is whitelisted in your database provider's settings.