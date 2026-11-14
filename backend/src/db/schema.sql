CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  status TEXT DEFAULT 'draft',
  is_locked INTEGER DEFAULT 0,
  published_version_id TEXT,
  published_definition TEXT,
  last_run_at TEXT,
  last_run_duration_ms INTEGER,
  last_run_record_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT,
  region TEXT,
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
  credential_id TEXT,
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
  last_missed_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('flow', 'script', 'query', 'node')),
  target_id TEXT NOT NULL,
  schedule_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'error', 'cancelled')),
  result TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  record_count INTEGER,
  trigger_type TEXT,
  node_trace TEXT,
  parent_execution_id TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_target ON execution_logs(target_type, target_id, started_at);
CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON execution_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_execution_logs_schedule_id ON execution_logs(schedule_id);

CREATE TABLE IF NOT EXISTS flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  name TEXT,
  definition TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON flow_versions(flow_id, version_number);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);


-- Secrets saved once and used by reference (engine/credentials.ts). `secret` is encrypted
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('bearer', 'basic', 'api_key')),
  username TEXT,
  header_name TEXT,
  secret TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 0,
  variables_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  method TEXT NOT NULL,
  headers_json TEXT,
  query_json TEXT,
  body_json TEXT,
  status_code INTEGER,
  response_json TEXT,
  idempotency_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_idempotency ON webhook_logs(webhook_id, idempotency_key);
