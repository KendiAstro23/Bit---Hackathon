PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pubkey TEXT NOT NULL UNIQUE,
  privkey TEXT NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  liquidity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  state TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swap_id TEXT NOT NULL UNIQUE,
  agent_pubkey TEXT,
  agent_phone TEXT,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL DEFAULT 'BTC',
  fiat_amount INTEGER NOT NULL,
  btc_amount_sats INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_reference TEXT,
  counterparty TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS published_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_kind INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  event_json TEXT NOT NULL,
  relay_results_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
CREATE INDEX IF NOT EXISTS idx_swaps_agent_status ON swaps(agent_phone, agent_pubkey, status);
CREATE INDEX IF NOT EXISTS idx_published_events_pubkey ON published_events(pubkey);
