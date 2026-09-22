/**
 * pythonTranspiler.ts
 * Convierte la definicion JSON de un flujo de OrquestaFlow a un script Python ejecutable y autonomo.
 */

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
}

export interface TranspilerSqlFile {
  fileName: string;
  queryName: string;
  nodeLabel: string;
  sql: string;
}

export interface TranspilerOutput {
  script: string;
  requirementsTxt: string;
  envExample: string;
  readmeMd: string;
  sqlFiles: TranspilerSqlFile[];
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn)
// ---------------------------------------------------------------------------
function buildTopologicalOrder(nodes: any[], edges: any[]): any[] {
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};

  nodes.forEach(n => {
    inDegree[n.id] = 0;
    adjList[n.id] = [];
  });

  const normalizedEdges = edges.map(edge => {
    const srcNode = nodes.find(n => n.id === edge.source);
    const tgtNode = nodes.find(n => n.id === edge.target);
    if (srcNode && tgtNode) {
      const srcConfigStr = JSON.stringify(srcNode.data || {});
      if (srcConfigStr.includes(tgtNode.id)) {
        return { ...edge, source: tgtNode.id, target: srcNode.id };
      }
    }
    return edge;
  });

  normalizedEdges.forEach(edge => {
    if (adjList[edge.source] !== undefined) {
      adjList[edge.source].push(edge.target);
      inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
    }
  });

  const forEachNodes = nodes.filter(n => n.type === 'forEach');
  const forEachManagedNodeIds = new Set<string>();

  for (const feNode of forEachNodes) {
    const endId = findForEachEndNode(feNode.id, adjList, nodes);
    if (endId) {
      const subIds = getForEachSubgraphNodes(feNode.id, endId, adjList, nodes);
      subIds.forEach(sid => {
        forEachManagedNodeIds.add(sid);
        inDegree[sid] = Infinity;
      });
      normalizedEdges.forEach(edge => {
        if (edge.target === endId && subIds.includes(edge.source)) {
          inDegree[endId] = Math.max(0, (inDegree[endId] || 0) - 1);
        }
      });
      if (!adjList[feNode.id].includes(endId)) {
        adjList[feNode.id].push(endId);
        inDegree[endId] = (inDegree[endId] || 0) + 1;
      }
    }
  }

  const queue: string[] = [];
  nodes.forEach(n => {
    if (inDegree[n.id] === 0 && !forEachManagedNodeIds.has(n.id)) {
      queue.push(n.id);
    }
  });

  const ordered: any[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodes.find(n => n.id === current);
    if (!node || forEachManagedNodeIds.has(current)) continue;
    ordered.push(node);

    (adjList[current] || []).forEach(dep => {
      inDegree[dep]--;
      if (inDegree[dep] === 0 && !forEachManagedNodeIds.has(dep)) {
        queue.push(dep);
      }
    });
  }

  return ordered;
}

function findForEachEndNode(forEachNodeId: string, adjList: Record<string, string[]>, nodes: any[]): string | null {
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodes.find(n => n.id === current);
    if (node?.type === 'forEachEnd') return current;
    for (const next of (adjList[current] || [])) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return null;
}

function getForEachSubgraphNodes(forEachNodeId: string, forEachEndNodeId: string, adjList: Record<string, string[]>, nodes: any[]): string[] {
  const subgraphNodes: string[] = [];
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === forEachEndNodeId) continue;
    subgraphNodes.push(current);
    for (const next of (adjList[current] || [])) {
      if (!visited.has(next) && next !== forEachEndNodeId) queue.push(next);
    }
  }
  return subgraphNodes;
}

function getEffectiveDataSources(nodeId: string, edges: any[], nodes: any[]): string[] {
  const incomingEdges = edges.filter(e => e.target === nodeId);
  const result: string[] = [];
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (!sourceNode) { result.push(edge.source); continue; }
    if (sourceNode.type === 'timer' || sourceNode.type === 'delay') {
      result.push(...getEffectiveDataSources(sourceNode.id, edges, nodes));
    } else if (sourceNode.type !== 'start') {
      result.push(sourceNode.id);
    }
  }
  return [...new Set(result)];
}

// ---------------------------------------------------------------------------
// Template analysis helpers
// ---------------------------------------------------------------------------

function extractTemplatePlaceholders(value: any): string[] {
  if (typeof value !== 'string') {
    return extractTemplatePlaceholders(JSON.stringify(value ?? ''));
  }
  const matches = [...value.matchAll(/\{\{([^}]+)\}\}/g)];
  return matches.map(m => m[1].trim());
}

function getUpstreamNodeIds(nodeId: string, edges: any[], nodes: any[]): Set<string> {
  const upstream = new Set<string>();
  const queue = [nodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    edges.filter(e => e.target === current).forEach(e => {
      if (!visited.has(e.source)) {
        upstream.add(e.source);
        queue.push(e.source);
      }
    });
  }
  return upstream;
}

function isPlaceholderResolvable(placeholder: string, upstreamNodeIds: Set<string>, nodes: any[]): boolean {
  const firstPart = placeholder.split('.')[0].trim();
  if (['_item', '_index', '_total', 'item'].includes(firstPart)) return true;
  return nodes.some(n => n.id === firstPart && upstreamNodeIds.has(firstPart));
}

function detectInteractiveParams(fields: string[], nodeId: string, edges: any[], nodes: any[]): string[] {
  const upstream = getUpstreamNodeIds(nodeId, edges, nodes);
  const unresolvable = new Set<string>();
  for (const field of fields) {
    const placeholders = extractTemplatePlaceholders(field);
    for (const ph of placeholders) {
      if (!isPlaceholderResolvable(ph, upstream, nodes)) {
        unresolvable.add(ph);
      }
    }
  }
  return [...unresolvable];
}

// ---------------------------------------------------------------------------
// Python helper string generators
// ---------------------------------------------------------------------------

function templateToPython(template: string | undefined): string {
  if (!template) return '""';
  if (!template.includes('{{')) return JSON.stringify(template);
  const exactMatch = template.trim().match(/^\{\{([^}]+)\}\}$/);
  if (exactMatch) {
    return contextAccessPython(exactMatch[1].trim());
  }
  return `resolve_template(context, ${JSON.stringify(template)})`;
}

function contextAccessPython(path: string): string {
  const parts = path.split('.');
  if (parts.length === 1) return `context.get(${JSON.stringify(parts[0])})`;
  let acc = `context.get(${JSON.stringify(parts[0])}, {})`;
  for (let i = 1; i < parts.length; i++) {
    acc = `(${acc} or {}).get(${JSON.stringify(parts[i])})`;
  }
  return acc;
}

/** Sanitize a node id to always produce a valid, safe Python variable name */
function pyVarName(nodeId: string): string {
  const sanitized = nodeId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `node_${sanitized}`;
}

function indent(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code.split('\n').map(line => (line.trim() === '' ? '' : pad + line)).join('\n');
}

// ---------------------------------------------------------------------------
// Node code generators
// ---------------------------------------------------------------------------

function generateStartNode(node: any, stepNum: number, total: number): string {
  return [
    `# === [${stepNum}/${total}] Nodo: start - ${node.data?.label || node.id} ===`,
    `logger.info("[${stepNum}/${total}] Inicio del flujo")`,
    `context[${JSON.stringify(node.id)}] = {"msg": "Flow started"}`,
    ''
  ].join('\n');
}

function generateHttpNode(node: any, stepNum: number, total: number, edges: any[], nodes: any[]): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);

  lines.push(`# === [${stepNum}/${total}] Nodo: ${node.type} - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Ejecutando peticion HTTP: ${label}")`);

  let method = (data.method || 'GET').toUpperCase();
  if (node.type === 'httpPost') method = 'POST';

  const endpoint = data.endpoint || '';
  const headers = data.headers || '';
  const body = data.body || '';
  const params = data.params || '';
  const authType = data.authType || '';
  const extractPath = data.extractPath || '';
  const iterateOver = data.iterateOver || '';
  const iterateMode = data.iterateMode || false;

  // Detect interactive params (variables that cannot be resolved upstream)
  const fieldsToCheck = [endpoint, headers, body, params].filter(Boolean);
  const interactiveParams = detectInteractiveParams(fieldsToCheck, node.id, edges, nodes);
  for (const ph of interactiveParams) {
    const safeParamVar = `${varName}_input_${ph.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    lines.push(`${safeParamVar} = input("Ingrese valor para '${ph}': ")`);
    lines.push(`context[${JSON.stringify(ph.split('.')[0])}] = context.get(${JSON.stringify(ph.split('.')[0])}, {})`);
    const parts = ph.split('.');
    if (parts.length === 1) {
      lines.push(`context[${JSON.stringify(parts[0])}] = ${safeParamVar}`);
    }
  }

  // Base headers dict
  lines.push(`${varName}_headers = {"Content-Type": "application/json"}`);
  if (headers && headers.trim()) {
    lines.push(`try:`);
    lines.push(`    _custom_hdrs = json.loads(resolve_template(context, ${JSON.stringify(headers)}))`);
    lines.push(`    if isinstance(_custom_hdrs, dict): ${varName}_headers.update(_custom_hdrs)`);
    lines.push(`except Exception: pass`);
  }

  // Auth
  if (authType === 'bearer') {
    const token = data.authToken || '';
    lines.push(`${varName}_token = ${templateToPython(token)} or os.getenv("HTTP_BEARER_TOKEN", "")`);
    lines.push(`if ${varName}_token:`);
    lines.push(`    ${varName}_headers["Authorization"] = f"Bearer {${varName}_token}"`);
  } else if (authType === 'basic') {
    const user = data.authUsername || '';
    const pwd = data.authPassword || '';
    lines.push(`import base64 as _b64`);
    lines.push(`${varName}_basic_user = ${templateToPython(user)} or os.getenv("HTTP_BASIC_USER", "")`);
    lines.push(`${varName}_basic_pwd = ${templateToPython(pwd)} or os.getenv("HTTP_BASIC_PASSWORD", "")`);
    lines.push(`if ${varName}_basic_user:`);
    lines.push(`    ${varName}_headers["Authorization"] = "Basic " + _b64.b64encode(f"{${varName}_basic_user}:{${varName}_basic_pwd}".encode()).decode()`);
  }

  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method) && body && body.trim();
  const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
  const cleanIterOver = (iterateOver || '').trim();
  const iterExpr = cleanIterOver && cleanIterOver !== '{{ID_NODO}}' && !cleanIterOver.startsWith('{{_item') ? cleanIterOver : null;
  const needsIteration = iterExpr || iterateMode;

  if (needsIteration) {
    lines.push(`${varName}_items = None`);
    if (iterExpr) {
      lines.push(`try:`);
      lines.push(`    ${varName}_items = resolve_template(context, ${JSON.stringify(iterExpr)})`);
      lines.push(`except Exception: pass`);
    }
    lines.push(`if not isinstance(${varName}_items, list) or len(${varName}_items) == 0:`);
    lines.push(`    for _uid in ${JSON.stringify(upstreamIds)}:`);
    lines.push(`        _val = context.get(_uid)`);
    lines.push(`        if isinstance(_val, list) and len(_val) > 0:`);
    lines.push(`            ${varName}_items = _val`);
    lines.push(`            break`);
    lines.push(`if not isinstance(${varName}_items, list):`);
    lines.push(`    ${varName}_items = next((v for v in context.values() if isinstance(v, list) and len(v) > 0), [None])`);

    lines.push(`${varName}_results = []`);
    lines.push(`for _iter_idx, _iter_item in enumerate(${varName}_items):`);
    lines.push(`    _iter_context = {**context, "_item": _iter_item, "_index": _iter_idx, "_total": len(${varName}_items)}`);
    lines.push(`    _iter_headers = dict(${varName}_headers)`);
    lines.push(`    _iter_url = resolve_template(_iter_context, ${JSON.stringify(endpoint)})`);

    if (params && params.trim()) {
      lines.push(`    _iter_params = None`);
      lines.push(`    try:`);
      lines.push(`        _p_raw = resolve_template(_iter_context, ${JSON.stringify(params)})`);
      lines.push(`        _iter_params = json.loads(_p_raw) if isinstance(_p_raw, str) else _p_raw`);
      lines.push(`    except Exception: pass`);
    }

    if (hasBody) {
      lines.push(`    _iter_body = None`);
      lines.push(`    try:`);
      lines.push(`        _b_raw = resolve_template(_iter_context, ${JSON.stringify(body)})`);
      lines.push(`        if isinstance(_b_raw, str):`);
      lines.push(`            try: _iter_body = json.loads(_b_raw)`);
      lines.push(`            except Exception: _iter_body = _b_raw`);
      lines.push(`        else: _iter_body = _b_raw`);
      lines.push(`    except Exception: pass`);
    }

    lines.push(`    try:`);
    lines.push(`        _resp = requests.request(`);
    lines.push(`            ${JSON.stringify(method)},`);
    lines.push(`            _iter_url,`);
    if (params && params.trim()) lines.push(`            params=_iter_params,`);
    lines.push(`            headers=_iter_headers,`);
    if (hasBody) {
      lines.push(`            json=_iter_body if isinstance(_iter_body, (dict, list)) else None,`);
      lines.push(`            data=_iter_body if isinstance(_iter_body, str) else None,`);
    }
    lines.push(`            timeout=30`);
    lines.push(`        )`);
    lines.push(`        _resp.raise_for_status()`);
    lines.push(`        try:`);
    lines.push(`            _resp_data = _resp.json()`);
    lines.push(`        except Exception:`);
    lines.push(`            _resp_data = {"text": _resp.text, "status_code": _resp.status_code}`);

    if (extractPath) {
      lines.push(`        for _k in ${JSON.stringify(extractPath.split('.'))}:`);
      lines.push(`            _resp_data = _resp_data.get(_k, _resp_data) if isinstance(_resp_data, dict) else _resp_data`);
    }
    lines.push(`        ${varName}_results.append(_resp_data)`);
    lines.push(`        logger.info(f"  [{_iter_idx+1}/{len(${varName}_items)}] OK - Status {_resp.status_code}")`);
    lines.push(`    except Exception as e:`);
    lines.push(`        logger.error(f"  [{_iter_idx+1}] ERROR: {e}")`);
    lines.push(`        sys.exit(1)`);

    lines.push(`context[${JSON.stringify(node.id)}] = ${varName}_results`);
  } else {
    // Single execution
    lines.push(`_req_url = resolve_template(context, ${JSON.stringify(endpoint)})`);
    if (params && params.trim()) {
      lines.push(`_req_params = None`);
      lines.push(`try:`);
      lines.push(`    _p_raw = resolve_template(context, ${JSON.stringify(params)})`);
      lines.push(`    _req_params = json.loads(_p_raw) if isinstance(_p_raw, str) else _p_raw`);
      lines.push(`except Exception: pass`);
    }

    if (hasBody) {
      lines.push(`_req_body = None`);
      lines.push(`try:`);
      lines.push(`    _b_raw = resolve_template(context, ${JSON.stringify(body)})`);
      lines.push(`    if isinstance(_b_raw, str):`);
      lines.push(`        try: _req_body = json.loads(_b_raw)`);
      lines.push(`        except Exception: _req_body = _b_raw`);
      lines.push(`    else: _req_body = _b_raw`);
      lines.push(`except Exception: pass`);
    }

    lines.push(`try:`);
    lines.push(`    ${varName}_resp = requests.request(`);
    lines.push(`        ${JSON.stringify(method)},`);
    lines.push(`        _req_url,`);
    if (params && params.trim()) lines.push(`        params=_req_params,`);
    lines.push(`        headers=${varName}_headers,`);
    if (hasBody) {
      lines.push(`        json=_req_body if isinstance(_req_body, (dict, list)) else None,`);
      lines.push(`        data=_req_body if isinstance(_req_body, str) else None,`);
    }
    lines.push(`        timeout=30`);
    lines.push(`    )`);
    lines.push(`    ${varName}_resp.raise_for_status()`);
    lines.push(`    try:`);
    lines.push(`        ${varName}_data = ${varName}_resp.json()`);
    lines.push(`    except Exception:`);
    lines.push(`        ${varName}_data = {"text": ${varName}_resp.text, "status_code": ${varName}_resp.status_code}`);

    if (extractPath) {
      lines.push(`    for _k in ${JSON.stringify(extractPath.split('.'))}:`);
      lines.push(`        ${varName}_data = ${varName}_data.get(_k, ${varName}_data) if isinstance(${varName}_data, dict) else ${varName}_data`);
    }
    lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_data`);
    lines.push(`    logger.info(f"  OK - Status {${varName}_resp.status_code}")`);
    lines.push(`except Exception as e:`);
    lines.push(`    logger.error(f"  ERROR en ${label}: {e}")`);
    lines.push(`    sys.exit(1)`);
  }

  lines.push('');
  return lines.join('\n');
}

function generateQueryNode(
  node: any,
  stepNum: number,
  total: number,
  queryInfo: TranspilerQueryInfo | undefined,
  edges: any[],
  nodes: any[],
  flowName: string,
  sqlFiles: TranspilerSqlFile[]
): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);

  lines.push(`# === [${stepNum}/${total}] Nodo: query - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Ejecutando consulta SQL: ${label}")`);

  if (!queryInfo || !queryInfo.sql_text) {
    lines.push(`# ADVERTENCIA: No se encontro informacion de la consulta SQL configurada en este nodo.`);
    lines.push(`context[${JSON.stringify(node.id)}] = []`);
    lines.push('');
    return lines.join('\n');
  }

  // Create individual SQL file for this query in the queries/ directory
  const querySlug = (label || queryInfo.name || 'query')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  const sqlFileName = `${String(stepNum).padStart(2, '0')}_${querySlug}.sql`;

  const connSummary = (queryInfo.connections || [])
    .map(c => `${c.name} (${c.database_name} @ ${c.host})`)
    .join(', ') || 'Default';

  sqlFiles.push({
    fileName: sqlFileName,
    queryName: queryInfo.name || label,
    nodeLabel: label,
    sql: `-- ==============================================================================
-- Flujo: ${flowName}
-- Paso: [${stepNum}/${total}]
-- Nodo: ${label}
-- Consulta: ${queryInfo.name}
-- Base de Datos: ${connSummary}
-- Generado por OrquestaFlow
-- ==============================================================================

${queryInfo.sql_text}
`
  });

  let queryParamMapping: Record<string, string> = {};
  if (data.queryParams && data.queryParams.trim()) {
    try { queryParamMapping = JSON.parse(data.queryParams); } catch { }
  }

  // Detect #param_name in SQL
  const paramMatches = [...queryInfo.sql_text.matchAll(/(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
  const sqlParams = [...new Set(paramMatches.map(m => m[1]))];

  const upstream = getUpstreamNodeIds(node.id, edges, nodes);
  const interactiveParams: string[] = [];
  for (const p of sqlParams) {
    const mapping = queryParamMapping[p];
    if (!mapping) {
      interactiveParams.push(p);
    } else {
      const placeholders = extractTemplatePlaceholders(mapping);
      const unresolvable = placeholders.filter(ph => !isPlaceholderResolvable(ph, upstream, nodes));
      if (unresolvable.length > 0) interactiveParams.push(p);
    }
  }

  for (const p of interactiveParams) {
    lines.push(`${varName}_param_${p} = input("Ingrese valor para parametro SQL '${p}': ")`);
  }

  lines.push(`${varName}_sql_params = {}`);
  for (const p of sqlParams) {
    if (interactiveParams.includes(p)) {
      lines.push(`${varName}_sql_params[${JSON.stringify(p)}] = ${varName}_param_${p}`);
    } else {
      const mapping = queryParamMapping[p];
      lines.push(`${varName}_sql_params[${JSON.stringify(p)}] = ${templateToPython(mapping)}`);
    }
  }

  // Load SQL query from queries/ folder with fallback to inlined SQL
  lines.push(`# Cargar consulta SQL (${queryInfo.name}) desde archivo queries/${sqlFileName} o fallback`);
  lines.push(`_sql_file = os.path.join(os.path.dirname(__file__), "queries", "${sqlFileName}")`);
  lines.push(`if os.path.exists(_sql_file):`);
  lines.push(`    with open(_sql_file, "r", encoding="utf-8") as _f:`);
  lines.push(`        _raw_sql = _f.read()`);
  lines.push(`else:`);
  lines.push(`    _raw_sql = ${JSON.stringify(queryInfo.sql_text)}`);
  lines.push(`_sql_exec = re.sub(r'#param_[a-zA-Z_][a-zA-Z0-9_]*\\b', '?', _raw_sql)`);

  const connections = queryInfo.connections && queryInfo.connections.length > 0
    ? queryInfo.connections
    : [{
      id: 'default',
      name: 'SQL Server',
      host: 'localhost',
      database_name: '',
      port: 1433,
      env_credential_key: 'SQLSERVER',
      driver: 'ODBC Driver 17 for SQL Server'
    }];

  if (connections.length === 1) {
    const conn = connections[0];
    const envKey = (conn.env_credential_key || 'SQLSERVER').toUpperCase();
    const port = conn.port || 1433;
    const driver = conn.driver || 'ODBC Driver 17 for SQL Server';

    lines.push(`# Configuracion de conexion para: ${conn.name} (${envKey})`);
    lines.push(`_driver_${varName} = os.getenv("DB_DRIVER_${envKey}", "${driver}")`);
    lines.push(`_host_${varName} = os.getenv("DB_HOST_${envKey}", "${conn.host}")`);
    lines.push(`_port_${varName} = os.getenv("DB_PORT_${envKey}", "${port}")`);
    lines.push(`_db_${varName} = os.getenv("DB_NAME_${envKey}", "${conn.database_name}")`);
    lines.push(`_user_${varName} = os.getenv("DB_USER_${envKey}", os.getenv("DB_USER_DEFAULT", ""))`);
    lines.push(`_pwd_${varName} = os.getenv("DB_PASSWORD_${envKey}", os.getenv("DB_PASSWORD_DEFAULT", ""))`);
    lines.push(`_custom_conn_${varName} = os.getenv("DB_CONN_STR_${envKey}", "").strip()`);
    lines.push(`if _custom_conn_${varName} and "UID=;" not in _custom_conn_${varName} and "PWD=;" not in _custom_conn_${varName}:`);
    lines.push(`    ${varName}_conn_str = _custom_conn_${varName}`);
    lines.push(`else:`);
    lines.push(`    ${varName}_conn_str = (`);
    lines.push(`        f"DRIVER={{{_driver_${varName}}}};"`);
    lines.push(`        f"SERVER={_host_${varName}},{_port_${varName}};"`);
    lines.push(`        f"DATABASE={_db_${varName}};"`);
    lines.push(`        f"UID={_user_${varName}};"`);
    lines.push(`        f"PWD={_pwd_${varName}}"`);
    lines.push(`    )`);

    lines.push(`try:`);
    lines.push(`    import pyodbc`);
    lines.push(`    ${varName}_db = pyodbc.connect(${varName}_conn_str)`);
    lines.push(`    ${varName}_cursor = ${varName}_db.cursor()`);

    if (sqlParams.length === 0) {
      lines.push(`    ${varName}_cursor.execute(_sql_exec)`);
    } else {
      const paramList = `[${sqlParams.map(p => `${varName}_sql_params[${JSON.stringify(p)}]`).join(', ')}]`;
      lines.push(`    ${varName}_cursor.execute(_sql_exec, ${paramList})`);
    }

    lines.push(`    ${varName}_cols = [d[0] for d in ${varName}_cursor.description]`);
    lines.push(`    ${varName}_rows = [dict(zip(${varName}_cols, r)) for r in ${varName}_cursor.fetchall()]`);

    const extractMode = data.extractMode || 'all';
    if (extractMode === 'selected_columns') {
      const cols = (data.extractColumns || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      lines.push(`    ${varName}_rows = [{k: r[k] for k in ${JSON.stringify(cols)} if k in r} for r in ${varName}_rows]`);
    }

    lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_rows`);
    lines.push(`    logger.info(f"  OK - {len(${varName}_rows)} filas obtenidas")`);
    lines.push(`    ${varName}_db.close()`);
    lines.push(`except Exception as e:`);
    lines.push(`    logger.error(f"  ERROR en query '${label}': {e}")`);
    lines.push(`    sys.exit(1)`);
  } else {
    // Multi-connection
    lines.push(`${varName}_all_rows = []`);
    for (const conn of connections) {
      const envKey = (conn.env_credential_key || 'SQLSERVER').toUpperCase();
      const port = conn.port || 1433;
      const driver = conn.driver || 'ODBC Driver 17 for SQL Server';

      lines.push(`# Conexion: ${conn.name} (${envKey})`);
      lines.push(`try:`);
      lines.push(`    import pyodbc`);
      lines.push(`    _driver = os.getenv("DB_DRIVER_${envKey}", "${driver}")`);
      lines.push(`    _host = os.getenv("DB_HOST_${envKey}", "${conn.host}")`);
      lines.push(`    _port = os.getenv("DB_PORT_${envKey}", "${port}")`);
      lines.push(`    _db_name = os.getenv("DB_NAME_${envKey}", "${conn.database_name}")`);
      lines.push(`    _user = os.getenv("DB_USER_${envKey}", os.getenv("DB_USER_DEFAULT", ""))`);
      lines.push(`    _pwd = os.getenv("DB_PASSWORD_${envKey}", os.getenv("DB_PASSWORD_DEFAULT", ""))`);
      lines.push(`    _custom_conn = os.getenv("DB_CONN_STR_${envKey}", "").strip()`);
      lines.push(`    if _custom_conn and "UID=;" not in _custom_conn and "PWD=;" not in _custom_conn:`);
      lines.push(`        _conn_str = _custom_conn`);
      lines.push(`    else:`);
      lines.push(`        _conn_str = (`);
      lines.push(`            f"DRIVER={{{_driver}}};"`);
      lines.push(`            f"SERVER={_host},{_port};"`);
      lines.push(`            f"DATABASE={_db_name};"`);
      lines.push(`            f"UID={_user};"`);
      lines.push(`            f"PWD={_pwd}"`);
      lines.push(`        )`);
      lines.push(`    _db = pyodbc.connect(_conn_str)`);
      lines.push(`    _cursor = _db.cursor()`);

      if (sqlParams.length === 0) {
        lines.push(`    _cursor.execute(_sql_exec)`);
      } else {
        const paramList = `[${sqlParams.map(p => `${varName}_sql_params[${JSON.stringify(p)}]`).join(', ')}]`;
        lines.push(`    _cursor.execute(_sql_exec, ${paramList})`);
      }

      lines.push(`    _cols = [d[0] for d in _cursor.description]`);
      lines.push(`    _rows = [dict(zip(_cols, r)) for r in _cursor.fetchall()]`);
      lines.push(`    ${varName}_all_rows.extend(_rows)`);
      lines.push(`    logger.info(f"  OK [${conn.name}] - {len(_rows)} filas")`);
      lines.push(`    _db.close()`);
      lines.push(`except Exception as e:`);
      lines.push(`    logger.error(f"  ERROR en query '${label}' [${conn.name}]: {e}")`);
      lines.push(`    sys.exit(1)`);
    }
    lines.push(`context[${JSON.stringify(node.id)}] = ${varName}_all_rows`);
  }

  lines.push('');
  return lines.join('\n');
}

function generateExportNode(node: any, stepNum: number, total: number, edges: any[], nodes: any[]): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);
  const format = (data.format || 'CSV').toUpperCase();
  const rawFileName = data.fileName || `exportacion_${node.id}`;
  const dataSource = data.dataSource || '';
  const exportMode = data.exportMode || 'single';
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const joins = Array.isArray(data.joins) ? data.joins : [];
  const headerColor = data.headerColor || '#1E293B';

  lines.push(`# === [${stepNum}/${total}] Nodo: export - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Exportando datos: ${label}")`);
  lines.push(`try:`);

  if (dataSource && dataSource.trim()) {
    const exactMatch = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = exactMatch ? exactMatch[1] : dataSource;
    lines.push(`    ${varName}_raw = ${contextAccessPython(pathStr)} or []`);
  } else {
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    if (upstreamIds.length > 0) {
      lines.push(`    ${varName}_raw = context.get(${JSON.stringify(upstreamIds[0])}, [])`);
    } else {
      lines.push(`    ${varName}_raw = next((v for k, v in reversed(list(context.items())) if k != "start" and isinstance(v, list)), [])`);
    }
  }

  lines.push(`    import pandas as _pd`);

  const fileNamePy = templateToPython(rawFileName);
  const isExcel = format === 'EXCEL' || format === 'XLSX';
  const ext = isExcel ? '.xlsx' : '.csv';

  lines.push(`    ${varName}_filename = str(${fileNamePy}).rstrip(".xlsx").rstrip(".csv") + "${ext}"`);

  if (exportMode === 'multi' && isExcel) {
    const multiSheetConfig = (data.multiSheetConfig as Record<string, string>) || {};
    const nodeIds = Object.keys(multiSheetConfig);
    lines.push(`    with _pd.ExcelWriter(${varName}_filename, engine="openpyxl") as _writer:`);
    if (nodeIds.length === 0) {
      lines.push(`        _pd.DataFrame([{"Mensaje": "Sin datos"}]).to_excel(_writer, sheet_name="Datos Vacio", index=False)`);
    } else {
      for (const nid of nodeIds) {
        const sheetName = (multiSheetConfig[nid] || `Hoja_${nid.substring(0, 5)}`).substring(0, 31);
        const uVar = pyVarName(nid);
        lines.push(`        _sheet_raw_${uVar} = context.get(${JSON.stringify(nid)}, [])`);
        lines.push(`        _sheet_records_${uVar} = flatten_rows(_sheet_raw_${uVar})`);
        lines.push(`        _sheet_df_${uVar} = _pd.DataFrame(_sheet_records_${uVar}) if _sheet_records_${uVar} else _pd.DataFrame([{"Mensaje": "Sin registros"}])`);
        lines.push(`        _sheet_df_${uVar}.to_excel(_writer, sheet_name=${JSON.stringify(sheetName)}, index=False)`);
      }
    }
    lines.push(`    format_excel_file(${varName}_filename, header_color=${JSON.stringify(headerColor)})`);
    lines.push(`    ${varName}_total_records = sum(len(flatten_rows(context.get(nid, []))) for nid in ${JSON.stringify(nodeIds)})`);
    lines.push(`    context[${JSON.stringify(node.id)}] = {"filePath": ${varName}_filename, "records": ${varName}_total_records, "success": True}`);
    lines.push(`    logger.info(f"  Archivo guardado: {${varName}_filename} (Multi-hoja)")`);
  } else {
    // Single sheet mode
    lines.push(`    ${varName}_records = process_export_data(${varName}_raw, context, columns=${JSON.stringify(columns)}, joins=${JSON.stringify(joins)})`);
    if (columns.length > 0) {
      const colHeaders = columns.map((c: any) => c.header).filter(Boolean);
      lines.push(`    if len(${varName}_records) == 0:`);
      lines.push(`        ${varName}_df = _pd.DataFrame(columns=${JSON.stringify(colHeaders)})`);
      lines.push(`    else:`);
      lines.push(`        ${varName}_df = _pd.DataFrame(${varName}_records)`);
      lines.push(`        _cols_order = [c for c in ${JSON.stringify(colHeaders)} if c in ${varName}_df.columns]`);
      lines.push(`        if _cols_order:`);
      lines.push(`            ${varName}_df = ${varName}_df[_cols_order]`);
    } else {
      lines.push(`    ${varName}_df = _pd.DataFrame(${varName}_records)`);
    }

    if (isExcel) {
      lines.push(`    ${varName}_df.to_excel(${varName}_filename, index=False, engine="openpyxl")`);
      lines.push(`    format_excel_file(${varName}_filename, header_color=${JSON.stringify(headerColor)})`);
    } else {
      lines.push(`    ${varName}_df.to_csv(${varName}_filename, index=False, encoding="utf-8-sig")`);
    }

    lines.push(`    context[${JSON.stringify(node.id)}] = {"filePath": ${varName}_filename, "records": len(${varName}_df), "success": True}`);
    lines.push(`    logger.info(f"  Archivo guardado: {${varName}_filename} ({len(${varName}_df)} registros)")`);
  }

  lines.push(`except Exception as e:`);
  lines.push(`    logger.error(f"  ERROR en export '${label}': {e}")`);
  lines.push(`    sys.exit(1)`);
  lines.push('');
  return lines.join('\n');
}

function generateDataSourceNode(node: any, stepNum: number, total: number, edges: any[], nodes: any[]): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);
  const mode = data.mode || 'file';
  const nodeIndex = stepNum;

  lines.push(`# === [${stepNum}/${total}] Nodo: dataSource - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Cargando datos: ${label}")`);

  if (mode === 'merge') {
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    lines.push(`# Modo merge: unifica datos de nodos upstream por llave comun (id/code)`);
    lines.push(`${varName}_frames = []`);
    for (const uid of upstreamIds) {
      const uVar = pyVarName(uid);
      lines.push(`_val_${uVar} = context.get(${JSON.stringify(uid)}, [])`);
      lines.push(`if _val_${uVar}:`);
      lines.push(`    import pandas as _pd`);
      lines.push(`    _rows_${uVar} = normalize_for_export(_val_${uVar})`);
      lines.push(`    if _rows_${uVar}:`);
      lines.push(`        ${varName}_frames.append(_pd.DataFrame(_rows_${uVar}))`);
    }
    lines.push(`if len(${varName}_frames) == 0:`);
    lines.push(`    context[${JSON.stringify(node.id)}] = []`);
    lines.push(`else:`);
    lines.push(`    import pandas as _pd`);
    lines.push(`    ${varName}_result = ${varName}_frames[0]`);
    lines.push(`    for _other_df in ${varName}_frames[1:]:`);
    lines.push(`        _left_cols = set(${varName}_result.columns.str.lower())`);
    lines.push(`        _right_cols = set(_other_df.columns.str.lower())`);
    lines.push(`        _common = _left_cols & _right_cols`);
    lines.push(`        _best_key = next((c for c in _common if 'id' in c or 'code' in c), next(iter(_common), None))`);
    lines.push(`        if _best_key:`);
    lines.push(`            _left_key = next(c for c in ${varName}_result.columns if c.lower() == _best_key)`);
    lines.push(`            _right_key = next(c for c in _other_df.columns if c.lower() == _best_key)`);
    lines.push(`            ${varName}_result = ${varName}_result.merge(_other_df, left_on=_left_key, right_on=_right_key, how="left")`);
    lines.push(`        else:`);
    lines.push(`            ${varName}_result = _pd.concat([${varName}_result, _other_df], axis=1)`);
    lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_result.to_dict(orient="records")`);
    lines.push(`    logger.info(f"  OK - {len(${varName}_result)} registros unificados")`);
  } else {
    // File mode
    const rawFilePath = data.filePath || '';
    const envKey = label.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    lines.push(`# El archivo puede pasarse como argumento CLI o variable de entorno FILE_PATH_${envKey}`);
    if (rawFilePath) {
      lines.push(`${varName}_file = os.getenv("FILE_PATH_${envKey}", sys.argv[${nodeIndex}] if len(sys.argv) > ${nodeIndex} else ${JSON.stringify(rawFilePath)})`);
    } else {
      lines.push(`${varName}_file = os.getenv("FILE_PATH_${envKey}", sys.argv[${nodeIndex}] if len(sys.argv) > ${nodeIndex} else None)`);
      lines.push(`if not ${varName}_file:`);
      lines.push(`    ${varName}_file = input("Ingrese la ruta del archivo para '${label}': ")`);
    }
    lines.push(`try:`);
    lines.push(`    import pandas as _pd`);
    lines.push(`    if ${varName}_file.lower().endswith(('.xlsx', '.xls')):`);
    const sheetName = data.sheetName ? JSON.stringify(data.sheetName) : 'None';
    lines.push(`        ${varName}_df = _pd.read_excel(${varName}_file, sheet_name=${sheetName})`);
    lines.push(`    else:`);
    lines.push(`        ${varName}_df = _pd.read_csv(${varName}_file, encoding="utf-8-sig")`);
    lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_df.to_dict(orient="records")`);
    lines.push(`    logger.info(f"  OK - {len(${varName}_df)} registros cargados desde {${varName}_file}")`);
    lines.push(`except Exception as e:`);
    lines.push(`    logger.error(f"  ERROR cargando archivo '${label}': {e}")`);
    lines.push(`    sys.exit(1)`);
  }

  lines.push('');
  return lines.join('\n');
}

function generateDataListNode(node: any, stepNum: number, total: number): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;

  lines.push(`# === [${stepNum}/${total}] Nodo: dataList - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Cargando lista de datos: ${label}")`);

  const itemsStr = data.items || '[]';
  let itemsPython = '[]';
  try {
    const parsed = typeof itemsStr === 'string' ? JSON.parse(itemsStr) : itemsStr;
    itemsPython = JSON.stringify(parsed, null, 2);
  } catch {
    itemsPython = '[]';
  }

  lines.push(`context[${JSON.stringify(node.id)}] = ${itemsPython}`);
  lines.push('');
  return lines.join('\n');
}

function generateTimerNode(node: any, stepNum: number, total: number): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const duration = parseFloat(data.duration || '10') || 10;
  const unit = data.unit || 'seconds';

  let totalSeconds = duration;
  if (unit === 'minutes') totalSeconds = duration * 60;
  else if (unit === 'hours') totalSeconds = duration * 3600;
  totalSeconds = Math.max(1, Math.round(totalSeconds));

  lines.push(`# === [${stepNum}/${total}] Nodo: timer - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Esperando ${totalSeconds} segundos...")`);
  lines.push(`time.sleep(${totalSeconds})`);
  lines.push(`logger.info("  Pausa completada")`);
  lines.push('');
  return lines.join('\n');
}

function generateForEachNode(
  node: any,
  stepNum: number,
  total: number,
  subgraphNodes: any[],
  edges: any[],
  nodes: any[],
  ctx: TranspilerContext,
  flowName: string,
  sqlFiles: TranspilerSqlFile[]
): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);
  const iterateOverExpr = data.iterateOver || '';

  lines.push(`# === [${stepNum}/${total}] Nodo: forEach - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Iniciando bucle forEach: ${label}")`);

  if (iterateOverExpr && iterateOverExpr.trim()) {
    lines.push(`${varName}_items = resolve_template(context, ${JSON.stringify(iterateOverExpr)})`);
    lines.push(`if not isinstance(${varName}_items, list): ${varName}_items = [${varName}_items]`);
  } else {
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    if (upstreamIds.length > 0) {
      lines.push(`${varName}_items = context.get(${JSON.stringify(upstreamIds[0])}, [])`);
      lines.push(`if not isinstance(${varName}_items, list): ${varName}_items = [${varName}_items]`);
    } else {
      lines.push(`${varName}_items = next((v for v in context.values() if isinstance(v, list)), [])`);
    }
  }

  lines.push(`${varName}_results = []`);
  lines.push(`for _index, _item in enumerate(${varName}_items):`);
  lines.push(`    context["_item"] = _item`);
  lines.push(`    context["_index"] = _index`);
  lines.push(`    context["_total"] = len(${varName}_items)`);
  lines.push(`    logger.info(f"  Iteracion {_index+1}/{len(${varName}_items)}")`);

  const subOrdered = buildTopologicalOrder(subgraphNodes, edges.filter(
    e => subgraphNodes.some(n => n.id === e.source) && subgraphNodes.some(n => n.id === e.target)
  ));

  for (let i = 0; i < subOrdered.length; i++) {
    const subNode = subOrdered[i];
    let subCode = '';
    const subStep = `${stepNum}.${i + 1}`;
    switch (subNode.type) {
      case 'httpGet': case 'httpPost': case 'httpRequest':
        subCode = generateHttpNode(subNode, subStep as any, total, edges, nodes);
        break;
      case 'query':
        subCode = generateQueryNode(subNode, subStep as any, total, ctx.queries[subNode.data?.queryId], edges, nodes, flowName, sqlFiles);
        break;
      case 'export':
        subCode = generateExportNode(subNode, subStep as any, total, edges, nodes);
        break;
      case 'dataSource': case 'fileSource':
        subCode = generateDataSourceNode(subNode, subStep as any, total, edges, nodes);
        break;
      case 'dataList':
        subCode = generateDataListNode(subNode, subStep as any, total);
        break;
      case 'timer': case 'delay':
        subCode = generateTimerNode(subNode, subStep as any, total);
        break;
      default:
        subCode = `# Nodo no soportado dentro de forEach: ${subNode.type} (${subNode.id})\n`;
    }
    lines.push(indent(subCode, 4));
  }

  if (subOrdered.length > 0) {
    const lastSubNode = subOrdered[subOrdered.length - 1];
    lines.push(`    _iter_result = context.get(${JSON.stringify(lastSubNode.id)})`);
    lines.push(`    if isinstance(_iter_result, list):`);
    lines.push(`        ${varName}_results.extend([{**(_item if isinstance(_item, dict) else {}), **r} for r in _iter_result])`);
    lines.push(`    elif _iter_result is not None:`);
    lines.push(`        ${varName}_results.append({**(_item if isinstance(_item, dict) else {}), **((_iter_result if isinstance(_iter_result, dict) else {"resultado": _iter_result}))})`);
    lines.push(`    else:`);
    lines.push(`        ${varName}_results.append(_item)`);
  }

  lines.push(`context[${JSON.stringify(node.id)}] = ${varName}_results`);
  lines.push('');
  return lines.join('\n');
}

function generateForEachEndNode(node: any, stepNum: number, total: number, forEachNode: any): string {
  const lines: string[] = [];
  const label = node.data?.label || node.id;

  lines.push(`# === [${stepNum}/${total}] Nodo: forEachEnd - ${label} ===`);
  if (forEachNode) {
    lines.push(`context[${JSON.stringify(node.id)}] = context.get(${JSON.stringify(forEachNode.id)}, [])`);
    lines.push(`logger.info(f"  Bucle completado - {len(context.get(${JSON.stringify(forEachNode.id)}, []))} registros totales")`);
  } else {
    lines.push(`context[${JSON.stringify(node.id)}] = []`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main transpiler entry point
// ---------------------------------------------------------------------------

export function transpileFlowToPython(
  flowName: string,
  definition: { nodes: any[]; edges: any[] },
  ctx: TranspilerContext
): TranspilerOutput {
  const nodes: any[] = definition.nodes || [];
  const edges: any[] = definition.edges || [];
  const sqlFiles: TranspilerSqlFile[] = [];

  const slug = flowName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'flujo';

  if (nodes.length === 0) {
    const emptyScript = `#!/usr/bin/env python3\n# Flujo sin nodos: ${flowName}\nprint("El flujo no tiene nodos configurados.")\n`;
    return {
      script: emptyScript,
      requirementsTxt: 'python-dotenv>=1.0.0\n',
      envExample: '# Sin variables requeridas\n',
      readmeMd: `# ${flowName}\n\nEl flujo no contiene nodos configurados.`,
      sqlFiles: []
    };
  }

  const orderedNodes = buildTopologicalOrder(nodes, edges);

  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};
  nodes.forEach(n => { inDegree[n.id] = 0; adjList[n.id] = []; });
  const normalizedEdges = edges.map(edge => {
    const srcNode = nodes.find(n => n.id === edge.source);
    const tgtNode = nodes.find(n => n.id === edge.target);
    if (srcNode && tgtNode && JSON.stringify(srcNode.data || {}).includes(tgtNode.id)) {
      return { ...edge, source: tgtNode.id, target: srcNode.id };
    }
    return edge;
  });
  normalizedEdges.forEach(edge => {
    if (adjList[edge.source] !== undefined) {
      adjList[edge.source].push(edge.target);
    }
  });

  const forEachEndMap: Record<string, string> = {};
  const forEachNodeForEnd: Record<string, any> = {};
  const forEachSubgraphMap: Record<string, any[]> = {};
  for (const feNode of nodes.filter(n => n.type === 'forEach')) {
    const endId = findForEachEndNode(feNode.id, adjList, nodes);
    if (endId) {
      forEachEndMap[feNode.id] = endId;
      forEachNodeForEnd[endId] = feNode;
      const subIds = getForEachSubgraphNodes(feNode.id, endId, adjList, nodes);
      forEachSubgraphMap[feNode.id] = nodes.filter(n => subIds.includes(n.id));
    }
  }

  const needsRequests = nodes.some(n => ['httpGet', 'httpPost', 'httpRequest'].includes(n.type));
  const needsPyodbc = nodes.some(n => n.type === 'query');
  const needsPandas = nodes.some(n => ['export', 'dataSource', 'fileSource'].includes(n.type));

  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  // 1. Build requirements.txt
  const reqs: string[] = ['python-dotenv>=1.0.0'];
  if (needsRequests) reqs.push('requests>=2.31.0');
  if (needsPyodbc) reqs.push('pyodbc>=5.0.0');
  if (needsPandas) {
    reqs.push('pandas>=2.0.0');
    reqs.push('openpyxl>=3.1.0');
  }
  const requirementsTxt = reqs.join('\n') + '\n';

  // 2. Build .env.example with complete connection settings
  const envLines: string[] = [
    `# ==============================================================================`,
    `# Variables de Entorno para el Flujo: ${flowName}`,
    `# Copie este archivo como '.env' antes de ejecutar el script.`,
    `# ==============================================================================`,
    ''
  ];

  if (needsPyodbc) {
    envLines.push('# ==============================================================================');
    envLines.push('# Configuracion de Bases de Datos (SQL Server)');
    envLines.push('# ==============================================================================');
    const seenKeys = new Set<string>();

    for (const q of Object.values(ctx.queries)) {
      for (const c of (q.connections || [])) {
        const key = (c.env_credential_key || 'SQLSERVER').toUpperCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const driver = c.driver || 'ODBC Driver 17 for SQL Server';
          const port = c.port || 1433;
          envLines.push(`# Conexion: ${c.name} (Clave: ${key})`);
          envLines.push(`DB_HOST_${key}=${c.host}`);
          envLines.push(`DB_NAME_${key}=${c.database_name}`);
          envLines.push(`DB_PORT_${key}=${port}`);
          envLines.push(`DB_DRIVER_${key}=${driver}`);
          envLines.push(`DB_USER_${key}=`);
          envLines.push(`DB_PASSWORD_${key}=`);
          envLines.push(`# Cadena de conexion completa opcional (descomentar solo si se desea usar en lugar de las variables individuales):`);
          envLines.push(`# DB_CONN_STR_${key}=DRIVER={${driver}};SERVER=${c.host},${port};DATABASE=${c.database_name};UID=tu_usuario;PWD=tu_contrasena`);
          envLines.push('');
        }
      }
    }

    if (seenKeys.size === 0) {
      envLines.push('# Conexion SQL Server por defecto');
      envLines.push('DB_HOST_SQLSERVER=localhost');
      envLines.push('DB_NAME_SQLSERVER=');
      envLines.push('DB_PORT_SQLSERVER=1433');
      envLines.push('DB_DRIVER_SQLSERVER=ODBC Driver 17 for SQL Server');
      envLines.push('DB_USER_SQLSERVER=');
      envLines.push('DB_PASSWORD_SQLSERVER=');
      envLines.push('DB_CONN_STR_SQLSERVER=');
      envLines.push('');
    }

    envLines.push('# Credenciales genericas de respaldo:');
    envLines.push('DB_USER_DEFAULT=');
    envLines.push('DB_PASSWORD_DEFAULT=');
    envLines.push('');
  }

  if (needsRequests) {
    envLines.push('# ==============================================================================');
    envLines.push('# Autenticacion HTTP (Tokens / Basic Auth)');
    envLines.push('# ==============================================================================');
    envLines.push('HTTP_BEARER_TOKEN=');
    envLines.push('HTTP_BASIC_USER=');
    envLines.push('HTTP_BASIC_PASSWORD=');
    envLines.push('');
  }

  const fileSourceNodes = nodes.filter(n => ['dataSource', 'fileSource'].includes(n.type) && n.data?.mode !== 'merge');
  if (fileSourceNodes.length > 0) {
    envLines.push('# ==============================================================================');
    envLines.push('# Rutas de archivos locales para nodos de datos');
    envLines.push('# ==============================================================================');
    for (const fsNode of fileSourceNodes) {
      const label = fsNode.data?.label || fsNode.id;
      const envKey = label.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
      envLines.push(`FILE_PATH_${envKey}=`);
    }
    envLines.push('');
  }
  const envExample = envLines.join('\n');

  // 3. Build Script code (collects sqlFiles along the way)
  const parts: string[] = [];

  parts.push(`#!/usr/bin/env python3`);
  parts.push(`"""
Script auto-generado por OrquestaFlow
Flujo: ${flowName}
Generado: ${now}

Dependencias necesarias:
    pip install -r requirements.txt

Variables de entorno requeridas:
    Consulte el archivo .env.example generado con este paquete.

Uso:
    python ${slug}_flow.py [ruta_archivo_1] [ruta_archivo_2] ...
"""

import os
import sys
import json
import time
import logging
import re
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)
`);

  if (needsRequests) {
    parts.push(`try:
    import requests
except ImportError:
    logger.error("Instale requests: pip install requests")
    sys.exit(1)
`);
  }

  // Helper functions
  parts.push(`def resolve_path(context, path_str):
    """Obtiene un valor anidado dentro de un contexto usando notacion de puntos."""
    if not path_str or not isinstance(path_str, str):
        return None
    keys = path_str.strip().split(".")
    val = context
    for k in keys:
        if isinstance(val, dict):
            val = val.get(k)
        elif isinstance(val, list) and k.isdigit():
            idx = int(k)
            val = val[idx] if 0 <= idx < len(val) else None
        else:
            return None
    return val


def resolve_template(context, template_str):
    """Resuelve expresiones {{nodeId.field}} usando el contexto del flujo."""
    if not isinstance(template_str, str):
        return template_str

    m_exact = re.fullmatch(r'\\{\\{([^}]+)\\}\\}', template_str.strip())
    if m_exact:
        val = resolve_path(context, m_exact.group(1))
        if val is not None:
            return val

    def replacer(match):
        val = resolve_path(context, match.group(1))
        if val is None:
            return ""
        return json.dumps(val) if isinstance(val, (dict, list)) else str(val)

    return re.sub(r'\\{\\{([^}]+)\\}\\}', replacer, template_str)


def flatten_rows(data):
    """Aplana estructuras anidadas de respuestas (data, rows, items) replicando el motor de OrquestaFlow."""
    if data is None:
        return []
    if not isinstance(data, list):
        if isinstance(data, dict):
            for key in ['rows', 'data', 'items', 'records', 'result', 'results']:
                if key in data and isinstance(data[key], list):
                    return flatten_rows(data[key])
            if 'data' in data and isinstance(data['data'], dict) and data['data']:
                return [data['data']]
            for val in data.values():
                if isinstance(val, list):
                    return flatten_rows(val)
            return [data]
        return [{"valor": data}]

    result = []
    for item in data:
        if item is None:
            continue
        if isinstance(item, list):
            result.extend(flatten_rows(item))
        elif isinstance(item, dict):
            found_inner = False
            for key in ['data', 'rows', 'items', 'records', 'result', 'results']:
                if key in item and isinstance(item[key], list):
                    result.extend(flatten_rows(item[key]))
                    found_inner = True
                    break
            if not found_inner:
                if 'data' in item and isinstance(item['data'], dict) and item['data']:
                    result.append(dict(item['data']))
                else:
                    result.append(item)
        else:
            result.append({"valor": item})
    return result


normalize_for_export = flatten_rows


def process_export_data(raw_data, context, columns=None, joins=None):
    """Procesa, une (joins) y mapea columnas para exportacion identico al motor OrquestaFlow."""
    base_data_wrapped = []
    if isinstance(raw_data, list):
        for idx, root_item in enumerate(raw_data):
            flat = flatten_rows(root_item)
            for it in flat:
                base_data_wrapped.append({"item": it, "rootIndex": idx})
    else:
        flat = flatten_rows(raw_data)
        for it in flat:
            base_data_wrapped.append({"item": it, "rootIndex": 0})

    base_data = [w["item"] for w in base_data_wrapped]

    # Pre-calcular indices de joins O(1)
    join_lookups = {}
    if joins and isinstance(joins, list):
        for j in joins:
            node_id = j.get("nodeId")
            local_key = j.get("localKey")
            foreign_key = j.get("foreignKey")
            if node_id and local_key and foreign_key:
                target_data = context.get(node_id)
                flat_target = flatten_rows(target_data)
                if flat_target:
                    lookup = {}
                    fk_lower = foreign_key.lower()
                    for r in flat_target:
                        if isinstance(r, dict):
                            actual_key = next((k for k in r.keys() if k.lower() == fk_lower), foreign_key)
                            val = r.get(actual_key)
                            if val is not None:
                                lookup[str(val)] = r
                    join_lookups[node_id] = {
                        "lookup": lookup,
                        "localKey": local_key,
                        "foreignKey": foreign_key
                    }

    export_data = base_data
    if columns and isinstance(columns, list) and len(columns) > 0 and isinstance(base_data, list):
        export_data = []
        for item_idx, wrapped in enumerate(base_data_wrapped):
            item = wrapped["item"]
            row = {}
            # Coincidencias de joins para este item
            joined_matches = {}
            for j_node_id, j_info in join_lookups.items():
                lk_lower = j_info["localKey"].lower()
                actual_lk = next((k for k in item.keys() if k.lower() == lk_lower), j_info["localKey"]) if isinstance(item, dict) else None
                local_val = item.get(actual_lk) if actual_lk and isinstance(item, dict) else None
                if local_val is not None:
                    matched = j_info["lookup"].get(str(local_val))
                    if matched:
                        joined_matches[j_node_id] = matched

            for col in columns:
                c_header = col.get("header")
                c_key = col.get("key")
                if not c_header or not c_key:
                    continue
                if "{{" in c_key and "}}" in c_key:
                    iter_ctx = {**context, "_item": item, "_index": item_idx}
                    val = resolve_template(iter_ctx, c_key)
                else:
                    # 1. Resolver clave por puntos en item
                    val = None
                    if isinstance(item, dict):
                        val = item.get(c_key)
                        if val is None:
                            ck_lower = c_key.lower()
                            actual_k = next((k for k in item.keys() if k.lower() == ck_lower), None)
                            if actual_k:
                                val = item.get(actual_k)
                        if val is None and "." in c_key:
                            curr = item
                            for part in c_key.split("."):
                                if not isinstance(curr, dict):
                                    curr = None
                                    break
                                curr = curr.get(part)
                            val = curr

                    # 2. Buscar en filas coincidentes por joins
                    if val is None:
                        for m_row in joined_matches.values():
                            if isinstance(m_row, dict):
                                if c_key in m_row:
                                    val = m_row[c_key]
                                    break
                                ck_lower = c_key.lower()
                                actual_k = next((k for k in m_row.keys() if k.lower() == ck_lower), None)
                                if actual_k:
                                    val = m_row[actual_k]
                                    break

                    # 3. Fallback: resolver en contexto global
                    if val is None:
                        val = resolve_path(context, c_key)

                row[c_header] = val if val is not None else ""
            export_data.append(row)

    elif join_lookups and isinstance(base_data, list):
        export_data = []
        for item in base_data:
            merged = dict(item) if isinstance(item, dict) else {"valor": item}
            for j_node_id, j_info in join_lookups.items():
                lk_lower = j_info["localKey"].lower()
                actual_lk = next((k for k in item.keys() if k.lower() == lk_lower), j_info["localKey"]) if isinstance(item, dict) else None
                local_val = item.get(actual_lk) if actual_lk and isinstance(item, dict) else None
                if local_val is not None:
                    matched = j_info["lookup"].get(str(local_val))
                    if matched and isinstance(matched, dict):
                        merged.update(matched)
            export_data.append(merged)

    return export_data


def format_excel_file(file_path, header_color=None):
    """Aplica formato visual profesional (colores de cabecera, fuentes, alturas y anchos) identico a OrquestaFlow."""
    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment
        from openpyxl.utils import get_column_letter

        wb = openpyxl.load_workbook(file_path)
        raw_color = (header_color or "1E293B").lstrip("#").upper()
        if len(raw_color) == 3:
            raw_color = "".join(c + c for c in raw_color)
        if not re.match(r'^[0-9A-F]{6}$', raw_color):
            raw_color = "1E293B"

        fill = PatternFill(start_color=raw_color, end_color=raw_color, fill_type="solid")
        font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        alignment = Alignment(vertical="center", horizontal="left")

        for ws in wb.worksheets:
            if ws.max_row >= 1:
                ws.row_dimensions[1].height = 24
                for col_idx, cell in enumerate(ws[1], start=1):
                    cell.fill = fill
                    cell.font = font
                    cell.alignment = alignment
                    col_letter = get_column_letter(col_idx)
                    header_val = str(cell.value or "")
                    ws.column_dimensions[col_letter].width = max(len(header_val) + 4, 16)

                for row_idx in range(2, ws.max_row + 1):
                    ws.row_dimensions[row_idx].height = 18

        wb.save(file_path)
    except Exception as e:
        logger.warning(f"No se pudo aplicar formato visual al Excel: {e}")
`);

  // Main function
  parts.push(`def run_flow():`);
  parts.push(`    context = {}`);
  parts.push(`    logger.info("=" * 50)`);
  parts.push(`    logger.info(f"Iniciando flujo: ${flowName}")`);
  parts.push(`    logger.info("=" * 50)`);
  parts.push(``);

  const total = orderedNodes.length;
  for (let stepNum = 0; stepNum < orderedNodes.length; stepNum++) {
    const node = orderedNodes[stepNum];
    let code = '';
    const step = stepNum + 1;

    switch (node.type) {
      case 'start':
        code = generateStartNode(node, step, total);
        break;
      case 'httpGet': case 'httpPost': case 'httpRequest':
        code = generateHttpNode(node, step, total, edges, nodes);
        break;
      case 'query':
        code = generateQueryNode(node, step, total, ctx.queries[node.data?.queryId], edges, nodes, flowName, sqlFiles);
        break;
      case 'export':
        code = generateExportNode(node, step, total, edges, nodes);
        break;
      case 'dataSource': case 'fileSource':
        code = generateDataSourceNode(node, step, total, edges, nodes);
        break;
      case 'dataList':
        code = generateDataListNode(node, step, total);
        break;
      case 'timer': case 'delay':
        code = generateTimerNode(node, step, total);
        break;
      case 'forEach':
        code = generateForEachNode(
          node, step, total,
          forEachSubgraphMap[node.id] || [],
          edges, nodes, ctx,
          flowName, sqlFiles
        );
        break;
      case 'forEachEnd':
        code = generateForEachEndNode(node, step, total, forEachNodeForEnd[node.id]);
        break;
      case 'scraping':
        code = `# === [${step}/${total}] Nodo: scraping (OMITIDO - no soportado en exportacion Python) ===\n# El nodo de scraping '${node.data?.label || node.id}' requiere configuracion manual.\ncontext[${JSON.stringify(node.id)}] = {}\n\n`;
        break;
      default:
        code = `# === [${step}/${total}] Nodo tipo '${node.type}' no reconocido: ${node.data?.label || node.id} ===\ncontext[${JSON.stringify(node.id)}] = {}\n\n`;
    }

    parts.push(indent(code, 4));
  }

  parts.push(`    logger.info("=" * 50)`);
  parts.push(`    logger.info("Flujo completado exitosamente.")`);
  parts.push(`    logger.info("=" * 50)`);
  parts.push(`    return context`);
  parts.push(``);
  parts.push(`if __name__ == "__main__":`);
  parts.push(`    run_flow()`);
  parts.push(``);

  // 4. Build README.md
  const readmeLines: string[] = [
    `# Flujo: ${flowName}`,
    '',
    `Script en Python generado automaticamente por **OrquestaFlow** el ${now}.`,
    '',
    `## Contenido del Paquete`,
    `- \`${slug}_flow.py\`: Script principal ejecutable que corre el flujo de forma autonoma.`,
    `- \`flow.json\`: Definicion completa del flujo (nodos, conexiones y metadatos).`,
    `- \`requirements.txt\`: Lista de dependencias necesarias.`,
    `- \`.env.example\`: Plantilla con variables de entorno, hosts y cadenas de conexion de base de datos.`,
  ];

  if (sqlFiles.length > 0) {
    readmeLines.push(`- \`queries/\`: Carpeta con los archivos \`.sql\` de cada consulta a base de datos ejecutada por el flujo.`);
  }

  readmeLines.push(
    '',
    `## Requisitos Previos`,
    `- Python 3.9 o superior`,
    needsPyodbc ? `- [ODBC Driver 17 for SQL Server](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server) (o superior) instalado en el sistema` : '',
    '',
    `## Instalacion y Configuracion`,
    '',
    `1. **Crear y activar un entorno virtual (recomendado):**`,
    '   ```bash',
    '   # En Windows:',
    '   python -m venv venv',
    '   .\\venv\\Scripts\\activate',
    '',
    '   # En Linux / macOS:',
    '   python3 -m venv venv',
    '   source venv/bin/activate',
    '   ```',
    '',
    `2. **Instalar dependencias:**`,
    '   ```bash',
    '   pip install -r requirements.txt',
    '   ```',
    '',
    `3. **Configurar variables de entorno y base de datos:**`,
    '   Copia el archivo `.env.example` a `.env`:',
    '   ```bash',
    '   # En Windows:',
    '   copy .env.example .env',
    '',
    '   # En Linux / macOS:',
    '   cp .env.example .env',
    '   ```',
    '   Abre el archivo `.env` para ajustar los servidores (`DB_HOST_*`), nombres de BD (`DB_NAME_*`), usuarios y contrasenas.',
    '',
    `## Ejecucion`,
    '',
    '```bash',
    `python ${slug}_flow.py`,
    '```',
    ''
  );

  if (sqlFiles.length > 0) {
    readmeLines.push(
      '## Consultas SQL del Flujo',
      '',
      'Las consultas ejecutadas por los nodos SQL se encuentran desacopladas en la carpeta `queries/`:',
      '',
      '| Archivo | Consulta | Nodo del Flujo |',
      '|---|---|---|'
    );
    sqlFiles.forEach(sf => {
      readmeLines.push(`| \`queries/${sf.fileName}\` | ${sf.queryName} | ${sf.nodeLabel} |`);
    });
    readmeLines.push('');
  } else {
    readmeLines.push(
      '## Origen de los Datos',
      '',
      'Este flujo no contiene nodos de tipo consulta SQL directa (obtiene o procesa datos a traves de peticiones HTTP, APIs externas o listas de datos estaticas).',
      ''
    );
  }

  if (fileSourceNodes.length > 0) {
    readmeLines.push(
      '## Carga de Archivos Locales',
      '',
      'Puedes pasar las rutas de archivos como argumentos de linea de comandos:',
      '```bash',
      `python ${slug}_flow.py "C:\\ruta\\al\\archivo_1.xlsx"`,
      '```',
      ''
    );
  }

  readmeLines.push('## Estructura de Pasos del Flujo', '');
  readmeLines.push('| Paso | Tipo de Nodo | Etiqueta |');
  readmeLines.push('|---|---|---|');
  orderedNodes.forEach((n, idx) => {
    readmeLines.push(`| ${idx + 1} | \`${n.type}\` | ${n.data?.label || n.id} |`);
  });
  readmeLines.push('');

  const readmeMd = readmeLines.filter(line => line !== undefined).join('\n');

  return {
    script: parts.join('\n'),
    requirementsTxt,
    envExample,
    readmeMd,
    sqlFiles
  };
}
