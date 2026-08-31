import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'data', 'orquesta.sqlite');

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
          saveToDisk(); // Auto-save on writes
          return { changes: 1 }; // Mock
        } finally {
          stmt.free();
        }
      }
    };
  }

  exec(sql: string) {
    this.db.run(sql);
    saveToDisk();
  }

  close() {
    if (this.db) {
      saveToDisk();
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
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  wrappedDb = new SqlJsWrapper(sqlDb);

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  wrappedDb.exec(schema);

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

function saveToDisk() {
  if (sqlDb) {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  }
}

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
    INSERT INTO connections (id, name, region, city, host, database_name, port, env_credential_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const group of regions) {
    for (const city of group.cities) {
      insertConn.run(
        uuid(),
        city,
        group.region,
        city,
        'db.operaciones.local',
        `orquesta_${city.toLowerCase().replace(/\\s+/g, '_')}`,
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
