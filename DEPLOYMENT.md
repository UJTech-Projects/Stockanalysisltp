# Deployment Guide for StockTrackerUJ

This guide covers deploying the backend to **Render.com** and setting up **GitHub Actions** for cron jobs and health checks.

## 1. Prerequisites
- GitHub repository with this code pushed.
- Angel One API credentials (API Key, Client Code, Password, TOTP Secret).
- Render account.

## 2. Deploy Database (Render PostgreSQL)
1.  Go to **Render Dashboard** -> **New** -> **PostgreSQL**.
2.  Name: `stock-tracker-db`.
3.  Region: `Singapore` (or closest to you).
4.  Create Database.
5.  **Copy the "Internal Database URL"** (for Render) and "**External Database URL**" (for local migration).

### Initial Migration
From your **local machine**:
```powershell
# Set env var to the EXTERNAL URL
$env:DATABASE_URL = "postgres://user:pass@host:port/dbname" 

# Run the migration script
node scripts/run_migrate.js
```

## 3. Deploy Backend (Render Web Service)
1.  Go to **Render Dashboard** -> **New** -> **Web Service**.
2.  Connect your GitHub repo.
3.  **Settings**:
    - **Name**: `stock-tracker-backend`
    - **Environment**: `Node`
    - **Build Command**: `npm install`
    - **Start Command**: `node src/index.js`
4.  **Environment Variables**:
    - `DATABASE_URL`: (Internal DB URL from step 2)
    - `ANGEL_API_KEY`: `...`
    - `ANGEL_CLIENT_CODE`: `...`
    - `ANGEL_CLIENT_PASSWORD`: `...`
    - `ANGEL_TOTP_SECRET`: `...`
    - `NODE_ENV`: `production`
5.  Click **Create Web Service**.
6.  **Copy your App URL** (e.g., `https://stock-tracker.onrender.com`).

## 4. Setup GitHub Actions (Automation)
The repo includes workflows to keep your app alive and run scheduled jobs.

1.  Go to your **GitHub Repo Settings** -> **Secrets and variables** -> **Actions**.
2.  Add a **New Repository Secret**:
    - Name: `RENDER_APP_URL`
    - Value: `https://your-app-name.onrender.com` (No trailing slash)

### Workflows Included:
1.  **Keep Alive (`keep-alive.yml`)**: Pings `/health` every 14 minutes to prevent Render Free Tier from sleeping.
2.  **Scheduled Jobs (`scheduled-jobs.yml`)**:
    - **Refresh Token**: Every 6 hours.
    - **Fetch LTP**: Daily at 10:00 UTC (15:30 IST).
    - **Resubscribe**: Daily at 03:15 UTC (08:45 IST).

## 5. Verification
1.  Open your App URL. You should see the StockTrackerUJ dashboard.
2.  The "Status" dot in the top bar should eventually turn **Green** (Connected).
3.  You can manually trigger jobs via `curl` to test:
    ```bash
    curl -X POST https://your-app.onrender.com/jobs/refresh-token
    ```