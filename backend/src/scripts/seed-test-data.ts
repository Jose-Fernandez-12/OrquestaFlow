/**
 * Crea (o actualiza) una conexión SQLite, consultas y scripts de prueba, más un flujo que usa una consulta.
 * Igual que seed-test-flows.ts, va por la API para no pisar la BD en memoria del servidor:
 *
 *   npm run seed:data --prefix backend            (usa http://localhost:3001)
 *   API_URL=http://localhost:3999 npm run seed:data --prefix backend
 *
 * Las consultas leen las tablas de la propia BD de OrquestaFlow (flows, execution_logs...), así que
 * no hace falta SQL Server. Los scripts usan solo la librería estándar de Python.
 */
import { join } from 'path';

const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const DB_FILE = process.env.SQLITE_FILE || join(process.cwd(), 'data', 'orquesta.sqlite');
const GROUP = 'Test';
const CONNECTION_NAME = 'Test - SQLite OrquestaFlow';

interface TestQuery { name: string; sql: string; display?: string[] }

const queries: TestQuery[] = [
  {
    name: 'Test - Flujos de prueba',
    sql: `SELECT id, name AS Flujo, status AS Estado, last_run_at AS Ultima_Ejecucion
FROM flows
WHERE name LIKE '%#param_texto%'
ORDER BY name;`,
  },
  {
    name: 'Test - Ejecuciones por estado',
    sql: `SELECT status AS Estado, COUNT(*) AS Total, ROUND(AVG(duration_ms)) AS Duracion_media_ms
FROM execution_logs
GROUP BY status
ORDER BY Total DESC;`,
  },
  {
    name: 'Test - Ejecuciones de un flujo',
    sql: `SELECT started_at AS Inicio, status AS Estado, duration_ms AS Duracion_ms, record_count AS Registros
FROM execution_logs
WHERE target_id = #param_flow_id
ORDER BY started_at DESC
LIMIT 20;`,
  },
  {
    name: 'Test - Lista IN (varios estados)',
    sql: `SELECT name AS Flujo, status AS Estado
FROM flows
WHERE status IN (#param_estados)
ORDER BY name;`,
  },
  {
    name: 'Test - CTE con resumen',
    sql: `WITH por_tipo AS (
  SELECT target_type AS tipo, status, COUNT(*) AS n
  FROM execution_logs
  GROUP BY target_type, status
)
SELECT tipo AS Tipo, status AS Estado, n AS Total
FROM por_tipo
ORDER BY tipo, Total DESC;`,
  },
  {
    name: 'Test - Sin filas',
    sql: 'SELECT id, name FROM flows WHERE 1 = 0;',
  },
  {
    name: 'Test - Error: tabla inexistente',
    sql: 'SELECT * FROM tabla_que_no_existe;',
  },
  {
    name: 'Test - Rechazada por validación',
    sql: 'DELETE FROM flows WHERE 1 = 0;',
  },
];

const scripts: Array<{ file: string; code: string }> = [
  {
    file: 'test_args_y_entorno.py',
    code: `"""Imprime los argumentos y el entorno recibidos. Ejecútalo desde Scripts, con y sin argumentos."""
import json
import os
import sys

print(json.dumps({
    "args": sys.argv[1:],
    "python": sys.version.split()[0],
    "scraping_url": os.environ.get("SCRAPING_URL", ""),
}, ensure_ascii=False))
`,
  },
  {
    file: 'test_scraping_offline.py',
    code: `"""Script para el nodo Web Scraping sin red: lee SCRAPING_URL / SCRAPING_SELECTOR y devuelve filas fijas."""
import json
import os

url = os.environ.get("SCRAPING_URL", "")
selector = os.environ.get("SCRAPING_SELECTOR", "")

rows = [
    {"posicion": i, "titulo": f"Titular de prueba {i}", "url": f"{url}/item/{i}", "selector": selector}
    for i in range(1, 6)
]
print(json.dumps(rows, ensure_ascii=False))
`,
  },
  {
    file: 'test_falla.py',
    code: `"""Termina con código 1 y un mensaje en stderr: para ver cómo se reporta un script que falla."""
import sys

print("antes de fallar")
sys.stderr.write("Error simulado: falta el archivo de entrada\\n")
sys.exit(1)
`,
  },
  {
    file: 'test_lento.py',
    code: `"""Espera N segundos (arg 1, por defecto 90): para probar el timeout y el botón de detener."""
import sys
import time

segundos = int(sys.argv[1]) if len(sys.argv) > 1 else 90
print(f"durmiendo {segundos}s", flush=True)
time.sleep(segundos)
print("listo")
`,
  },
];

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function seedConnection(): Promise<string> {
  const existing = (await api('/api/connections')).data as Array<{ id: string; name: string }>;
  const found = existing.find(c => c.name === CONNECTION_NAME);
  if (found) {
    await api(`/api/connections/${found.id}`, json('PUT', { host: DB_FILE }));
    console.log(`Conexión actualizada: ${CONNECTION_NAME}`);
    return found.id;
  }
  const created = await api('/api/connections', json('POST', {
    name: CONNECTION_NAME, group_name: GROUP, region: GROUP, city: 'Local', host: DB_FILE, driver: 'sqlite',
  }));
  console.log(`Conexión creada:     ${CONNECTION_NAME} -> ${DB_FILE}`);
  return created.data.id;
}

async function seedQueries(connectionId: string): Promise<Map<string, string>> {
  const existing = (await api('/api/queries')).data as Array<{ id: string; name: string }>;
  const ids = new Map<string, string>();
  for (const q of queries) {
    const body = { name: q.name, group_name: GROUP, region: GROUP, sql_text: q.sql, connection_ids: [connectionId], display_columns: q.display || [] };
    const found = existing.find(e => e.name === q.name);
    if (found) {
      await api(`/api/queries/${found.id}`, json('PUT', body));
      ids.set(q.name, found.id);
      console.log(`Consulta actualizada: ${q.name}`);
    } else {
      const created = await api('/api/queries', json('POST', body));
      ids.set(q.name, created.data.id);
      console.log(`Consulta creada:      ${q.name}`);
    }
  }
  return ids;
}

async function seedScripts(): Promise<void> {
  // El nombre visible sale del archivo: test_args_y_entorno.py -> "test args y entorno"
  const existing = (await api('/api/scripts')).data as Array<{ name: string }>;
  for (const s of scripts) {
    const name = s.file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    if (existing.some(e => e.name === name)) {
      console.log(`Script ya existe (se omite): ${name}`);
      continue;
    }
    const form = new FormData();
    form.append('file', new Blob([s.code], { type: 'text/x-python' }), s.file);
    await api('/api/scripts/upload', { method: 'POST', body: form });
    console.log(`Script creado:        ${name}`);
  }
}

async function seedFlow(queryIds: Map<string, string>): Promise<void> {
  const edge = (source: string, target: string) => ({
    id: `${source}__${target}`, source, sourceHandle: 'right', target, targetHandle: 'left',
    style: { stroke: '#22c55e', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#3b82f6' },
  });
  const name = 'Test 8 - Consulta SQL con parámetros';
  const definition = {
    nodes: [
      { id: 't8_start', type: 'start', position: { x: 40, y: 180 }, data: { label: 'Inicio' } },
      { id: 't8_vars', type: 'variables', position: { x: 250, y: 160 }, data: { label: 'Filtro', variables: [{ key: 'texto', type: 'string', value: 'Test' }] } },
      {
        id: 't8_query', type: 'query', position: { x: 480, y: 160 },
        data: { label: 'Flujos de prueba', queryId: queryIds.get('Test - Flujos de prueba'), queryParams: JSON.stringify({ texto: '{{t8_vars.texto}}' }) },
      },
      {
        id: 't8_map', type: 'jsonTransform', position: { x: 720, y: 160 },
        data: { label: 'Contar por estado', transformType: 'code', expression: 'const por = {};\nfor (const f of data) por[f.Estado] = (por[f.Estado] || 0) + 1;\nreturn { total: data.length, por_estado: por };' },
      },
    ],
    edges: [edge('t8_start', 't8_vars'), edge('t8_vars', 't8_query'), edge('t8_query', 't8_map')],
  };
  const body = {
    name,
    description: 'Variable -> consulta SQLite con #param_texto -> resumen. Verifica el paso de parámetros a un nodo de consulta y la vista previa de la consulta en modo debug.',
    definition: JSON.stringify(definition),
  };
  const existing = (await api('/api/flows')).data as Array<{ id: string; name: string }>;
  const found = existing.find(f => f.name === name);
  if (found) {
    await api(`/api/flows/${found.id}`, json('PUT', body));
    console.log(`Flujo actualizado:    ${name}`);
  } else {
    await api('/api/flows', json('POST', body));
    console.log(`Flujo creado:         ${name}`);
  }
}

async function main() {
  const connectionId = await seedConnection();
  const queryIds = await seedQueries(connectionId);
  await seedScripts();
  await seedFlow(queryIds);
}

main().catch(err => {
  console.error(`No se pudo sembrar en ${API_URL}:`, err.message);
  process.exit(1);
});
