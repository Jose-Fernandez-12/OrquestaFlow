import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { transpileFlowToPython, type TranspilerContext } from '../src/engine/pythonTranspiler';

const n = (id: string, type: string, data: Record<string, any> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle || ''}`, source, target, sourceHandle });

// One flow that exercises every node type the exporter supports
const nodes = [
  n('start', 'start', { label: 'Inicio' }),
  n('hook', 'webhookTrigger', { label: 'Recibir pedido', samplePayload: '{"cliente": "ACME", "total": 120}' }),
  n('vars', 'variables', {
    label: 'Parámetros',
    variables: [
      { key: 'fecha', type: 'string', value: '$today_iso' },
      { key: 'limite', type: 'number', value: 50 },
      { key: 'region', type: 'string', value: '{{hook.body.cliente}}' },
    ],
  }),
  n('token', 'oauth2Connector', { label: 'Token API', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'super-secreto-123', grantType: 'client_credentials' }),
  n('api', 'httpRequest', {
    label: 'Obtener pedidos',
    method: 'POST',
    endpoint: 'https://api.test/pedidos?desde={{vars.fecha}}',
    headers: '{"X-Tenant": "{{hook.body.cliente}}"}',
    params: '{"limit": "{{vars.limite}}"}',
    body: '{"estado": "abierto", "externo": "{{Parametros externos.codigo}}"}',
    authType: 'bearer',
    authToken: '{{token.access_token}}',
    retryCount: 3,
    retryDelayMs: 2000,
    retryBackoff: 'fixed',
    onError: 'continue',
    timeout: 20,
  }),
  n('sql', 'query', { label: 'Ventas SQL', queryId: 'q1', queryParams: '{"region": "{{vars.region}}"}', retryCount: 2 }),
  n('lista', 'dataList', { label: 'Sucursales', items: '[{"id": 1, "zona": "norte"}, {"id": 2, "zona": "sur"}]' }),
  n('loop', 'forEach', { label: 'Cada sucursal', iterateOver: '{{lista}}', itemAlias: 'sucursal' }),
  n('rama', 'conditionalBranch', { label: 'Es norte', mode: 'if_else', conditions: [{ id: 'c1', left: '{{sucursal.zona}}', operator: 'equals', right: 'norte' }] }),
  n('detalle', 'httpGet', { label: 'Detalle', endpoint: 'https://api.test/sucursal/{{sucursal.id}}' }),
  n('espera', 'delay', { label: 'Espera', duration: 2, unit: 'seconds' }),
  n('fin', 'forEachEnd', { label: 'Fin sucursales' }),
  n('tipo', 'conditionalBranch', { label: 'Tipo de pedido', mode: 'switch', switchField: '{{hook.body.tipo}}', cases: [{ id: 'a', value: 'web', label: 'Web' }, { id: 'b', value: 'tienda' }] }),
  n('js', 'jsonTransform', { label: 'Normalizar', transformType: 'javascript', expression: 'return data.map(r => ({ ...r, ok: true }));' }),
  n('mapa', 'jsonTransform', { label: 'Renombrar', transformType: 'map', mappings: [{ from: 'id', to: 'codigo' }], keepOthers: true }),
  n('union', 'dataSource', { label: 'Unificar', mode: 'merge' }),
  n('archivo', 'dataSource', { label: 'Clientes Excel', filePath: 'data/uploads/clientes.xlsx', sheetName: 'Hoja1' }),
  n('ia', 'aiChatCompletion', { label: 'Resumen IA', model: 'gpt-4o-mini', apiKey: 'env:OPENAI_API_KEY', userPrompt: 'Resume: {{js}}', responseFormat: 'json_object' }),
  n('scrap', 'scraping', { label: 'Noticias', script: 'noticias' }),
  n('excel', 'export', { label: 'Reporte', format: 'Excel', fileName: 'reporte_{{vars.fecha}}', columns: [{ header: 'Código', key: 'codigo' }], headerColor: '#FF5733' }),
  n('hojas', 'export', { label: 'Libro', format: 'Excel', exportMode: 'multi', multiSheetConfig: { js: 'Normalizado', union: 'Unificado' } }),
];

const edges = [
  e('start', 'hook'), e('hook', 'vars'), e('vars', 'token'), e('token', 'api'), e('api', 'sql'),
  e('sql', 'lista'), e('lista', 'loop'), e('loop', 'rama'), e('rama', 'detalle', 'true'), e('rama', 'espera', 'false'),
  e('detalle', 'fin'), e('espera', 'fin'), e('fin', 'tipo'),
  e('tipo', 'js', 'case_a'), e('tipo', 'mapa', 'case_b'), e('js', 'union'), e('mapa', 'union'),
  e('union', 'ia'), e('archivo', 'ia'), e('ia', 'scrap'), e('scrap', 'excel'), e('excel', 'hojas'),
];

const ctx: TranspilerContext = {
  queries: {
    q1: {
      id: 'q1',
      name: 'Ventas por región',
      sql_text: "SELECT * FROM ventas WHERE region = #param_region AND fecha >= #param_desde AND nombre LIKE '%#param_region%'",
      params: '[]',
      connections: [
        { id: 'c1', name: 'Bogotá', host: 'db.bog', database_name: 'ventas', port: 1433, env_credential_key: 'BOGOTA' },
        { id: 'c2', name: 'Local', host: 'C:/datos/local.sqlite', database_name: 'sqlite', port: 1433, env_credential_key: 'NONE', driver: 'sqlite' },
      ],
    },
  },
  settings: { httpMaxRetries: 1, httpTimeoutSeconds: 30 },
  scripts: { noticias: { fileName: 'noticias.py', content: 'import json\nprint(json.dumps([{"titulo": "x"}]))\n' } },
};

describe('transpileFlowToPython', () => {
  const out = transpileFlowToPython('Pedidos y Sucursales', { nodes, edges }, ctx);

  // Written to disk so the package can be checked with a Python linter (npx pyright <dir>)
  const dir = path.join(os.tmpdir(), 'orquesta-transpiler-test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'transforms'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pedidos_y_sucursales_flow.py'), out.script);
  fs.writeFileSync(path.join(dir, 'orquesta_runtime.py'), out.runtimePy);

  it('creates one decorated function per node (start is implicit)', () => {
    const defs = [...out.script.matchAll(/^def (\w+)\(ctx\):/gm)].map(m => m[1]);
    expect(defs).toHaveLength(nodes.length - 1);
    expect(defs).toContain('obtener_pedidos');
    expect(defs).toContain('parametros');
    expect(out.script).toMatch(/@node\(\d+, "Obtener pedidos", node_id="api", kind="HTTP POST"/);
  });

  it('renders the loop as a for block with its alias and the steps that reach the end', () => {
    expect(out.script).toContain('for _ in loop(ctx, cada_sucursal, collect=[detalle, espera], alias="sucursal"):');
    expect(out.script).toMatch(/ {8}if ctx\.took\(es_norte, "true"\):  # Sí\n {12}run\(ctx, detalle\)/);
    expect(out.script).toMatch(/ {8}if ctx\.took\(es_norte, "false"\):  # No\n {12}run\(ctx, espera\)/);
  });

  it('guards branch outputs and merges with "or"', () => {
    expect(out.script).toContain('if ctx.took(tipo_de_pedido, "case_a"):  # Web');
    expect(out.script).toContain('if ctx.took(tipo_de_pedido, "case_b"):  # tienda');
    expect(out.script).toMatch(/if ctx\.took\(normalizar\) or ctx\.took\(renombrar\):\n {8}run\(ctx, unificar\)/);
    // Downstream of the merge the flow is unconditional again
    expect(out.script).toMatch(/\n {4}run\(ctx, resumen_ia\)/);
  });

  it('exports retry and error policies', () => {
    expect(out.script).toMatch(/retries=3,\s+retry_delay=2,\s+backoff="fixed"/);
    expect(out.script).toMatch(/@node\(\d+, "Obtener pedidos", node_id="api", kind="HTTP POST", on_error="continue"\)/);
    expect(out.script).toMatch(/@node\(\d+, "Ventas SQL", node_id="sql", kind="Consulta SQL", retries=2\)/);
    // HTTP nodes without an explicit count use the global setting
    expect(out.script).toMatch(/def detalle\(ctx\):\n\s+return http_request\(ctx, "GET", "https:\/\/api\.test\/sucursal\/\{\{sucursal\.id\}\}", timeout=30, retries=1\)/);
  });

  it('never writes clear-text secrets into the script', () => {
    expect(out.script).not.toContain('super-secreto-123');
    expect(out.script).toContain('client_secret=secret("OAUTH_CLIENT_SECRET_TOKEN_API")');
    expect(out.script).toContain('api_key=secret("OPENAI_API_KEY", required=False)');
    expect(out.envExample).toContain('OAUTH_CLIENT_SECRET_TOKEN_API=');
    expect(out.envExample).toContain('OPENAI_API_KEY=');
  });

  it('asks for values the flow does not produce', () => {
    expect(out.script).toContain('ask_into(ctx, "Parametros externos.codigo")');
    expect(out.script).not.toContain('ask_into(ctx, "sucursal.id")');
    expect(out.script).toContain('"desde": ask("desde")');
  });

  it('writes SQL, JavaScript and scraping files and supports SQLite connections', () => {
    expect(out.sqlFiles.map(f => f.fileName)).toEqual([expect.stringMatching(/^\d{2}_ventas_sql\.sql$/)]);
    expect(out.script).toContain('connections=["BOGOTA", "LOCAL"]');
    expect(out.script).toContain('"LOCAL": {"driver": "sqlite", "host": "C:/datos/local.sqlite"}');
    expect(out.envExample).toContain('DB_PATH_LOCAL=C:/datos/local.sqlite');
    expect(out.jsFiles).toHaveLength(1);
    expect(out.jsFiles[0].content).toContain('return data.map(r => ({ ...r, ok: true }));');
    expect(out.scriptFiles).toEqual([{ fileName: 'noticias.py', content: expect.any(String) }]);
    expect(out.script).toContain('return run_script(ctx, "scripts/noticias.py")');
    expect(out.requirementsTxt).toContain('pyodbc');
    expect(out.requirementsTxt).toContain('pandas');
  });

  it('keeps the variables node interactive with dynamic defaults', () => {
    expect(out.script).toContain('"fecha": ask("fecha", default=today("%Y-%m-%d")),');
    expect(out.script).toContain('"limite": ask("limite", default=50, kind="number"),');
    expect(out.script).toContain('"region": ask("region", default=resolve(ctx, "{{hook.body.cliente}}")),');
  });

  it('only imports the runtime helpers it uses', () => {
    const block = out.script.match(/from orquesta_runtime import \(([\s\S]*?)\)/)![1];
    const imported = block.split(',').map(s => s.trim()).filter(Boolean);
    for (const name of imported) {
      expect(out.script.split(block).join('')).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('leaves notes out of the script and lists them in the README', () => {
    const withNote = transpileFlowToPython('Con nota', {
      nodes: [n('start', 'start'), n('nota', 'note', { text: 'Revisar con finanzas\nantes del cierre' }), n('lista', 'dataList', { items: '[]' })],
      edges: [e('start', 'lista')],
    }, { queries: {} });
    expect(withNote.script).not.toContain('node_id="nota"');
    expect(withNote.script).not.toContain('Revisar con finanzas');
    expect(withNote.readmeMd).toContain('> Revisar con finanzas');
    expect(withNote.readmeMd).toContain('> antes del cierre');
  });

  it('returns an empty package for a flow without nodes', () => {
    const empty = transpileFlowToPython('Vacío', { nodes: [], edges: [] }, { queries: {} });
    expect(empty.script).toContain('no tiene nodos');
  });
});
