CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  title TEXT,
  login TEXT,
  avatar_url TEXT,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT,
  title_json TEXT,
  status TEXT,
  rating INTEGER,
  owner_id TEXT,
  icon_url TEXT,
  raw_snapshot_id INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_owner ON games(owner_id);

CREATE TABLE IF NOT EXISTS discovered_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  pathname TEXT NOT NULL,
  category TEXT NOT NULL,
  status_code INTEGER,
  sample_search TEXT,
  schema_fingerprint TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  parser_status TEXT NOT NULL DEFAULT 'raw-only',
  UNIQUE(method, pathname)
);

CREATE TABLE IF NOT EXISTS raw_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  dedupe_key TEXT NOT NULL,
  game_id TEXT,
  category TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  pathname TEXT NOT NULL,
  search TEXT,
  status_code INTEGER,
  content_type TEXT,
  page_url TEXT,
  transport TEXT,
  request_body_json TEXT,
  body_json TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  normalized INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_raw_dedupe ON raw_responses(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_raw_game ON raw_responses(game_id);
CREATE INDEX IF NOT EXISTS idx_raw_category ON raw_responses(category);
CREATE INDEX IF NOT EXISTS idx_raw_captured ON raw_responses(captured_at DESC);

CREATE TABLE IF NOT EXISTS collection_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER,
  finished_at INTEGER,
  source TEXT,
  accepted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS collector_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connected_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  extension_version TEXT
);

CREATE TABLE IF NOT EXISTS game_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  source_raw_id INTEGER,
  players REAL,
  play_time_per_player REAL,
  game_ready REAL,
  game_ready_delta REAL,
  rating_ru REAL,
  rating_world REAL,
  UNIQUE(game_id, observation_day)
);

CREATE TABLE IF NOT EXISTS game_geography (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  country TEXT NOT NULL,
  players REAL,
  source_raw_id INTEGER,
  UNIQUE(game_id, observation_day, country)
);

CREATE TABLE IF NOT EXISTS game_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  platform TEXT NOT NULL,
  players REAL,
  source_raw_id INTEGER,
  UNIQUE(game_id, observation_day, platform)
);

CREATE TABLE IF NOT EXISTS game_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  avg_rating REAL,
  stars_1 INTEGER,
  stars_2 INTEGER,
  stars_3 INTEGER,
  stars_4 INTEGER,
  stars_5 INTEGER,
  total INTEGER,
  review_count INTEGER,
  source_raw_id INTEGER,
  UNIQUE(game_id, observation_day)
);

CREATE TABLE IF NOT EXISTS game_reviews (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  review_time INTEGER,
  author_name TEXT,
  text TEXT,
  rating REAL,
  language TEXT,
  likes INTEGER,
  dislikes INTEGER,
  source_raw_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reviews_game ON game_reviews(game_id, review_time DESC);

CREATE TABLE IF NOT EXISTS game_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  title TEXT,
  price_value REAL,
  price_code TEXT,
  removed INTEGER NOT NULL DEFAULT 0,
  source_raw_id INTEGER,
  UNIQUE(game_id, product_id, observation_day)
);

CREATE TABLE IF NOT EXISTS game_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  period_from TEXT,
  period_to TEXT,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  earn REAL,
  adv REAL,
  rsya REAL,
  intad REAL,
  inapp REAL,
  source_raw_id INTEGER,
  UNIQUE(game_id, period_from, period_to, observation_day)
);

-- Доход, введённый вручную (налог / старая система оплаты), поверх консоли.
CREATE TABLE IF NOT EXISTS manual_earn_months (
  account_id TEXT NOT NULL DEFAULT '',
  month_key TEXT NOT NULL,
  earn REAL NOT NULL,
  note TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, month_key)
);

CREATE TABLE IF NOT EXISTS metric_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  series_name TEXT NOT NULL,
  point_x INTEGER NOT NULL,
  point_y REAL,
  source_raw_id INTEGER,
  UNIQUE(game_id, observation_day, series_name, point_x)
);

CREATE INDEX IF NOT EXISTS idx_metric_series_players
  ON metric_series(series_name, game_id, point_x);

CREATE TABLE IF NOT EXISTS purchase_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  observation_day TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  metric_slug TEXT NOT NULL,
  metric_title TEXT,
  value REAL,
  unit TEXT,
  source_raw_id INTEGER,
  UNIQUE(game_id, observation_day, metric_slug)
);
