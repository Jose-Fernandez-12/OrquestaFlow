import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { encryptSecret } from '../engine/secrets.js';
import { sealDefinition } from '../engine/nodeSecrets.js';

// ORQUESTA_DB_PATH=':memory:' keeps the database in memory only (used by the automated tests)
const DB_PATH = process.env.ORQUESTA_DB_PATH || join(process.cwd(), 'data', 'orquesta.sqlite');
const IN_MEMORY = DB_PATH === ':memory:';

let sqlDb: any = null;

// Wrapper to mimic better-sqlite3 API
class SqlJsWrapper {
  private db: any;

  constructor(dbInstance: any) {
    this.db = dbInstance;
  }

  prepare(sql: string) {
    return {
      all: (...params: any[]) => {
        const stmt = this.db.prepare(sql);
        try {
          stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          return results;
        } finally {
          stmt.free();
        }
      },
      get: (...params: any[]) => {
        const stmt = this.db.prepare(sql);
        try {
          stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      run: (...params: any[]) => {
        const stmt = this.db.prepare(sql);
        try {
          stmt.run(params);
          scheduleSave();
          return { changes: 1 }; // Mock
        } finally {
          stmt.free();
        }
      }
    };
  }

  exec(sql: string) {
    this.db.run(sql);
    scheduleSave();
  }

  close() {
    if (this.db) {
      flushToDisk();
      this.db.close();
    }
  }
}

let wrappedDb: SqlJsWrapper | null = null;

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({
    // Need to correctly locate the wasm file
    locateFile: file => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  });

  const dataDir = join(process.cwd(), 'data');
  if (!IN_MEMORY && !existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (!IN_MEMORY && existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  wrappedDb = new SqlJsWrapper(sqlDb);

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  wrappedDb.exec(schema);
  migrateExecutionLogs(wrappedDb);

  try {
    wrappedDb.exec('ALTER TABLE flows ADD COLUMN is_locked INTEGER DEFAULT 0;');
  } catch (e) {
    // Column already exists, ignore
  // Migrate schedule_id if needed
  }
  try {
    wrappedDb.exec('ALTER TABLE queries ADD COLUMN group_name TEXT;');
    console.log('[DB] Migrated: added group_name to queries');
  } catch (e: any) {
    // Ignore if exists
  }
  try {
    wrappedDb.exec('ALTER TABLE queries ADD COLUMN region TEXT;');
    console.log('[DB] Migrated: added region to queries');
  } catch (e: any) {
    // Ignore if exists
  }
  try {
    wrappedDb.exec('ALTER TABLE connections ADD COLUMN group_name TEXT;');
    console.log('[DB] Migrated: added group_name to connections');
  } catch (e: any) {
    // Ignore if exists
  }
  try {
    wrappedDb.exec("ALTER TABLE queries ADD COLUMN display_columns TEXT DEFAULT '[]';");
    console.log('[DB] Migrated: added display_columns to queries');
  } catch (e: any) {
    // Ignore if exists
  }
  try {
    // Python environment of each script (shared or its own), as JSON: see engine/python/scriptEnv.ts
    wrappedDb.exec('ALTER TABLE scripts ADD COLUMN env_state TEXT;');
    console.log('[DB] Migrated: added env_state to scripts');
  } catch (e: any) {
    // Ignore if exists
  }
  try {
    // A connection can take its user and password from the credential store (engine/credentials.ts)
    wrappedDb.exec('ALTER TABLE connections ADD COLUMN credential_id TEXT;');
    console.log('[DB] Migrated: added credential_id to connections');
  } catch (e: any) {
    // Ignore if exists
  }

  encryptStoredPasswords(wrappedDb);
  sealStoredDefinitions(wrappedDb);
  compactQueryResults(wrappedDb);

  try {
    // Scheduled time of a run that did not happen because the server was off: see engine/scheduler.ts
    wrappedDb.exec('ALTER TABLE schedules ADD COLUMN last_missed_at TEXT;');
    console.log('[DB] Migrated: added last_missed_at to schedules');
  } catch (e: any) {
    // Ignore if exists
  }

  try {
    wrappedDb.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch (e: any) {
    // Ignore if exists
  }

  // Seed default settings if table is empty
  try {
    const settingsCount = wrappedDb.prepare('SELECT COUNT(*) as count FROM system_settings').get() as { count: number };
    if (settingsCount.count === 0) {
      const defaultSettings = [
        ['http_timeout_seconds', '30'],
        ['mssql_connection_timeout_seconds', '30'],
        ['mssql_request_timeout_seconds', '300'],
        ['script_timeout_seconds', '60'],
        ['http_max_retries', '1'],
        ['table_preview_row_limit', '500'],
        ['user_display_name', 'Jose Fernandez'],
        ['user_role_label', 'Administrador']
      ];
      for (const [key, val] of defaultSettings) {
        wrappedDb.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run(key, val);
      }
      console.log('[DB] Seeded default system_settings');
    }
  } catch (e: any) {
    console.error('[DB] Error initializing system_settings:', e);
  }

  // Seed demo data if tables are empty
  const flowCount = wrappedDb.prepare('SELECT COUNT(*) as count FROM flows').get() as { count: number };
  if (flowCount.count === 0) {
    // seedDemoData(wrappedDb);
  }
}

export function getDb(): SqlJsWrapper {
  if (!wrappedDb) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return wrappedDb;
}

// Older databases: allow the 'cancelled' status and add the trigger / per-node trace columns
function migrateExecutionLogs(db: SqlJsWrapper) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'execution_logs'").get() as { sql?: string } | undefined;
  if (table?.sql && !table.sql.includes("'cancelled'")) {
    const cols = (db.prepare('PRAGMA table_info(execution_logs)').all() as Array<{ name: string }>).map(c => c.name);
    const keep = ['id', 'target_type', 'target_id', 'schedule_id', 'status', 'result', 'error_message', 'duration_ms', 'record_count', 'trigger_type', 'node_trace', 'started_at', 'completed_at']
      .filter(c => cols.includes(c))
      .join(', ');
    db.exec(`
      ALTER TABLE execution_logs RENAME TO execution_logs_old;
      CREATE TABLE execution_logs (
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
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      INSERT INTO execution_logs (${keep}) SELECT ${keep} FROM execution_logs_old;
      DROP TABLE execution_logs_old;
      CREATE INDEX IF NOT EXISTS idx_execution_logs_target ON execution_logs(target_type, target_id, started_at);
    `);
    console.log('[DB] Migrated: execution_logs now supports cancelled runs and node traces');
  }

  // Before 'cancelled' existed, stopped runs were stored as errors
  db.exec("UPDATE execution_logs SET status = 'cancelled' WHERE status = 'error' AND (error_message LIKE '%detenid%' OR error_message LIKE '%cancelad%')");

  // Runs left as 'running' by a server restart will never finish
  db.exec("UPDATE execution_logs SET status = 'error', error_message = COALESCE(error_message, 'Interrumpido: el servidor se reinició durante la ejecución'), completed_at = COALESCE(completed_at, datetime('now')) WHERE status = 'running'");
}

// Passwords saved before they were encrypted (see engine/secrets.ts)
function encryptStoredPasswords(db: SqlJsWrapper) {
  // Includes values that only look encrypted (encryptSecret keeps the ones this key opens)
  const rows = db.prepare("SELECT id, password FROM connections WHERE password IS NOT NULL AND password != ''").all() as Array<{ id: string; password: string }>;
  let encrypted = 0;
  for (const row of rows) {
    const next = encryptSecret(row.password);
    if (next === row.password) continue;
    db.prepare('UPDATE connections SET password = ? WHERE id = ?').run(next, row.id);
    encrypted++;
  }
  if (encrypted > 0) console.log(`[DB] Migrated: encrypted ${encrypted} connection password(s)`);
}

// Secrets typed into nodes, in flows and in their saved versions (see engine/nodeSecrets.ts)
function sealStoredDefinitions(db: SqlJsWrapper) {
  let sealed = 0;
  for (const table of ['flows', 'flow_versions']) {
    const rows = db.prepare(`SELECT id, definition FROM ${table}`).all() as Array<{ id: string; definition: string }>;
    for (const row of rows) {
      const next = sealDefinition(row.definition);
      if (next === row.definition) continue;
      db.prepare(`UPDATE ${table} SET definition = ? WHERE id = ?`).run(next, row.id);
      sealed++;
    }
  }
  if (sealed > 0) console.log(`[DB] Migrated: encrypted the secrets typed into ${sealed} flow definition(s)`);
}

// Query runs used to keep every returned row in the history; now only their count is kept
function compactQueryResults(db: SqlJsWrapper) {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM execution_logs WHERE target_type = 'query' AND result LIKE '[%'").get() as { count: number }).count;
  if (count === 0) return;
  db.exec(`
    UPDATE execution_logs
    SET result = CASE WHEN json_valid(result) THEN json_object('rowCount', json_array_length(result)) ELSE NULL END
    WHERE target_type = 'query' AND result LIKE '[%'
  `);
  db.exec('VACUUM');
  console.log(`[DB] Migrated: removed the stored rows of ${count} query run(s)`);
}

/*
 * The whole database lives in memory (sql.js) and is written to disk as one file. Writing it after
 * every statement made each save cost a full copy of the file, so writes are grouped: the first
 * change schedules one save a moment later, and closing the database (or the process) saves at once.
 * The file is written next to the real one and then renamed over it, so a crash in the middle of a
 * save leaves the previous complete file instead of a truncated one.
 */
const SAVE_DELAY_MS = 250;
let saveTimer: NodeJS.Timeout | null = null;
let unsavedChanges = false;

function scheduleSave() {
  if (IN_MEMORY) return;
  unsavedChanges = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushToDisk();
  }, SAVE_DELAY_MS);
  // The exit handler below saves anything still pending, so the timer must not keep the process alive
  saveTimer.unref();
}

/** Writes pending changes to disk now */
export function flushToDisk(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (IN_MEMORY || !sqlDb || !unsavedChanges) return;
  unsavedChanges = false;
  const tmpPath = `${DB_PATH}.tmp`;
  try {
    writeFileSync(tmpPath, Buffer.from(sqlDb.export()));
    renameSync(tmpPath, DB_PATH);
  } catch (err) {
    // Try again with the next change; the previous file on disk is still complete
    unsavedChanges = true;
    console.error('[DB] Could not save the database to disk:', err);
  }
}

process.on('exit', () => flushToDisk());

function seedDemoData(db: SqlJsWrapper): void {
  const { v4: uuid } = require('uuid');

  const flowId = uuid();
  db.prepare(`
    INSERT INTO flows (id, name, description, definition, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    flowId,
    'Monitor de precios',
    'Consulta una fuente, extrae datos y prepara un archivo listo para compartir.',
    JSON.stringify({
      nodes: [
        { id: 'start', type: 'start', position: { x: 100, y: 250 }, data: { label: 'Inicio' } },
        { id: 'http1', type: 'httpGet', position: { x: 350, y: 180 }, data: { label: 'HTTP GET', endpoint: 'https://api.storefront.com/v1/catalogo', variables: [{ key: 'categoria', value: 'ofertas' }], responseType: 'JSON' } },
        { id: 'scrape1', type: 'scraping', position: { x: 600, y: 300 }, data: { label: 'Web scraping', script: 'extraer-precios', url: 'https://storefront.com/catalogo', selector: '.precio' } },
        { id: 'export1', type: 'export', position: { x: 850, y: 180 }, data: { label: 'Exportar CSV', fileName: 'precios-semanales.csv', format: 'CSV' } }
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'http1' },
        { id: 'e2', source: 'http1', target: 'scrape1' },
        { id: 'e3', source: 'scrape1', target: 'export1' }
      ]
    }),
    'saved'
  );

  const regions = [
    { region: 'Colombia', cities: ['Bogota', 'Medellin', 'Cali'] },
    { region: 'Mexico', cities: ['Ciudad de Mexico', 'Guadalajara'] },
    { region: 'Panama', cities: ['Ciudad de Panama', 'Colon'] }
  ];

  const insertConn = db.prepare(`
    INSERT INTO connections (id, name, group_name, region, city, host, database_name, port, env_credential_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const group of regions) {
    for (const city of group.cities) {
      insertConn.run(
        uuid(),
        city,
        'Demo Group',
        group.region,
        city,
        'db.operaciones.local',
        `orquesta_${city.toLowerCase().replace(/\s+/g, '_')}`,
        1433,
        'SQLSERVER'
      );
    }
  }

  db.prepare(`
    INSERT INTO queries (id, name, sql_text, params)
    VALUES (?, ?, ?, ?)
  `).run(
    uuid(),
    'Ventas por region',
    `SELECT region, COUNT(*) AS pedidos, SUM(total) AS facturacion\\nFROM pedidos\\nWHERE fecha >= :fecha_inicio\\n  AND (:region = 'todas' OR region = :region)\\nGROUP BY region\\nORDER BY facturacion DESC;`,
    JSON.stringify(['fecha_inicio', 'region'])
  );

  db.prepare(`
    INSERT INTO scripts (id, name, description, file_path, schedule_cron)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuid(), 'Actualizar inventario', 'Extrae disponibilidad y normaliza el stock por referencia.', 'scripts/actualizar_inventario.py', '0 */2 * * *');

  db.prepare(`
    INSERT INTO schedules (id, target_type, target_id, name, cron_expression, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), 'flow', flowId, 'Monitor de precios', '0 8 * * 1', 1);
}

export function closeDb(): void {
  if (wrappedDb) {
    wrappedDb.close();
  }
}
