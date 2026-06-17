-- Tally D1 schema. Apply with:
--   npx wrangler d1 execute tally --file schema.sql --local
--   npx wrangler d1 execute tally --file schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  sex           TEXT CHECK (sex IN ('male','female')),
  height_cm     REAL,
  birthdate     TEXT,
  activity      TEXT DEFAULT 'sedentary',
  goal_weight_kg REAL,
  goal_rate_kg_per_week REAL DEFAULT -0.5,
  exercise_credit_pct INTEGER DEFAULT 0,
  units         TEXT DEFAULT 'imperial',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  log_date   TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_logs(user_id, log_date);

CREATE TABLE IF NOT EXISTS food_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  log_date     TEXT NOT NULL,
  meal         TEXT,
  name         TEXT NOT NULL,
  calories     REAL NOT NULL,
  protein_g    REAL DEFAULT 0,
  carbs_g      REAL DEFAULT 0,
  fat_g        REAL DEFAULT 0,
  source       TEXT NOT NULL,            -- 'manual' | 'ai' | 'db'
  restaurant   TEXT,
  barcode      TEXT,
  photo_key    TEXT,
  ai_raw_json  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_user_date ON food_logs(user_id, log_date);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  log_date        TEXT NOT NULL,
  activity_key    TEXT NOT NULL,
  duration_min    INTEGER NOT NULL,
  calories_burned INTEGER NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ex_user_date ON exercise_logs(user_id, log_date);
