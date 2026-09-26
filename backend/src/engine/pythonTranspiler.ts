/**
 * pythonTranspiler.ts
 * Converts an OrquestaFlow flow definition into a standalone Python package.
 *
 * The generated <flow>_flow.py reads like the flow itself: one short, decorated function per node
 * and a main() that runs them in order (loops become `for`, branches become `if`). All the mechanics
 * (templates, HTTP with retries, SQL, exports, conditions...) live in orquesta_runtime.py.
 */

import { normalizeEdges, isBranchHandle, findForEachEndNode, getForEachSubgraphNodes } from './graph.js';
import { PYTHON_RUNTIME } from './python/runtime.js';
import { envKey, pyCall, pyComment, pyIdentifier, pyLiteral, pyStr, slugify, type PyArg } from './python/pyCode.js';

export interface TranspilerConnectionInfo {
  id: string;
  name: string;
  host: string;
  database_name: string;
  port: number;
  env_credential_key: string;
  driver?: string;
}

export interface TranspilerQueryInfo {
  id: string;
  name: string;
  sql_text: string;
  params: string; // JSON string of param definitions
  connections: TranspilerConnectionInfo[];
}

export interface TranspilerContext {
  // Map of queryId -> full query info with connection data
  queries: Record<string, TranspilerQueryInfo>;
  /** System settings used as defaults (HTTP retries / timeout) */
  settings?: { httpMaxRetries?: number; httpTimeoutSeconds?: number };
  /** Scraping scripts found on the server: script name -> { fileName, content } */
  scripts?: Record<string, { fileName: string; content: string }>;
}

export interface TranspilerSqlFile {
  fileName: string;
  queryName: string;
  nodeLabel: string;
  sql: string;
}

export interface TranspilerJsFile {
  fileName: string;
  nodeLabel: string;
  content: string;
}

export interface TranspilerScriptFile {
  fileName: string;
  content: string;
}

export interface TranspilerOutput {
  script: string;
  runtimePy: string;
  scriptFiles: TranspilerScriptFile[];
  requirementsTxt: string;
  envExample: string;
  readmeMd: string;
  sqlFiles: TranspilerSqlFile[];
  jsFiles: TranspilerJsFile[];
}

const HTTP_TYPES = ['httpGet', 'httpPost', 'httpRequest'];
const RETRYABLE_TYPES = [...HTTP_TYPES, 'scraping', 'query', 'oauth2Connector', 'aiChatCompletion'];
const NO_CONTINUE_TYPES = ['start', 'forEach', 'forEachEnd', 'conditionalBranch'];

// ---------------------------------------------------------------------------
// Graph analysis
// ---------------------------------------------------------------------------

interface LoopInfo {
  endId: string | null;
  body: any[];
  terminalEdges: any[];
}

interface FlowGraph {
  nodes: any[];
  edges: any[];
  byId: Map<string, any>;
  mainOrder: any[];
  loops: Map<string, LoopInfo>;
  /** Loop body node id -> forEach id */
  loopOf: Map<string, string>;
  /** forEachEnd id -> forEach id */
  endOf: Map<string, string>;
}

function kahnOrder(nodes: any[], edges: any[], exclude: Set<string> = new Set()): any[] {
  const ids = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach(n => {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  });
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || exclude.has(e.target) || exclude.has(e.source)) continue;
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }
  const queue = nodes.filter(n => !exclude.has(n.id) && inDegree.get(n.id) === 0).map(n => n.id);
  const ordered: any[] = [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id));
    for (const next of adj.get(id) || []) {
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  // Nodes left out by a cycle are appended so nothing silently disappears
  for (const n of nodes) if (!exclude.has(n.id) && !ordered.includes(n)) ordered.push(n);
  return ordered;
}

function analyzeGraph(nodes: any[], rawEdges: any[]): FlowGraph {
  const edges = normalizeEdges(nodes, rawEdges);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adjList: Record<string, string[]> = {};
  nodes.forEach(n => (adjList[n.id] = []));
  edges.forEach(e => adjList[e.source]?.push(e.target));

  const loops = new Map<string, LoopInfo>();
  const loopOf = new Map<string, string>();
  const endOf = new Map<string, string>();
  for (const fe of nodes.filter(n => n.type === 'forEach')) {
    const endId = findForEachEndNode(fe.id, adjList, nodes);
    const bodyIds = endId ? getForEachSubgraphNodes(fe.id, endId, adjList) : [];
    bodyIds.forEach(id => loopOf.set(id, fe.id));
    if (endId) endOf.set(endId, fe.id);
    const bodyNodes = nodes.filter(n => bodyIds.includes(n.id));
    const bodyEdges = edges.filter(e => bodyIds.includes(e.source) && bodyIds.includes(e.target));
    loops.set(fe.id, {
      endId,
      body: kahnOrder(bodyNodes, bodyEdges),
      terminalEdges: edges.filter(e => e.target === endId && bodyIds.includes(e.source)),
    });
  }

  // Main DAG: loop bodies run inside their loop; the end node waits for its forEach
  const mainEdges = edges
    .filter(e => !loopOf.has(e.source) && !loopOf.has(e.target))
    .concat([...endOf.entries()].map(([endId, feId]) => ({ source: feId, target: endId })));
  const mainOrder = kahnOrder(nodes, mainEdges, new Set(loopOf.keys()));

  return { nodes, edges, byId, mainOrder, loops, loopOf, endOf };
}

/** Upstream nodes whose output feeds this node (timers and branches pass data through; start has none) */
function effectiveSources(nodeId: string, g: FlowGraph, seen = new Set<string>()): string[] {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const result: string[] = [];
  for (const e of g.edges.filter(e => e.target === nodeId)) {
    const src = g.byId.get(e.source);
    if (!src) continue;
    if (['timer', 'delay', 'conditionalBranch'].includes(src.type)) result.push(...effectiveSources(src.id, g, seen));
    else if (src.type !== 'start') result.push(src.id);
  }
  return [...new Set(result)];
}

function upstreamIds(nodeId: string, g: FlowGraph): Set<string> {
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of g.edges.filter(e => e.target === current)) {
      if (!found.has(e.source)) {
        found.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return found;
}

/** Incoming edges that decide whether a node runs (a forEachEnd only depends on its loop) */
function incomingForGuard(node: any, g: FlowGraph): Array<{ source: string; handle?: string }> {
  const loopId = g.endOf.get(node.id);
  if (loopId) return [{ source: loopId }];
  return g.edges
    .filter(e => e.target === node.id && g.byId.has(e.source))
    .filter(e => g.loopOf.get(e.source) === g.loopOf.get(node.id) || e.source === g.loopOf.get(node.id))
    .map(e => {
      const src = g.byId.get(e.source);
      return { source: e.source, handle: src?.type === 'conditionalBranch' && isBranchHandle(e.sourceHandle) ? e.sourceHandle : undefined };
    });
}

/** A node may be skipped only when every one of its inputs can be inactive (same rule as the engine) */
function computeMaybeSkipped(g: FlowGraph): Set<string> {
  const maybe = new Set<string>();
  const ordered = [...g.mainOrder.flatMap(n => (n.type === 'forEach' ? [n, ...(g.loops.get(n.id)?.body || [])] : [n]))];
  for (const n of ordered) {
    const incoming = incomingForGuard(n, g);
    if (incoming.length > 0 && incoming.every(i => i.handle || maybe.has(i.source))) maybe.add(n.id);
  }
  return maybe;
}

// ---------------------------------------------------------------------------
// Templates and inputs
// ---------------------------------------------------------------------------

function placeholders(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return [...text.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1].trim());
}

/** Placeholders the flow itself never produces: they are asked for when the script runs */
function externalPlaceholders(fields: unknown[], nodeId: string, g: FlowGraph): string[] {
  const upstream = upstreamIds(nodeId, g);
  const loopId = g.loopOf.get(nodeId);
  const known = (first: string) => {
    if (['_item', '_index', '_total', 'item', 'Variables', 'variables'].includes(first)) return true;
    if (loopId && first === loopId) return true;
    if (loopId && first === String(g.byId.get(loopId)?.data?.itemAlias || '').trim()) return true;
    return g.nodes.some(n => {
      if (!upstream.has(n.id)) return false;
      if (n.id === first || String(n.data?.label || '').trim() === first) return true;
      return n.type === 'variables' && Array.isArray(n.data?.variables) && n.data.variables.some((v: any) => v?.key === first);
    });
  };
  const out = new Set<string>();
  for (const f of fields) for (const ph of placeholders(f)) if (!known(ph.split(/[.[]/)[0].trim())) out.add(ph);
  return [...out];
}

function parseJsonMaybe(raw: unknown): { ok: boolean; value: any } {
  if (raw === undefined || raw === null || raw === '') return { ok: false, value: undefined };
  if (typeof raw !== 'string') return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}

function readSeconds(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

interface EnvEntry {
  name: string;
  value?: string;
  comment?: string;
}

interface StepInfo {
  node: any;
  number: number;
  fn: string;
  kind: string;
}

class Generator {
  readonly imports = new Set<string>(['node', 'run', 'run_main', 'start_flow', 'finish_flow']);
  readonly sqlFiles: TranspilerSqlFile[] = [];
  readonly jsFiles: TranspilerJsFile[] = [];
  readonly scriptFiles: TranspilerScriptFile[] = [];
  readonly env = new Map<string, EnvEntry[]>(); // section -> entries
  readonly databases = new Map<string, { name: string; host: string; database: string; port: number; driver: string }>();

  /** .env key of a connection: its credential key, or its name when it has none */
  connectionKey(c: TranspilerConnectionInfo): string {
    const raw = String(c.env_credential_key || '').trim();
    return (raw && raw.toUpperCase() !== 'NONE' ? raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : envKey(c.name)) || 'SQLSERVER';
  }
  readonly steps = new Map<string, StepInfo>();
  readonly requirements = new Set<string>(['python-dotenv>=1.0.0']);

  constructor(readonly flowName: string, readonly g: FlowGraph, readonly ctx: TranspilerContext) {}

  use(...names: string[]) {
    names.forEach(n => this.imports.add(n));
  }

  addEnv(section: string, entry: EnvEntry) {
    const list = this.env.get(section) || [];
    if (!list.some(e => e.name === entry.name)) list.push(entry);
    this.env.set(section, list);
  }

  label(nodeOrId: any): string {
    const n = typeof nodeOrId === 'string' ? this.g.byId.get(nodeOrId) : nodeOrId;
    return String(n?.data?.label || n?.id || '');
  }

  /** Python expression for a secret: never embeds clear-text values in the script */
  secretExpr(raw: unknown, envName: string, description: string, required = true): string | null {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    if (value.includes('{{')) return pyStr(value);
    const envMatch = value.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/);
    const name = envMatch ? envMatch[1] : envName;
    this.addEnv('Secretos y credenciales', { name, comment: envMatch ? description : `${description} (el valor original no se exporta por seguridad)` });
    this.use('secret');
    return required ? `secret(${pyStr(name)})` : `secret(${pyStr(name)}, required=False)`;
  }

  /** `ctx.output_of("a", "b")  # Label A` expression for the data a node receives */
  inputExpr(node: any, fallback: 'item' | 'last' | 'none' = 'item'): { expr: string; comment: string } {
    const sources = effectiveSources(node.id, this.g);
    if (sources.length > 0) {
      return {
        expr: `ctx.output_of(${sources.map(pyStr).join(', ')})`,
        comment: sources.map(s => this.label(s)).join(', '),
      };
    }
    if (fallback === 'last') return { expr: 'ctx.last_value()', comment: 'último resultado disponible' };
    if (fallback === 'item') return { expr: 'ctx.get("_item")', comment: this.g.loopOf.has(node.id) ? 'elemento del bucle' : '' };
    return { expr: 'None', comment: '' };
  }

  retryArgs(node: any): Array<[string, string]> {
    const data = node.data || {};
    const isHttp = HTTP_TYPES.includes(node.type);
    const explicit = data.retryCount === undefined || data.retryCount === null || data.retryCount === '' ? null : Number(data.retryCount);
    const retries = Math.max(0, Math.min(10, explicit ?? (isHttp ? this.ctx.settings?.httpMaxRetries ?? 1 : 0)));
    if (!retries || !RETRYABLE_TYPES.includes(node.type)) return [];
    const args: Array<[string, string]> = [['retries', String(retries)]];
    const delayMs = Number(data.retryDelayMs);
    if (Number.isFinite(delayMs) && data.retryDelayMs !== undefined && delayMs !== 1000) args.push(['retry_delay', String(Math.max(0, delayMs) / 1000)]);
    if (data.retryBackoff === 'fixed') args.push(['backoff', '"fixed"']);
    return args;
  }

  // ── Per-node bodies (lines inside `def fn(ctx):`, 4-space indented) ──

  body(node: any, step: StepInfo): string[] {
    switch (node.type) {
      case 'httpGet': case 'httpPost': case 'httpRequest': return this.httpBody(node);
      case 'query': return this.queryBody(node, step);
      case 'export': return this.exportBody(node);
      case 'dataSource': case 'fileSource': return this.dataSourceBody(node);
      case 'dataList': return this.dataListBody(node);
      case 'variables': return this.variablesBody(node);
      case 'timer': case 'delay': return this.timerBody(node);
      case 'forEach': return this.forEachBody(node);
      case 'forEachEnd': {
        this.use('loop_results');
        const loopId = this.g.endOf.get(node.id);
        return loopId ? [`return loop_results(ctx, ${pyStr(loopId)})  # ${pyComment(this.label(loopId))}`] : ['return []'];
      }
      case 'conditionalBranch': return this.branchBody(node);
      case 'jsonTransform': return this.transformBody(node, step);
      case 'webhookTrigger': return this.webhookBody(node);
      case 'oauth2Connector': return this.oauthBody(node);
      case 'aiChatCompletion': return this.aiBody(node);
      case 'scraping': return this.scrapingBody(node);
      default:
        this.use('log');
        return [
          `log.warning(${pyStr(`El nodo '${this.label(node)}' (${node.type}) no se puede exportar a Python; configúralo a mano.`)})`,
          'return {}',
        ];
    }
  }

  askLines(node: any, fields: unknown[]): string[] {
    const external = externalPlaceholders(fields, node.id, this.g);
    if (external.length === 0) return [];
    this.use('ask_into');
    for (const ph of external) this.addEnv('Valores de entrada', { name: `VAR_${ph.replace(/[^A-Za-z0-9_]/g, '_')}`, comment: `valor para {{${ph}}}` });
    return [
      '# Valores que el flujo no produce: se leen de .env (VAR_...) o se piden al ejecutar',
      ...external.map(ph => `ask_into(ctx, ${pyStr(ph)})`),
    ];
  }

  httpBody(node: any): string[] {
    const data = node.data || {};
    this.use('http_request');
    this.requirements.add('requests>=2.31.0');
    const method = node.type === 'httpPost' ? 'POST' : String(data.method || 'GET').toUpperCase();
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
    const args: PyArg[] = ['ctx', pyStr(method), pyStr(String(data.endpoint || ''))];

    const headers = parseJsonMaybe(data.headers);
    if (headers.ok && headers.value && typeof headers.value === 'object' && Object.keys(headers.value).length) {
      args.push(['headers', pyLiteral(headers.value, 4)]);
    } else if (!headers.ok && headers.value) {
      args.push(['headers', pyStr(headers.value)]);
    }
    const params = parseJsonMaybe(data.params);
    if (params.ok && params.value && typeof params.value === 'object' && Object.keys(params.value).length) {
      args.push(['params', pyLiteral(params.value, 4)]);
    }
    const rawBody = data.body && String(data.body).trim() ? data.body : data.payload;
    if (hasBody && rawBody) {
      const body = parseJsonMaybe(rawBody);
      args.push(['body', body.ok ? pyLiteral(body.value, 4) : pyStr(String(rawBody))]);
    }

    const key = envKey(this.label(node));
    if (data.authType === 'bearer') {
      const token = this.secretExpr(data.authToken, `HTTP_TOKEN_${key}`, `Token Bearer de '${this.label(node)}'`);
      if (token) args.push(['bearer_token', token]);
    } else if (data.authType === 'basic') {
      const user = pyStr(String(data.authUsername || ''));
      const password = this.secretExpr(data.authPassword, `HTTP_PASSWORD_${key}`, `Contraseña Basic Auth de '${this.label(node)}'`) || '""';
      args.push(['basic_auth', `(${user}, ${password})`]);
    }
    if (data.extractPath) args.push(['extract', pyStr(data.extractPath)]);
    const timeout = readSeconds(data.timeout) ?? this.ctx.settings?.httpTimeoutSeconds ?? 30;
    args.push(['timeout', String(timeout)]);
    args.push(...this.retryArgs(node));

    const iterateOver = String(data.iterateOver || '').trim();
    if (!this.g.loopOf.has(node.id)) {
      if (iterateOver && iterateOver !== '{{ID_NODO}}' && !iterateOver.startsWith('{{_item')) args.push(['for_each', pyStr(iterateOver)]);
      else if (data.iterateMode) args.push(['for_each', '"auto"']);
    }

    const fields = [data.endpoint, data.headers, data.params, hasBody ? rawBody : ''].filter(Boolean);
    return [...this.askLines(node, fields), `return ${pyCall('http_request', args, 0, 'return ')}`];
  }

  queryBody(node: any, step: StepInfo): string[] {
    const data = node.data || {};
    const query = this.ctx.queries[data.queryId];
    if (!query?.sql_text) {
      this.use('log');
      return [`log.warning(${pyStr(`La consulta del nodo '${this.label(node)}' no está configurada.`)})`, 'return []'];
    }
    this.use('run_sql');

    const fileName = `${String(step.number).padStart(2, '0')}_${slugify(this.label(node) || query.name) || 'consulta'}.sql`;
    const connections = query.connections?.length
      ? query.connections
      : [{ id: 'default', name: 'SQL Server', host: 'localhost', database_name: '', port: 1433, env_credential_key: 'SQLSERVER' }];
    const keys: string[] = [];
    for (const c of connections) {
      const k = this.connectionKey(c);
      if (c.driver !== 'sqlite') this.requirements.add('pyodbc>=5.0.0');
      keys.push(k);
      if (!this.databases.has(k)) {
        this.databases.set(k, { name: c.name, host: c.host, database: c.database_name, port: Number(c.port || 1433), driver: c.driver || 'ODBC Driver 17 for SQL Server' });
      }
    }
    this.sqlFiles.push({
      fileName,
      queryName: query.name || this.label(node),
      nodeLabel: this.label(node),
      sql: [
        `-- Flujo:    ${this.flowName}`,
        `-- Paso ${step.number}:   ${this.label(node)}`,
        `-- Consulta: ${query.name}`,
        `-- Conexión: ${connections.map(c => `${c.name} (${c.database_name} @ ${c.host})`).join(', ')}`,
        `-- Los #param_nombre se sustituyen por los valores de 'params' en el script.`,
        '',
        query.sql_text,
        '',
      ].join('\n'),
    });

    let mapping: Record<string, string> = {};
    try {
      mapping = data.queryParams ? JSON.parse(data.queryParams) : {};
    } catch {}
    const sqlParams = [...new Set([...query.sql_text.matchAll(/(?:^|[\s(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g)].map(m => m[1]))];

    const args: PyArg[] = ['ctx', ['sql_file', pyStr(`queries/${fileName}`)], ['connections', pyLiteral(keys, 4)]];
    if (sqlParams.length) {
      const entries = sqlParams.map(p => {
        if (mapping[p]) return `${pyStr(p)}: ${pyStr(mapping[p])}`;
        this.use('ask');
        this.addEnv('Valores de entrada', { name: `VAR_${p}`, comment: `parámetro SQL #param_${p} de '${this.label(node)}'` });
        return `${pyStr(p)}: ask(${pyStr(p)})`;
      });
      const inline = `{${entries.join(', ')}}`;
      args.push(['params', inline.length <= 72 ? inline : `{\n${entries.map(e => `        ${e},`).join('\n')}\n    }`]);
    }
    if (data.extractMode === 'selected_columns') {
      const cols = String(data.extractColumns || '').split(',').map(c => c.trim()).filter(Boolean);
      if (cols.length) args.push(['columns', pyLiteral(cols, 4)]);
    }
    const mapped = sqlParams.map(p => mapping[p]).filter(Boolean);
    return [...this.askLines(node, mapped), `return ${pyCall('run_sql', args, 0, 'return ')}`];
  }

  exportBody(node: any): string[] {
    const data = node.data || {};
    const isExcel = ['EXCEL', 'XLSX'].includes(String(data.format || 'CSV').toUpperCase());
    this.requirements.add('pandas>=2.0.0');
    if (isExcel) this.requirements.add('openpyxl>=3.1.0');
    const fileName = pyStr(String(data.fileName || `exportacion_${node.id}`));
    const color = data.headerColor ? [['header_color', pyStr(data.headerColor)] as [string, string]] : [];

    if (data.exportMode === 'multi' && isExcel) {
      this.use('export_sheets');
      const sheets = (data.multiSheetConfig || {}) as Record<string, string>;
      const lines = Object.entries(sheets).map(([id, sheet]) => `        ${pyStr(id)}: ${pyStr(sheet || `Hoja_${id.slice(0, 5)}`)},  # ${pyComment(this.label(id))}`);
      const sheetsExpr = lines.length ? `{\n${lines.join('\n')}\n    }` : '{}';
      return [`return ${pyCall('export_sheets', ['ctx', ['file_name', fileName], ['sheets', sheetsExpr], ...color], 0, 'return ')}`];
    }

    this.use('export_file');
    const lines: string[] = [];
    const dataSource = String(data.dataSource || '').trim();
    if (dataSource) {
      this.use('resolve');
      const template = dataSource.startsWith('{{') ? dataSource : `{{${dataSource}}}`;
      lines.push(`data = resolve(ctx, ${pyStr(template)})`);
    } else {
      const input = this.inputExpr(node, 'last');
      lines.push(`data = ${input.expr}${input.comment ? `  # ${pyComment(input.comment)}` : ''}`);
    }
    const args: PyArg[] = ['ctx', 'data', ['file_name', fileName], ['format', isExcel ? '"excel"' : '"csv"']];
    const columns = (Array.isArray(data.columns) ? data.columns : []).filter((c: any) => c?.header && c?.key).map((c: any) => ({ header: c.header, key: c.key }));
    if (columns.length) args.push(['columns', pyLiteral(columns, 4)]);
    const joins = (Array.isArray(data.joins) ? data.joins : []).filter((j: any) => j?.nodeId && j?.localKey && j?.foreignKey)
      .map((j: any) => ({ nodeId: j.nodeId, localKey: j.localKey, foreignKey: j.foreignKey }));
    if (joins.length) args.push(['joins', pyLiteral(joins, 4)]);
    if (isExcel) args.push(...color);
    lines.push(`return ${pyCall('export_file', args, 0, 'return ')}`);
    return [...this.askLines(node, [data.fileName]), ...lines];
  }

  dataSourceBody(node: any): string[] {
    const data = node.data || {};
    this.requirements.add('pandas>=2.0.0');
    if (data.mode === 'merge') {
      this.use('merge_sources');
      const sources = effectiveSources(node.id, this.g);
      if (sources.length === 0) {
        return ['return merge_sources(*[v for k, v in ctx.items() if not k.startswith(("start", "_"))])'];
      }
      return [`return merge_sources(${sources.map(s => `ctx.get(${pyStr(s)})`).join(', ')})  # ${pyComment(sources.map(s => this.label(s)).join(' + '))}`];
    }
    this.use('file_input', 'read_table');
    this.requirements.add('openpyxl>=3.1.0');
    const envName = `FILE_PATH_${envKey(this.label(node))}`;
    const original = String(data.filePath || '');
    const fileName = original.split(/[/\\]/).pop() || '';
    this.addEnv('Archivos de entrada', { name: envName, value: fileName, comment: `archivo para '${this.label(node)}'${original ? ` (original: ${original})` : ''}` });
    const readArgs: PyArg[] = ['path'];
    if (data.sheetName) readArgs.push(['sheet', pyStr(data.sheetName)]);
    return [
      `path = file_input(${pyStr(envName)}, default=${pyStr(fileName)})`,
      `return ${pyCall('read_table', readArgs, 0, 'return ')}`,
    ];
  }

  dataListBody(node: any): string[] {
    const parsed = parseJsonMaybe(node.data?.items);
    const items = parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
    return [`return ${pyLiteral(items, 0)}`];
  }

  variablesBody(node: any): string[] {
    const data = node.data || {};
    let vars: Array<{ key: string; type?: string; value?: any }> = [];
    if (Array.isArray(data.variables) && data.variables.length) {
      vars = data.variables.filter((v: any) => v?.key && String(v.key).trim());
    } else {
      const parsed = parseJsonMaybe(data.rawJson);
      if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
        vars = Object.entries(parsed.value).map(([key, value]) => ({
          key,
          value,
          type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' ? 'json' : 'string',
        }));
      }
    }
    this.use('set_variables');
    if (vars.length === 0) return ['return set_variables(ctx, {})'];
    this.use('ask');
    const entries = vars.map(v => {
      const key = String(v.key).trim();
      this.addEnv('Variables del flujo', { name: `VAR_${key.replace(/[^A-Za-z0-9_]/g, '_')}`, comment: `por defecto: ${typeof v.value === 'object' ? JSON.stringify(v.value) : v.value ?? ''}` });
      const kind = v.type && v.type !== 'string' ? `, kind=${pyStr(v.type)}` : '';
      return `        ${pyStr(key)}: ask(${pyStr(key)}, default=${this.presetExpr(v.value)}${kind}),`;
    });
    return ['return set_variables(ctx, {', ...entries.map(e => e.slice(4)), '})'];
  }

  /** Dynamic presets of the Variables node ($today, $ayer_iso...) */
  presetExpr(value: unknown): string {
    if (typeof value !== 'string') return value !== null && typeof value === 'object' ? pyStr(JSON.stringify(value)) : pyLiteral(value ?? '');
    const lower = value.trim().toLowerCase();
    const presets: Record<string, [string, string]> = {
      $today: ['today', '"%Y%m%d"'], $today_ymd: ['today', '"%Y%m%d"'], $hoy: ['today', '"%Y%m%d"'],
      $today_iso: ['today', '"%Y-%m-%d"'], $hoy_iso: ['today', '"%Y-%m-%d"'],
      $yesterday: ['today', '"%Y%m%d", days=-1'], $yesterday_ymd: ['today', '"%Y%m%d", days=-1'], $ayer: ['today', '"%Y%m%d", days=-1'],
      $yesterday_iso: ['today', '"%Y-%m-%d", days=-1'], $ayer_iso: ['today', '"%Y-%m-%d", days=-1'],
      $month_start: ['month_start', '"%Y%m%d"'], $inicio_mes: ['month_start', '"%Y%m%d"'],
      $month_start_iso: ['month_start', '"%Y-%m-%d"'], $inicio_mes_iso: ['month_start', '"%Y-%m-%d"'],
      $now_timestamp: ['now_ms', ''], $timestamp: ['now_ms', ''], $now_iso: ['now_iso', ''],
    };
    const preset = presets[lower];
    if (preset) {
      this.use(preset[0]);
      return `${preset[0]}(${preset[1]})`;
    }
    if (value.includes('{{')) {
      this.use('resolve');
      return `resolve(ctx, ${pyStr(value.trim())})`;
    }
    return pyStr(value.trim());
  }

  timerBody(node: any): string[] {
    const data = node.data || {};
    const duration = parseFloat(data.duration || '10') || 10;
    const seconds = Math.max(0, data.unit === 'minutes' ? duration * 60 : data.unit === 'hours' ? duration * 3600 : duration);
    this.use('pause');
    const sources = effectiveSources(node.id, this.g);
    if (!sources.length) return [`return pause(${seconds})`];
    const input = this.inputExpr(node);
    return [`return pause(${seconds}, ${input.expr})  # deja pasar: ${pyComment(input.comment)}`];
  }

  forEachBody(node: any): string[] {
    const expr = String(node.data?.iterateOver || '').trim();
    if (expr) {
      this.use('as_list', 'resolve');
      return [`return as_list(resolve(ctx, ${pyStr(expr)}))`];
    }
    const input = this.inputExpr(node, 'none');
    if (input.expr === 'None') return ['return []  # el bucle no tiene una lista conectada'];
    return [
      `items = ${input.expr}  # ${pyComment(input.comment)}`,
      'return items if isinstance(items, list) else []',
    ];
  }

  branchBody(node: any): string[] {
    const data = node.data || {};
    if (data.mode === 'switch') {
      this.use('switch');
      const cases = Array.isArray(data.cases) ? data.cases : [];
      const rows = cases.map((c: any, idx: number) => {
        const item = typeof c === 'string' ? { id: String(idx + 1), value: c } : { id: String(c?.id ?? idx + 1), value: String(c?.value ?? ''), label: c?.label };
        return `        (${pyStr(item.id)}, ${pyStr(item.value)}, ${item.label ? pyStr(item.label) : 'None'}),`;
      });
      return [
        `return switch(ctx, ${pyStr(String(data.switchField ?? data.switchValue ?? ''))}, [`,
        ...rows.map((r: string) => r.slice(4)),
        '])',
      ];
    }
    this.use('condition');
    const rules = Array.isArray(data.conditions) && data.conditions.length
      ? data.conditions
      : [{ left: data.leftOperand ?? '', operator: data.operator || 'equals', right: data.rightOperand ?? '' }];
    const lines = rules.map((r: any) => `    (${pyStr(String(r.left ?? ''))}, ${pyStr(String(r.operator || 'equals'))}, ${pyStr(String(r.right ?? ''))}),`);
    const combine = data.combinator === 'or' ? ', combine="or"' : '';
    return ['return condition(ctx, [', ...lines, `]${combine})`];
  }

  transformBody(node: any, step: StepInfo): string[] {
    const data = node.data || {};
    const lines: string[] = [];
    const inputData = String(data.inputData ?? data.inputDataSource ?? '').trim();
    if (inputData) {
      this.use('resolve', 'unwrap');
      lines.push(`data = unwrap(resolve(ctx, ${pyStr(inputData)}))`);
    } else {
      const input = this.inputExpr(node);
      lines.push(`data = ${input.expr}${input.comment ? `  # ${pyComment(input.comment)}` : ''}`);
    }

    const mappings = Array.isArray(data.mappings) ? data.mappings.filter((m: any) => m?.from) : [];
    if ((data.transformType === 'map' || data.transformType === 'pick') && mappings.length) {
      this.use('map_fields');
      const args: PyArg[] = ['ctx', 'data', pyLiteral(mappings.map((m: any) => ({ from: m.from, to: m.to || m.from })), 4)];
      if (data.keepOthers) args.push(['keep_others', 'True']);
      lines.push(`return ${pyCall('map_fields', args, 0, 'return ')}`);
      return lines;
    }

    const code = String(data.expression || '').trim();
    if (!code) {
      lines.push('return data  # sin código JavaScript: los datos pasan sin cambios');
      return lines;
    }
    this.use('run_js');
    const fileName = `${String(step.number).padStart(2, '0')}_${slugify(this.label(node)) || 'transformacion'}.js`;
    this.jsFiles.push({
      fileName,
      nodeLabel: this.label(node),
      content: `// ${this.label(node)} (paso ${step.number} de "${this.flowName}")\n// data = entrada del paso, context = resultados de los pasos anteriores\n${code}\n`,
    });
    lines.push(`return run_js(ctx, ${pyStr(`transforms/${fileName}`)}, data)`);
    return lines;
  }

  webhookBody(node: any): string[] {
    this.use('webhook_payload');
    this.addEnv('Webhook', { name: 'WEBHOOK_PAYLOAD_FILE', comment: 'archivo JSON con el cuerpo recibido (también: --payload archivo.json)' });
    const sample = parseJsonMaybe(node.data?.samplePayload);
    return [`return webhook_payload(sample=${sample.ok ? pyLiteral(sample.value, 0) : '{}'})`];
  }

  oauthBody(node: any): string[] {
    const data = node.data || {};
    this.use('oauth2_token');
    this.requirements.add('requests>=2.31.0');
    const key = envKey(this.label(node));
    const grant = data.grantType || 'client_credentials';
    const args: PyArg[] = ['ctx', ['token_url', pyStr(String(data.tokenUrl || ''))], ['grant_type', pyStr(grant)]];
    if (data.clientId) args.push(['client_id', pyStr(String(data.clientId))]);
    const clientSecret = this.secretExpr(data.clientSecret, `OAUTH_CLIENT_SECRET_${key}`, `client secret de '${this.label(node)}'`);
    if (clientSecret) args.push(['client_secret', clientSecret]);
    if (data.scope) args.push(['scope', pyStr(String(data.scope))]);
    if (data.authMethod === 'basic') args.push(['auth_method', '"basic"']);
    if (grant === 'password') {
      args.push(['username', pyStr(String(data.username || ''))]);
      const password = this.secretExpr(data.password, `OAUTH_PASSWORD_${key}`, `contraseña OAuth2 de '${this.label(node)}'`);
      if (password) args.push(['password', password]);
    }
    if (grant === 'refresh_token') {
      const refresh = this.secretExpr(data.refreshToken, `OAUTH_REFRESH_TOKEN_${key}`, `refresh token de '${this.label(node)}'`);
      if (refresh) args.push(['refresh_token', refresh]);
    }
    args.push(['timeout', String(this.ctx.settings?.httpTimeoutSeconds ?? 30)]);
    return [`return ${pyCall('oauth2_token', args, 0, 'return ')}`];
  }

  aiBody(node: any): string[] {
    const data = node.data || {};
    this.use('ai_chat');
    this.requirements.add('requests>=2.31.0');
    const args: PyArg[] = [
      'ctx',
      ['endpoint', pyStr(String(data.endpoint || 'https://api.openai.com/v1/chat/completions'))],
      ['model', pyStr(String(data.model || 'gpt-4o-mini'))],
    ];
    const apiKey = this.secretExpr(data.apiKey, `AI_API_KEY_${envKey(this.label(node))}`, `API key del proveedor de IA de '${this.label(node)}'`, false);
    if (apiKey) args.push(['api_key', apiKey]);
    if (data.systemPrompt) args.push(['system', pyStr(String(data.systemPrompt))]);
    args.push(['prompt', pyStr(String(data.userPrompt || ''))]);
    const temperature = Number(data.temperature ?? 0.7);
    if (Number.isFinite(temperature) && temperature !== 0.7) args.push(['temperature', String(temperature)]);
    if (Number(data.maxTokens)) args.push(['max_tokens', String(Number(data.maxTokens))]);
    if (data.responseFormat === 'json_object') args.push(['json_output', 'True']);
    args.push(['timeout', String(Math.max(5, Number(data.timeoutSeconds) || 120))]);
    return [`return ${pyCall('ai_chat', args, 0, 'return ')}`];
  }

  scrapingBody(node: any): string[] {
    const name = String(node.data?.script || '').trim();
    if (!name) {
      this.use('log');
      return [`log.warning(${pyStr(`El nodo '${this.label(node)}' no tiene un script de scraping asignado.`)})`, 'return {}'];
    }
    this.use('run_script');
    const found = this.ctx.scripts?.[name];
    const fileName = found?.fileName || name;
    if (found && !this.scriptFiles.some(f => f.fileName === found.fileName)) this.scriptFiles.push(found);
    const args: PyArg[] = ['ctx', pyStr(`scripts/${fileName}`)];
    if (node.data?.url) args.push(['url', pyStr(String(node.data.url))]);
    if (node.data?.selector) args.push(['selector', pyStr(String(node.data.selector))]);
    return [
      ...(found ? [] : [`# El script '${pyComment(name)}' no estaba en el servidor: cópialo en la carpeta scripts/`]),
      `return ${pyCall('run_script', args, 0, 'return ')}`,
    ];
  }

  kindOf(node: any): string {
    const data = node.data || {};
    switch (node.type) {
      case 'httpGet': return 'HTTP GET';
      case 'httpPost': return 'HTTP POST';
      case 'httpRequest': return `HTTP ${String(data.method || 'GET').toUpperCase()}`;
      case 'query': return 'Consulta SQL';
      case 'export': return ['EXCEL', 'XLSX'].includes(String(data.format || '').toUpperCase()) ? 'Exportar Excel' : 'Exportar CSV';
      case 'dataSource': case 'fileSource': return data.mode === 'merge' ? 'Unificar datos' : 'Leer archivo';
      case 'dataList': return 'Lista de datos';
      case 'variables': return 'Variables';
      case 'timer': case 'delay': return 'Pausa';
      case 'forEach': return 'Bucle';
      case 'forEachEnd': return 'Fin de bucle';
      case 'conditionalBranch': return data.mode === 'switch' ? 'Switch' : 'Condición Sí/No';
      case 'jsonTransform': return 'Transformación JS';
      case 'webhookTrigger': return 'Webhook';
      case 'oauth2Connector': return 'OAuth2';
      case 'aiChatCompletion': return 'IA';
      case 'scraping': return 'Web scraping';
      default: return node.type;
    }
  }

  stepFunction(step: StepInfo): string {
    const { node } = step;
    const decoratorArgs: PyArg[] = [String(step.number), pyStr(this.label(node)), ['node_id', pyStr(node.id)], ['kind', pyStr(step.kind)]];
    if (RETRYABLE_TYPES.includes(node.type) && !HTTP_TYPES.includes(node.type)) decoratorArgs.push(...this.retryArgs(node));
    if (node.data?.onError === 'continue' && !NO_CONTINUE_TYPES.includes(node.type)) decoratorArgs.push(['on_error', '"continue"']);

    const title = `# ── ${step.number} · ${pyComment(this.label(node))} `;
    return [
      title.padEnd(79, '─'),
      `@${pyCall('node', decoratorArgs, 0, '@')}`,
      `def ${step.fn}(ctx):`,
      ...this.body(node, step).flatMap(l => l.split('\n')).map(l => (l ? `    ${l}` : l)),
    ].join('\n');
  }

  guard(node: any, maybeSkipped: Set<string>): string | null {
    if (!maybeSkipped.has(node.id)) return null;
    const incoming = incomingForGuard(node, this.g);
    const parts: string[] = [];
    const labels: string[] = [];
    for (const i of incoming) {
      const fn = this.steps.get(i.source)?.fn;
      if (!fn) continue;
      parts.push(i.handle ? `ctx.took(${fn}, ${pyStr(i.handle)})` : `ctx.took(${fn})`);
      if (i.handle) labels.push(this.branchLabel(i.source, i.handle));
    }
    if (!parts.length) return null;
    const comment = labels.length ? `  # ${pyComment(labels.join(' / '))}` : '';
    return `if ${[...new Set(parts)].join(' or ')}:${comment}`;
  }

  branchLabel(branchId: string, handle: string): string {
    const data = this.g.byId.get(branchId)?.data || {};
    if (handle === 'true') return 'Sí';
    if (handle === 'false') return 'No';
    if (handle === 'default') return 'Por defecto';
    const caseId = handle.replace(/^case_/, '');
    const cases = Array.isArray(data.cases) ? data.cases : [];
    const found = cases.find((c: any, idx: number) => String(typeof c === 'string' ? idx + 1 : c?.id ?? idx + 1) === caseId);
    const text = typeof found === 'string' ? found : found?.label || found?.value || caseId;
    return String(text);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function transpileFlowToPython(
  flowName: string,
  definition: { nodes: any[]; edges: any[] },
  ctx: TranspilerContext
): TranspilerOutput {
  const notes = (definition.nodes || []).filter((n: any) => n.type === 'note' && String(n.data?.text || '').trim());
  const nodes: any[] = (definition.nodes || []).filter((n: any) => n.type !== 'note');
  const slug = slugify(flowName) || 'flujo';

  if (nodes.length === 0) {
    return {
      script: `#!/usr/bin/env python3\n"""${flowName}: el flujo no tiene nodos configurados."""\nprint("El flujo no tiene nodos configurados.")\n`,
      runtimePy: PYTHON_RUNTIME,
      scriptFiles: [],
      requirementsTxt: 'python-dotenv>=1.0.0\n',
      envExample: '# Sin variables requeridas\n',
      readmeMd: `# ${flowName}\n\nEl flujo no contiene nodos configurados.\n`,
      sqlFiles: [],
      jsFiles: [],
    };
  }

  const g = analyzeGraph(nodes, definition.edges || []);
  const gen = new Generator(flowName, g, ctx);

  // Number the steps in execution order (loop bodies right after their loop); start nodes are implicit
  const ordered: any[] = g.mainOrder.flatMap(n => (n.type === 'forEach' ? [n, ...(g.loops.get(n.id)?.body || [])] : [n]));
  const usedNames = new Set<string>();
  let number = 0;
  for (const n of ordered) {
    if (n.type === 'start') continue;
    number++;
    gen.steps.set(n.id, { node: n, number, fn: pyIdentifier(gen.label(n), usedNames), kind: gen.kindOf(n) });
  }
  const steps = [...gen.steps.values()];
  const functions = steps.map(s => gen.stepFunction(s));

  // main(): the flow read top to bottom
  const maybeSkipped = computeMaybeSkipped(g);
  const mainLines: string[] = [];
  const emitRun = (n: any, indent: string) => {
    const step = gen.steps.get(n.id);
    if (!step) return;
    const guard = gen.guard(n, maybeSkipped);
    if (guard) {
      mainLines.push(`${indent}${guard}`);
      mainLines.push(`${indent}    run(ctx, ${step.fn})`);
    } else {
      mainLines.push(`${indent}run(ctx, ${step.fn})`);
    }
  };

  for (const n of g.mainOrder) {
    if (n.type === 'start') continue;
    const loop = n.type === 'forEach' ? g.loops.get(n.id) : undefined;
    if (!loop || !loop.endId) {
      emitRun(n, '    ');
      continue;
    }
    gen.use('loop');
    const step = gen.steps.get(n.id)!;
    const collect = loop.terminalEdges
      .map(e => {
        const fn = gen.steps.get(e.source)?.fn;
        if (!fn) return null;
        const src = g.byId.get(e.source);
        return src?.type === 'conditionalBranch' && isBranchHandle(e.sourceHandle) ? `(${fn}, ${pyStr(e.sourceHandle)})` : fn;
      })
      .filter(Boolean);
    const guard = gen.guard(n, maybeSkipped);
    const indent = guard ? '        ' : '    ';
    if (guard) mainLines.push(`    ${guard}`);
    const alias = String(n.data?.itemAlias || '').trim();
    const loopArgs = [
      ...(collect.length ? [`collect=[${[...new Set(collect)].join(', ')}]`] : []),
      ...(alias ? [`alias=${pyStr(alias)}`] : []),
    ];
    mainLines.push(`${indent.slice(4)}    for _ in loop(ctx, ${[step.fn, ...loopArgs].join(', ')}):`);
    if (loop.body.length === 0) mainLines.push(`${indent}    pass`);
    for (const b of loop.body) {
      if (b.type === 'forEach') {
        mainLines.push(`${indent}    # Bucle anidado '${pyComment(gen.label(b))}': no soportado en la exportación`);
      }
      emitRun(b, `${indent}    `);
    }
  }

  const startIds = nodes.filter(n => n.type === 'start').map(n => n.id);
  const startArgs: PyArg[] = [pyStr(flowName), ['total_steps', String(steps.length)]];
  if (gen.databases.size) startArgs.push(['databases', 'DATABASES']);
  if (startIds.length && !(startIds.length === 1 && startIds[0] === 'start')) startArgs.push(['start_ids', pyLiteral(startIds, 8)]);

  // ── Assemble the script ──
  const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const indentOf = (s: StepInfo) => (g.loopOf.has(s.node.id) ? '   ' : '');
  const width = Math.min(48, Math.max(...steps.map(s => (indentOf(s) + gen.label(s.node)).length), 10) + 2);
  const stepList = steps.map(s => {
    return `    ${String(s.number).padStart(2)}. ${(indentOf(s) + gen.label(s.node) + ' ').padEnd(width, '.')} ${s.kind}`;
  });

  const script: string[] = [
    '#!/usr/bin/env python3',
    '"""',
    flowName,
    '='.repeat(Math.min(79, Math.max(flowName.length, 3))),
    `Generado por OrquestaFlow: ${now}`,
    '',
    'Pasos:',
    ...stepList,
    '',
    'Ejecución:',
    '    pip install -r requirements.txt',
    '    cp .env.example .env        # (Windows: copy .env.example .env) y completa los valores',
    `    python ${slug}_flow.py`,
    '',
    'Cada paso es una función decorada con @node; main() los ejecuta en orden.',
    'La lógica común (plantillas {{...}}, HTTP con reintentos, SQL, exportación)',
    'está en orquesta_runtime.py.',
    '"""',
    '',
    `from orquesta_runtime import (\n${[...gen.imports].sort().map(i => `    ${i},`).join('\n')}\n)`,
    '',
  ];

  if (gen.databases.size) {
    script.push(
      '# Conexiones de base de datos. Son valores por defecto: el archivo .env',
      '# (DB_HOST_<CLAVE>, DB_NAME_<CLAVE>, DB_PATH_<CLAVE>, ...) tiene prioridad.',
      'DATABASES = {',
      ...[...gen.databases.entries()].map(([key, db]) =>
        db.driver === 'sqlite'
          ? `    ${pyStr(key)}: {"driver": "sqlite", "host": ${pyStr(db.host)}},  # ${pyComment(db.name)}`
          : `    ${pyStr(key)}: {"host": ${pyStr(db.host)}, "database": ${pyStr(db.database)}, "port": ${db.port}, "driver": ${pyStr(db.driver)}},  # ${pyComment(db.name)}`),
      '}',
      '',
    );
  }

  script.push('', ...functions.flatMap(f => [f, '', '']));
  script.push(
    'def main():',
    `    ctx = ${pyCall('start_flow', startArgs, 4, 'ctx = ')}`,
    ...mainLines,
    '    finish_flow(ctx)',
    '',
    '',
    'if __name__ == "__main__":',
    '    run_main(main)',
    '',
  );

  // Imports may have grown while generating the functions: rebuild the import block
  const importIdx = script.findIndex(l => l.startsWith('from orquesta_runtime import'));
  script[importIdx] = `from orquesta_runtime import (\n${[...gen.imports].sort().map(i => `    ${i},`).join('\n')}\n)`;

  return {
    script: script.join('\n'),
    runtimePy: PYTHON_RUNTIME,
    scriptFiles: gen.scriptFiles,
    requirementsTxt: [...gen.requirements].sort().join('\n') + '\n',
    envExample: buildEnvExample(flowName, gen),
    readmeMd: buildReadme(flowName, slug, now, gen, steps, stepList, notes.map((n: any) => String(n.data.text).trim())),
    sqlFiles: gen.sqlFiles,
    jsFiles: gen.jsFiles,
  };
}

function buildEnvExample(flowName: string, gen: Generator): string {
  const lines = [
    '# =============================================================================',
    `# Variables de entorno del flujo: ${flowName}`,
    "# Copia este archivo como '.env' y completa los valores antes de ejecutar.",
    '# =============================================================================',
    '',
    '# Carpeta donde se guardan los archivos exportados (por defecto: ./exports)',
    '# OUTPUT_DIR=',
    '',
  ];

  if (gen.databases.size) {
    lines.push('# -- Bases de datos -----------------------------------------------------------');
    for (const [key, db] of gen.databases) {
      if (db.driver === 'sqlite') {
        lines.push(`# ${db.name} (SQLite, clave ${key})`, `DB_PATH_${key}=${db.host}`, '');
        continue;
      }
      lines.push(
        `# ${db.name} (clave ${key})`,
        `DB_HOST_${key}=${db.host}`,
        `DB_NAME_${key}=${db.database}`,
        `DB_PORT_${key}=${db.port}`,
        `DB_DRIVER_${key}=${db.driver}`,
        `DB_USER_${key}=`,
        `DB_PASSWORD_${key}=`,
        `# O una cadena completa: DB_CONN_STR_${key}=DRIVER={${db.driver}};SERVER=${db.host},${db.port};DATABASE=${db.database};UID=...;PWD=...`,
        '',
      );
    }
    if ([...gen.databases.values()].some(db => db.driver !== 'sqlite')) {
      lines.push('# Credenciales comunes a todas las conexiones SQL Server (opcional)', 'DB_USER_DEFAULT=', 'DB_PASSWORD_DEFAULT=', '');
    }
  }

  for (const [section, entries] of gen.env) {
    lines.push(`# -- ${section} ${'-'.repeat(Math.max(3, 74 - section.length))}`);
    for (const e of entries) {
      if (e.comment) lines.push(`# ${e.comment}`);
      const optional = section === 'Variables del flujo' || section === 'Valores de entrada' || section === 'Webhook';
      lines.push(`${optional ? '# ' : ''}${e.name}=${e.value ?? ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildReadme(flowName: string, slug: string, now: string, gen: Generator, steps: StepInfo[], stepList: string[], notes: string[] = []): string {
  const needsNode = gen.jsFiles.length > 0;
  const needsOdbc = [...gen.databases.values()].some(db => db.driver !== 'sqlite');
  const lines = [
    `# ${flowName}`,
    '',
    `Script de Python generado por **OrquestaFlow** (${now}).`,
    '',
    '## Contenido',
    '',
    `- \`${slug}_flow.py\` — el flujo: una función por paso y \`main()\`, que los ejecuta en orden.`,
    '- `orquesta_runtime.py` — funciones comunes (plantillas `{{...}}`, HTTP con reintentos, SQL, exportación, bucles y bifurcaciones). No necesitas modificarlo.',
    '- `requirements.txt` — dependencias de Python.',
    '- `.env.example` — plantilla de configuración (conexiones, secretos, archivos de entrada).',
    '- `flow.json` — definición original del flujo.',
  ];
  if (gen.sqlFiles.length) lines.push('- `queries/` — una consulta `.sql` por cada nodo de base de datos.');
  if (gen.jsFiles.length) lines.push('- `transforms/` — el código JavaScript de cada transformación.');
  if (gen.imports.has('run_script')) lines.push('- `scripts/` — los scripts de Python de los nodos de web scraping (deben imprimir JSON por consola).');

  lines.push(
    '',
    '## Requisitos',
    '',
    '- Python 3.9 o superior',
    ...(needsOdbc ? ['- [ODBC Driver 17 for SQL Server](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server) o superior'] : []),
    ...(needsNode ? ['- [Node.js](https://nodejs.org) 18 o superior (ejecuta las transformaciones JavaScript)'] : []),
    '',
    '## Instalación',
    '',
    '```bash',
    'python -m venv venv',
    'venv\\Scripts\\activate          # Linux / macOS: source venv/bin/activate',
    'pip install -r requirements.txt',
    'copy .env.example .env          # Linux / macOS: cp .env.example .env',
    '```',
    '',
    'Completa `.env` con los servidores, usuarios, contraseñas y tokens. Los secretos nunca se incluyen en el script.',
    '',
    '## Ejecución',
    '',
    '```bash',
    `python ${slug}_flow.py`,
    '```',
    '',
    'Si falta un valor de entrada (variables del flujo, parámetros SQL, archivos), el script lo pide por consola; para ejecuciones programadas defínelos en `.env` (`VAR_<nombre>`, `FILE_PATH_<NODO>`).',
    '',
    '## Cómo leer el script',
    '',
    '- Cada nodo es una función con el decorador `@node(número, "Nombre", ...)`; el número coincide con la lista de pasos.',
    '- `main()` muestra el recorrido: los bucles son un `for _ in loop(...)` y las bifurcaciones un `if ctx.took(paso, "salida")`.',
    '- `ctx` guarda el resultado de cada paso por id y por nombre, igual que `{{nodo.campo}}` en OrquestaFlow.',
    '- Los reintentos (`retries=`) y la opción de continuar ante errores (`on_error="continue"`) se configuran en cada nodo de OrquestaFlow y se exportan tal cual.',
    '',
    '## Pasos',
    '',
    '```',
    ...stepList.map(l => l.trimStart()),
    '```',
    '',
  );

  if (notes.length) {
    lines.push('## Notas del flujo', '');
    notes.forEach(note => lines.push(...note.split('\n').map(l => `> ${l}`), ''));
  }

  if (gen.sqlFiles.length) {
    lines.push('## Consultas SQL', '', '| Archivo | Consulta | Paso |', '|---|---|---|');
    gen.sqlFiles.forEach(f => lines.push(`| \`queries/${f.fileName}\` | ${f.queryName} | ${f.nodeLabel} |`));
    lines.push('');
  }
  if (gen.jsFiles.length) {
    lines.push('## Transformaciones JavaScript', '', '| Archivo | Paso |', '|---|---|');
    gen.jsFiles.forEach(f => lines.push(`| \`transforms/${f.fileName}\` | ${f.nodeLabel} |`));
    lines.push('');
  }
  return lines.join('\n');
}
