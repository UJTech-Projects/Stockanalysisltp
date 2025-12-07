-- Init DB schema for watchlist + LTP history
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text DEFAULT 'default',
  owner_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid,
  symbol text NOT NULL,
  exchange text,
  instrument_token text,
  added_at timestamptz DEFAULT now(),
  UNIQUE (watchlist_id, symbol)
);

CREATE TABLE IF NOT EXISTS ltp_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  exchange text,
  date date NOT NULL,
  ltp numeric(18,6) NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltp_symbol_date ON ltp_history(symbol, date);

CREATE TABLE IF NOT EXISTS angel_tokens (
  id serial PRIMARY KEY,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  last_refreshed timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instrument_master (
  token text NOT NULL,
  symbol text,
  name text,
  expiry text,
  strike numeric,
  lotsize numeric,
  instrumenttype text,
  exch_seg text,
  tick_size numeric,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (token, exch_seg)
);

CREATE INDEX IF NOT EXISTS idx_instr_symbol ON instrument_master(symbol);
CREATE INDEX IF NOT EXISTS idx_instr_name ON instrument_master(name);
