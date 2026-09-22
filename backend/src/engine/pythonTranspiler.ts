/**
 * pythonTranspiler.ts
 * Convierte la definicion JSON de un flujo de OrquestaFlow a un script Python ejecutable.
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

// ---------------------------------------------------------------------------
// Topological sort (Kahn) – same logic as executor.ts
// ---------------------------------------------------------------------------
function buildTopologicalOrder(nodes: any[], edges: any[]): any[] {
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};

  nodes.forEach(n => {
    inDegree[n.id] = 0;
    adjList[n.id] = [];
  });

  // Normalize edges (same as executor)
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

  // Mark forEach sub-graph nodes so they are inlined inside the forEach block
  const forEachNodes = nodes.filter(n => n.type === 'forEach');
  const forEachManagedNodeIds = new Set<string>();
  const forEachEndMap: Record<string, string> = {}; // forEachNodeId -> forEachEndNodeId

  for (const feNode of forEachNodes) {
    const endId = findForEachEndNode(feNode.id, adjList, nodes);
    if (endId) {
      forEachEndMap[feNode.id] = endId;
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

  // Kahn BFS
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

/** Returns all {{...}} placeholders used in a string or object */
function extractTemplatePlaceholders(value: any): string[] {
  if (typeof value !== 'string') {
    return extractTemplatePlaceholders(JSON.stringify(value ?? ''));
  }
  const matches = [...value.matchAll(/\{\{([^}]+)\}\}/g)];
  return matches.map(m => m[1].trim());
}

/** Returns the set of node IDs that are UPSTREAM of nodeId */
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

/** Given a placeholder like "nodeId.field.subfield", returns true if nodeId is upstream */
function isPlaceholderResolvable(placeholder: string, upstreamNodeIds: Set<string>, nodes: any[]): boolean {
  const firstPart = placeholder.split('.')[0].trim();
  // Special vars that are always available
  if (['_item', '_index', '_total', 'item'].includes(firstPart)) return true;
  // Check if it maps to an upstream node
  return nodes.some(n => n.id === firstPart && upstreamNodeIds.has(firstPart));
}

/** Detect unresolvable placeholders in a string. Returns list of variable names to ask via input() */
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
// Python template resolution code generator
// ---------------------------------------------------------------------------

/** Converts a {{nodeId.field}} template string to a Python f-string or resolve_template() call */
function templateToPython(template: string | undefined): string {
  if (!template) return '""';
  if (!template.includes('{{')) return JSON.stringify(template);
  // Single exact match: {{nodeId.field}} -> direct dict access
  const exactMatch = template.trim().match(/^\{\{([^}]+)\}\}$/);
  if (exactMatch) {
    return contextAccessPython(exactMatch[1].trim());
  }
  // Mixed string: use resolve_template()
  return `resolve_template(context, ${JSON.stringify(template)})`;
}

/** Converts "nodeId.field.sub" to context["nodeId"]["field"]["sub"] (with safe get) */
function contextAccessPython(path: string): string {
  const parts = path.split('.');
  if (parts.length === 1) return `context.get(${JSON.stringify(parts[0])})`;
  let acc = `context.get(${JSON.stringify(parts[0])}, {})`;
  for (let i = 1; i < parts.length; i++) {
    acc = `(${acc} or {}).get(${JSON.stringify(parts[i])})`;
  }
  return acc;
}

/** Sanitize a node id to be a valid python variable name */
function pyVarName(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9_]/g, '_');
}

// ---------------------------------------------------------------------------
// Node code generators
// ---------------------------------------------------------------------------

function indent(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code.split('\n').map(line => (line.trim() === '' ? '' : pad + line)).join('\n');
}

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

  // Detect interactive params
  const fieldsToCheck = [endpoint, headers, body, params].filter(Boolean);
  const interactiveParams = detectInteractiveParams(fieldsToCheck, node.id, edges, nodes);
  for (const ph of interactiveParams) {
    const safeVarName = pyVarName(ph.replace(/\./g, '_'));
    lines.push(`${varName}_param_${safeVarName} = input("Ingrese valor para '${ph}': ")`);
    lines.push(`context[${JSON.stringify(ph.split('.')[0])}] = context.get(${JSON.stringify(ph.split('.')[0])}, {})`);
    // Inject into context path
    const parts = ph.split('.');
    if (parts.length === 1) {
      lines.push(`context[${JSON.stringify(parts[0])}] = ${varName}_param_${safeVarName}`);
    }
  }

  // Build headers dict
  lines.push(`${varName}_headers = {"Content-Type": "application/json"}`);
  if (headers && headers.trim()) {
    lines.push(`try:`);
    lines.push(`    ${varName}_headers.update(json.loads(resolve_template(context, ${JSON.stringify(headers)})))`);
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

  // Build URL with query params
  lines.push(`${varName}_url = resolve_template(context, ${JSON.stringify(endpoint)})`);
  if (params && params.trim()) {
    lines.push(`try:`);
    lines.push(`    ${varName}_qparams = json.loads(resolve_template(context, ${JSON.stringify(params)}))`);
    lines.push(`    from urllib.parse import urlencode, urlparse, urlunparse, parse_qs`);
    lines.push(`    _parsed = urlparse(${varName}_url)`);
    lines.push(`    ${varName}_url = urlunparse(_parsed._replace(query=urlencode(${varName}_qparams)))`);
    lines.push(`except Exception: pass`);
  }

  // Body
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method) && body && body.trim();
  if (hasBody) {
    lines.push(`${varName}_body = resolve_template(context, ${JSON.stringify(body)})`);
    lines.push(`if isinstance(${varName}_body, str):`);
    lines.push(`    try: ${varName}_body = json.loads(${varName}_body)`);
    lines.push(`    except Exception: pass`);
  }

  // Determine iteration
  const iterExpr = iterateOver && iterateOver.trim() && iterateOver.trim() !== '{{ID_NODO}}' ? iterateOver : null;
  const needsIteration = iterExpr || iterateMode;

  if (needsIteration) {
    lines.push(`${varName}_items = resolve_template(context, ${JSON.stringify(iterExpr || '')}) if ${JSON.stringify(iterExpr || '')} else None`);
    lines.push(`if not isinstance(${varName}_items, list):`);
    lines.push(`    ${varName}_items = next((v for v in context.values() if isinstance(v, list)), [None])`);
    lines.push(`${varName}_results = []`);
    lines.push(`for _iter_idx, _iter_item in enumerate(${varName}_items):`);
    lines.push(`    _iter_context = {**context, "_item": _iter_item, "_index": _iter_idx, "_total": len(${varName}_items)}`);
    lines.push(`    try:`);
    lines.push(`        _resp = requests.request(`);
    lines.push(`            ${JSON.stringify(method)},`);
    lines.push(`            resolve_template(_iter_context, ${JSON.stringify(endpoint)}),`);
    lines.push(`            headers=${varName}_headers,`);
    if (hasBody) lines.push(`            json=resolve_template(_iter_context, ${JSON.stringify(body)}),`);
    lines.push(`            timeout=30`);
    lines.push(`        )`);
    lines.push(`        _resp.raise_for_status()`);
    if (extractPath) {
      lines.push(`        _data = _resp.json()`);
      lines.push(`        for _k in ${JSON.stringify(extractPath.split('.'))}: _data = _data.get(_k, _data) if isinstance(_data, dict) else _data`);
      lines.push(`        ${varName}_results.append(_data)`);
    } else {
      lines.push(`        ${varName}_results.append(_resp.json())`);
    }
    lines.push(`        logger.info(f"  [{_iter_idx+1}/{len(${varName}_items)}] OK - Status {_resp.status_code}")`);
    lines.push(`    except Exception as e:`);
    lines.push(`        logger.error(f"  [{_iter_idx+1}] ERROR: {e}")`);
    lines.push(`        sys.exit(1)`);
    lines.push(`context[${JSON.stringify(node.id)}] = ${varName}_results`);
  } else {
    lines.push(`try:`);
    lines.push(`    ${varName}_resp = requests.request(`);
    lines.push(`        ${JSON.stringify(method)},`);
    lines.push(`        ${varName}_url,`);
    lines.push(`        headers=${varName}_headers,`);
    if (hasBody) lines.push(`        json=${varName}_body,`);
    lines.push(`        timeout=30`);
    lines.push(`    )`);
    lines.push(`    ${varName}_resp.raise_for_status()`);
    if (extractPath) {
      lines.push(`    ${varName}_data = ${varName}_resp.json()`);
      lines.push(`    for _k in ${JSON.stringify(extractPath.split('.'))}: ${varName}_data = ${varName}_data.get(_k, ${varName}_data) if isinstance(${varName}_data, dict) else ${varName}_data`);
      lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_data`);
    } else {
      lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_resp.json()`);
    }
    lines.push(`    logger.info(f"  OK - Status {${varName}_resp.status_code}")`);
    lines.push(`except Exception as e:`);
    lines.push(`    logger.error(f"  ERROR en ${label}: {e}")`);
    lines.push(`    sys.exit(1)`);
  }

  lines.push('');
  return lines.join('\n');
}

function generateQueryNode(node: any, stepNum: number, total: number, queryInfo: TranspilerQueryInfo | undefined, edges: any[], nodes: any[]): string {
  const lines: string[] = [];
  const data = node.data || {};
  const label = data.label || node.id;
  const varName = pyVarName(node.id);

  lines.push(`# === [${stepNum}/${total}] Nodo: query - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Ejecutando consulta SQL: ${label}")`);

  if (!queryInfo) {
    lines.push(`# ADVERTENCIA: No se encontro informacion de la query configurada en este nodo.`);
    lines.push(`context[${JSON.stringify(node.id)}] = []`);
    lines.push('');
    return lines.join('\n');
  }

  // Parse SQL params defined on the node or query
  let queryParamMapping: Record<string, string> = {};
  if (data.queryParams && data.queryParams.trim()) {
    try { queryParamMapping = JSON.parse(data.queryParams); } catch { }
  }

  // Detect #param_name in SQL
  const paramMatches = [...queryInfo.sql_text.matchAll(/(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
  const sqlParams = [...new Set(paramMatches.map(m => m[1]))];

  // Interactive params: those without a mapping to context
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

  // Build params dict
  lines.push(`${varName}_sql_params = {}`);
  for (const p of sqlParams) {
    if (interactiveParams.includes(p)) {
      lines.push(`${varName}_sql_params[${JSON.stringify(p)}] = ${varName}_param_${p}`);
    } else {
      const mapping = queryParamMapping[p];
      lines.push(`${varName}_sql_params[${JSON.stringify(p)}] = ${templateToPython(mapping)}`);
    }
  }

  // Convert #param_name to ? for pyodbc
  const pythonSql = queryInfo.sql_text.replace(/#param_([a-zA-Z_][a-zA-Z0-9_]*)/g, '?');

  // Generate connection and execution per connection
  if (queryInfo.connections.length === 1) {
    const conn = queryInfo.connections[0];
    const envKey = (conn.env_credential_key || 'SQLSERVER').toUpperCase();
    lines.push(`${varName}_conn_str = (`);
    lines.push(`    f"DRIVER={{${conn.driver || 'ODBC Driver 17 for SQL Server'}}};"`);
    lines.push(`    f"SERVER=${conn.host},{conn.port || 1433};"`);
    lines.push(`    f"DATABASE=${conn.database_name};"`);
    lines.push(`    f"UID={os.getenv('DB_USER_${envKey}', os.getenv('DB_USER_DEFAULT', ''))};"`);
    lines.push(`    f"PWD={os.getenv('DB_PASSWORD_${envKey}', os.getenv('DB_PASSWORD_DEFAULT', ''))}"`);
    lines.push(`)`);
    lines.push(`try:`);
    lines.push(`    import pyodbc`);
    lines.push(`    ${varName}_db = pyodbc.connect(${varName}_conn_str)`);
    lines.push(`    ${varName}_cursor = ${varName}_db.cursor()`);
    lines.push(`    ${varName}_cursor.execute(${JSON.stringify(pythonSql)}, list(${varName}_sql_params.values()))`);
    lines.push(`    ${varName}_cols = [d[0] for d in ${varName}_cursor.description]`);
    lines.push(`    ${varName}_rows = [dict(zip(${varName}_cols, r)) for r in ${varName}_cursor.fetchall()]`);

    // extractMode
    const extractMode = data.extractMode || 'all';
    if (extractMode === 'selected_columns') {
      const cols = (data.extractColumns || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      lines.push(`    ${varName}_rows = [{k: r[k] for k in ${JSON.stringify(cols)} if k in r} for r in ${varName}_rows]`);
    }

    lines.push(`    context[${JSON.stringify(node.id)}] = ${varName}_rows`);
    lines.push(`    logger.info(f"  OK - {len(${varName}_rows)} filas")`);
    lines.push(`    ${varName}_db.close()`);
    lines.push(`except Exception as e:`);
    lines.push(`    logger.error(f"  ERROR en query '${label}': {e}")`);
    lines.push(`    sys.exit(1)`);
  } else {
    // Multiple connections: collect all results
    lines.push(`${varName}_all_rows = []`);
    for (const conn of queryInfo.connections) {
      const envKey = (conn.env_credential_key || 'SQLSERVER').toUpperCase();
      lines.push(`# Conexion: ${conn.name} (${conn.host})`);
      lines.push(`try:`);
      lines.push(`    import pyodbc`);
      lines.push(`    _conn_str = (`);
      lines.push(`        f"DRIVER={{${conn.driver || 'ODBC Driver 17 for SQL Server'}}};"`);
      lines.push(`        f"SERVER=${conn.host},{conn.port || 1433};"`);
      lines.push(`        f"DATABASE=${conn.database_name};"`);
      lines.push(`        f"UID={os.getenv('DB_USER_${envKey}', os.getenv('DB_USER_DEFAULT', ''))};"`);
      lines.push(`        f"PWD={os.getenv('DB_PASSWORD_${envKey}', os.getenv('DB_PASSWORD_DEFAULT', ''))}"`);
      lines.push(`    )`);
      lines.push(`    _db = pyodbc.connect(_conn_str)`);
      lines.push(`    _cursor = _db.cursor()`);
      lines.push(`    _cursor.execute(${JSON.stringify(pythonSql)}, list(${varName}_sql_params.values()))`);
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
  const fileName = data.fileName || `exportacion_${node.id}`;
  const dataSource = data.dataSource || '';

  lines.push(`# === [${stepNum}/${total}] Nodo: export - ${label} ===`);
  lines.push(`logger.info("[${stepNum}/${total}] Exportando datos: ${label}")`);
  lines.push(`try:`);

  // Resolve data source
  if (dataSource && dataSource.trim()) {
    const exactMatch = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = exactMatch ? exactMatch[1] : dataSource;
    lines.push(`    ${varName}_data = ${contextAccessPython(pathStr)} or []`);
  } else {
    // Use last non-start upstream node
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    if (upstreamIds.length > 0) {
      lines.push(`    ${varName}_data = context.get(${JSON.stringify(upstreamIds[0])}, [])`);
    } else {
      lines.push(`    ${varName}_data = next((v for k, v in reversed(list(context.items())) if k != "start" and isinstance(v, list)), [])`);
    }
  }

  lines.push(`    import pandas as _pd`);
  lines.push(`    ${varName}_df = _pd.DataFrame(${varName}_data) if isinstance(${varName}_data, list) else _pd.DataFrame([${varName}_data])`);

  const fileNamePy = templateToPython(fileName);
  if (format === 'EXCEL' || format === 'XLSX') {
    lines.push(`    ${varName}_filename = str(${fileNamePy}).rstrip(".xlsx") + ".xlsx"`);
    lines.push(`    ${varName}_df.to_excel(${varName}_filename, index=False)`);
  } else {
    lines.push(`    ${varName}_filename = str(${fileNamePy}).rstrip(".csv") + ".csv"`);
    lines.push(`    ${varName}_df.to_csv(${varName}_filename, index=False, encoding="utf-8-sig")`);
  }

  lines.push(`    context[${JSON.stringify(node.id)}] = {"filePath": ${varName}_filename, "records": len(${varName}_df), "success": True}`);
  lines.push(`    logger.info(f"  Archivo guardado: {${varName}_filename} ({len(${varName}_df)} registros)")`);
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
    // Smart Relational Join in Python using pandas
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    lines.push(`# Modo merge: unifica datos de nodos upstream por llave comun (id/code)`);
    lines.push(`${varName}_frames = []`);
    for (const uid of upstreamIds) {
      lines.push(`_val_${pyVarName(uid)} = context.get(${JSON.stringify(uid)}, [])`);
      lines.push(`if _val_${pyVarName(uid)}:`);
      lines.push(`    import pandas as _pd`);
      lines.push(`    _rows_${pyVarName(uid)} = _val_${pyVarName(uid)} if isinstance(_val_${pyVarName(uid)}, list) else [_val_${pyVarName(uid)}]`);
      lines.push(`    ${varName}_frames.append(_pd.DataFrame(_rows_${pyVarName(uid)}))`);
    }
    lines.push(`if len(${varName}_frames) == 0:`);
    lines.push(`    context[${JSON.stringify(node.id)}] = []`);
    lines.push(`else:`);
    lines.push(`    import pandas as _pd`);
    lines.push(`    ${varName}_result = ${varName}_frames[0]`);
    lines.push(`    for _other_df in ${varName}_frames[1:]:`);
    lines.push(`        # Buscar llave comun priorizando campos con 'id' o 'code'`);
    lines.push(`        _left_cols = set(${varName}_result.columns.str.lower())`);
    lines.push(`        _right_cols = set(_other_df.columns.str.lower())`);
    lines.push(`        _common = _left_cols & _right_cols`);
    lines.push(`        _best_key = next((c for c in _common if 'id' in c or 'code' in c), next(iter(_common), None))`);
    lines.push(`        if _best_key:`);
    lines.push(`            _left_key = next(c for c in ${varName}_result.columns if c.lower() == _best_key)`);
    lines.push(`            _right_key = next(c for c in _other_df.columns if c.lower() == _best_key)`);
    lines.push(`            ${varName}_result = ${varName}_result.merge(_other_df, left_on=_left_key, right_on=_right_key, how="left")`);
    lines.push(`        else:`);
    lines.push(`            # Fallback: union por indice`);
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
  ctx: TranspilerContext
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
    // Auto-detect: first array in upstream context
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

  // Generate subgraph nodes indented inside the for loop
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
        subCode = generateQueryNode(subNode, subStep as any, total, ctx.queries[subNode.data?.queryId], edges, nodes);
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

  // Collect results from terminal subgraph node
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
  const feVarName = forEachNode ? pyVarName(forEachNode.id) : pyVarName(node.id);

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

export interface TranspilerOutput {
  script: string;
}

export function transpileFlowToPython(
  flowName: string,
  definition: { nodes: any[]; edges: any[] },
  ctx: TranspilerContext
): TranspilerOutput {
  const nodes: any[] = definition.nodes || [];
  const edges: any[] = definition.edges || [];

  if (nodes.length === 0) {
    return {
      script: `#!/usr/bin/env python3\n# Flujo sin nodos: ${flowName}\nprint("El flujo no tiene nodos configurados.")\n`
    };
  }

  const orderedNodes = buildTopologicalOrder(nodes, edges);

  // Build forEach sub-graph maps
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

  // Determine which env vars are needed
  const needsRequests = nodes.some(n => ['httpGet', 'httpPost', 'httpRequest'].includes(n.type));
  const needsPyodbc = nodes.some(n => n.type === 'query');
  const needsPandas = nodes.some(n => ['export', 'dataSource', 'fileSource'].includes(n.type));

  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  // Build script
  const parts: string[] = [];

  // Header
  parts.push(`#!/usr/bin/env python3`);
  parts.push(`"""
Script auto-generado por OrquestaFlow
Flujo: ${flowName}
Generado: ${now}

Dependencias necesarias:
    pip install python-dotenv${needsRequests ? ' requests' : ''}${needsPyodbc ? ' pyodbc' : ''}${needsPandas ? ' pandas openpyxl' : ''}

Variables de entorno requeridas (crear archivo .env):
${needsPyodbc ? Object.values(ctx.queries).flatMap(q => q.connections).map(c => {
    const key = (c.env_credential_key || 'SQLSERVER').toUpperCase();
    return `    DB_USER_${key}=<usuario>\n    DB_PASSWORD_${key}=<contrasena>`;
  }).filter((v, i, a) => a.indexOf(v) === i).join('\n') : '    (Sin conexiones de base de datos)'}

Uso:
    python ${flowName.toLowerCase().replace(/\s+/g, '_')}_flow.py [ruta_archivo_1] [ruta_archivo_2] ...
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

  // Conditional imports
  if (needsRequests) {
    parts.push(`try:
    import requests
except ImportError:
    logger.error("Instale requests: pip install requests")
    sys.exit(1)
`);
  }

  // Helper functions
  parts.push(`def resolve_template(context, template_str):
    """Resuelve expresiones {{nodeId.field}} usando el contexto del flujo."""
    if not isinstance(template_str, str):
        return template_str
    def replacer(match):
        path = match.group(1).strip()
        keys = path.split(".")
        val = context
        for k in keys:
            if isinstance(val, dict):
                val = val.get(k)
            else:
                return match.group(0)
        if val is None:
            return ""
        return json.dumps(val) if isinstance(val, (dict, list)) else str(val)
    return re.sub(r'\\{\\{([^}]+)\\}\\}', replacer, template_str)
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
        code = generateQueryNode(node, step, total, ctx.queries[node.data?.queryId], edges, nodes);
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
          edges, nodes, ctx
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

  return { script: parts.join('\n') };
}
