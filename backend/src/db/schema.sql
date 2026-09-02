CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  status TEXT DEFAULT 'draft',
  last_run_at TEXT,
  last_run_duration_ms INTEGER,
  last_run_record_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sql_text TEXT NOT NULL,
  params TEXT DEFAULT '[]',
  connection_ids TEXT DEFAULT '[]',
  display_columns TEXT DEFAULT '[]',
  last_run_at TEXT,
  last_row_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT,
  region TEXT NOT NULL,
  city TEXT,
  host TEXT NOT NULL,
  database_name TEXT NOT NULL,
  port INTEGER DEFAULT 1433,
  driver TEXT DEFAULT 'ODBC Driver 17 for SQL Server',
  username TEXT,
  password TEXT,
  env_credential_key TEXT,
  is_active INTEGER DEFAULT 1,
  last_tested_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  language TEXT DEFAULT 'python',
  schedule_cron TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('flow', 'script', 'query')),
  target_id TEXT NOT NULL,
  name TEXT,
  cron_expression TEXT NOT NULL,
  next_run_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('flow', 'script', 'query', 'node')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'error')),
  result TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  record_count INTEGER,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
