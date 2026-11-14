import { FastifyInstance } from 'fastify';
import { encryptSecret } from '../engine/secrets.js';
import { openDefinition, sealDefinition, stripNodeSecrets, withOpenDefinition } from '../engine/nodeSecrets.js';
import { isUnsafeSqlitePath } from '../security/access.js';
import crypto from 'crypto';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import {
  ExecutionTracer,
  startExecutionLog,
  finishExecutionLog,
  summarizeContext,
  isCancellationError,
  type ExecutionStatus,
} from '../engine/executionLog.js';
import { loadRunCache, saveRunCache, deleteRunCache, findMissingInputs, withoutIterationKeys } from '../engine/runCache.js';
import { normalizeEdges, findForEachEndNode, getForEachSubgraphNodes } from '../engine/graph.js';

type ProgressStatus = 'running' | 'completed' | 'error' | 'progress' | 'paused';

// True when some of the nodes to run are inside a forEach that is not part of the run
function runsLoopBodyAlone(ids: string[], nodes: any[], edges: any[]): boolean {
  const adjList: Record<string, string[]> = {};
  for (const e of edges) (adjList[e.source] ||= []).push(e.target);
  return nodes.some(n => {
    if (n.type !== 'forEach' || ids.includes(n.id)) return false;
    const endId = findForEachEndNode(n.id, adjList, nodes);
    return endId !== null && getForEachSubgraphNodes(n.id, endId, adjList, nodes).some(id => ids.includes(id));
  });
}

// Outputs by node id and also by label, as the engine keeps them in its context
function withLabels(outputs: Record<string, any>, flow: any): Record<string, any> {
  const context = { ...outputs };
  try {
    for (const node of JSON.parse(flow.definition || '{}').nodes || []) {
      if (outputs[node.id] !== undefined && typeof node.data?.label === 'string' && node.data.label) {
        context[node.data.label] = outputs[node.id];
      }
    }
  } catch {
    // invalid definition: ids only
  }
  return context;
}

function maskAuthHeaderValue(val: unknown): string {
  const s = String(val ?? '');
  if (/^Bearer\s+/i.test(s)) return 'Bearer ***';
  if (/^Basic\s+/i.test(s)) return 'Basic ***';
  return s ? '***' : '';
}

function sanitizeProgressResult(result: any): any {
  const preview = result?.requestPreview;
  if (!preview || typeof preview !== 'object' || !preview.headers || typeof preview.headers !== 'object') {
    return result;
  }
  let changed = false;
  const headers: Record<string, unknown> = { ...preview.headers };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key') {
      headers[key] = maskAuthHeaderValue(headers[key]);
      changed = true;
    }
  }
  return changed ? { ...result, requestPreview: { ...preview, headers } } : result;
}

function withOpenFlow<T extends { definition?: unknown; published_definition?: unknown; published_version_id?: unknown }>(row: T): T {
  const opened = withOpenDefinition(row);
  if (!opened || typeof opened !== 'object') return opened;
  const next: any = { ...opened, published_version_id: opened.published_version_id ?? null };
  if (typeof opened.published_definition === 'string') {
    next.published_definition = openDefinition(opened.published_definition);
  }
  return next;
}

async function safeIo() {
  try {
    const { getIo } = await import('../engine/socket.js');
    return getIo();
  } catch {
    return { emit: () => false };
  }
}

// Relays engine progress to the editor and announces exported files as soon as each one is ready
function createProgressEmitter(io: any, flowId: string) {
  const exportedFiles: any[] = [];
  const skippedNodeIds: string[] = [];
  // Outputs of the nodes that finished, kept so a failed run still leaves its results for a partial rerun
  const outputs: Record<string, any> = {};
  const emit = (nodeId: string, status: ProgressStatus, result?: any) => {
    const safeResult = sanitizeProgressResult(result);
    io.emit('flow-progress', {
      flowId,
      nodeId,
      status,
      result: safeResult,
      current: safeResult?.current,
      total: safeResult?.total,
      remainingSeconds: safeResult?.remainingSeconds,
      totalSeconds: safeResult?.totalSeconds,
      context: safeResult?.context
    });

    if (status === 'completed' && result?.skipped) skippedNodeIds.push(nodeId);
    else if (status === 'completed' && result !== undefined) outputs[nodeId] = result;

    // Emit export ready immediately when an export node finishes, so files download without waiting for other branches
    if (status === 'completed' && result?.filePath && result?.success) {
      const fileName = result.filePath.split(/[/\\]/).pop();
      const info = {
        nodeId,
        fileName,
        downloadUrl: `/api/files/${fileName}`,
        records: result.records,
        format: result.format,
        filePath: result.filePath,
        previewRows: result.previewRows,
        headers: result.headers
      };
      exportedFiles.push(info);
      io.emit('flow-export-ready', { flowId, ...info });
    }
  };
  return { emit, exportedFiles, skippedNodeIds, outputs };
}

export async function flowRoutes(app: FastifyInstance): Promise<void> {
  // List all flows
  app.get('/', async () => {
    const db = getDb();
    const flows = db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all() as any[];
    return { data: flows.map(withOpenFlow) };
  });

  // Get single flow
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    return { data: withOpenFlow(flow) };
  });

  // Create flow
  app.post<{ Body: { name: string; description?: string; definition?: string; is_locked?: number } }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { name, description = '', definition = '{"nodes":[],"edges":[]}', is_locked = 0 } = request.body;

    db.prepare(`
      INSERT INTO flows (id, name, description, definition, is_locked)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description, sealDefinition(typeof definition === 'object' ? JSON.stringify(definition) : definition), is_locked);

    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(id) as any;
    return { data: withOpenFlow(flow) };
  });

  // Import flow from JSON bundle or legacy format
  app.post<{
    Body: {
      name?: string;
      description?: string;
      definition?: any;
      flow?: { name?: string; description?: string; definition?: any };
      queries?: Array<{
        id: string;
        name: string;
        group_name?: string | null;
        region?: string | null;
        sql_text: string;
        params?: any;
        connection_ids?: any;
        display_columns?: any;
      }>;
      connections?: Array<{
        id: string;
        name: string;
        group_name?: string | null;
        region?: string | null;
        city?: string | null;
        host: string;
        database_name?: string;
        port?: number;
        driver?: string;
        env_credential_key?: string | null;
        username?: string;
        password?: string;
      }>;
      nodes?: any[];
      edges?: any[];
    };
  }>('/import', async (request, reply) => {
    const db = getDb();
    const body = request.body || {};

    // 1. Resolve flow metadata & definition
    const flowName = body.name || body.flow?.name || 'Flujo importado';
    const flowDesc = body.description || body.flow?.description || '';
    const rawDefinition = body.definition || body.flow?.definition;

    let definitionObj: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
    if (rawDefinition) {
      if (typeof rawDefinition === 'string') {
        try {
          definitionObj = JSON.parse(rawDefinition);
        } catch {
          definitionObj = { nodes: [], edges: [] };
        }
      } else if (typeof rawDefinition === 'object' && rawDefinition !== null) {
        definitionObj = rawDefinition;
      }
    } else if (Array.isArray(body.nodes)) {
      definitionObj = {
        nodes: body.nodes,
        edges: Array.isArray(body.edges) ? body.edges : []
      };
    }

    if (!Array.isArray(definitionObj.nodes)) definitionObj.nodes = [];
    if (!Array.isArray(definitionObj.edges)) definitionObj.edges = [];

    // 2. Process connections
    const rawConnections = body.connections || [];
    const connectionIdMap = new Map<string, string>(); // oldId -> localId
    const createdConnections: Array<{ id: string; name: string; host: string; database_name: string }> = [];
    const reusedConnections: Array<{ id: string; name: string; host: string; database_name: string }> = [];

    for (const conn of rawConnections) {
      if (!conn.host) continue;
      if (String(conn.driver || '').trim().toLowerCase() === 'sqlite' && isUnsafeSqlitePath(conn.host)) {
        return reply.status(400).send({ error: 'Ruta SQLite no permitida en la conexión importada (no se admite ".." ni apuntar a orquesta.sqlite)' });
      }

      // Check if connection already exists by ID or host + database_name
      let existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(conn.id) as any;
      if (!existing && conn.host && conn.database_name) {
        existing = db.prepare('SELECT * FROM connections WHERE host = ? AND database_name = ?').get(conn.host, conn.database_name) as any;
      }

      if (existing) {
        connectionIdMap.set(conn.id, existing.id);
        reusedConnections.push({
          id: existing.id,
          name: existing.name,
          host: existing.host,
          database_name: existing.database_name
        });
      } else {
        const newConnId = uuid();
        connectionIdMap.set(conn.id, newConnId);
        db.prepare(`
          INSERT INTO connections (id, name, group_name, region, city, host, database_name, port, driver, username, password, env_credential_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newConnId,
          conn.name || `Conexión ${conn.database_name || conn.host}`,
          conn.group_name || null,
          conn.region || 'Default',
          conn.city || null,
          conn.host,
          conn.database_name || '',
          conn.port || 1433,
          conn.driver || 'ODBC Driver 17 for SQL Server',
          conn.username || '',
          encryptSecret(conn.password),
          conn.env_credential_key || null
        );

        createdConnections.push({
          id: newConnId,
          name: conn.name || `Conexión ${conn.database_name || conn.host}`,
          host: conn.host,
          database_name: conn.database_name || ''
        });
      }
    }

    // 3. Process queries
    const rawQueries = body.queries || [];
    const queryIdMap = new Map<string, string>(); // oldQueryId -> localQueryId
    const createdQueries: Array<{ id: string; name: string }> = [];
    const reusedQueries: Array<{ id: string; name: string }> = [];

    for (const q of rawQueries) {
      if (!q.sql_text) continue;

      // Remap connection_ids
      let cids: string[] = [];
      try {
        cids = Array.isArray(q.connection_ids)
          ? q.connection_ids
          : JSON.parse(q.connection_ids || '[]');
      } catch {
        cids = [];
      }
      const remappedCids = cids.map(cid => connectionIdMap.get(cid) || cid);

      // Check if query exists by ID
      let existingQuery = db.prepare('SELECT * FROM queries WHERE id = ?').get(q.id) as any;
      if (!existingQuery) {
        existingQuery = db.prepare('SELECT * FROM queries WHERE name = ? AND sql_text = ?').get(q.name, q.sql_text) as any;
      }

      if (existingQuery) {
        queryIdMap.set(q.id, existingQuery.id);
        reusedQueries.push({ id: existingQuery.id, name: existingQuery.name });
      } else {
        const newQueryId = uuid();
        queryIdMap.set(q.id, newQueryId);

        let paramsStr = '[]';
        if (Array.isArray(q.params)) {
          paramsStr = JSON.stringify(q.params);
        } else if (typeof q.params === 'string') {
          paramsStr = q.params;
        }

        let displayColsStr = '[]';
        if (Array.isArray(q.display_columns)) {
          displayColsStr = JSON.stringify(q.display_columns);
        } else if (typeof q.display_columns === 'string') {
          displayColsStr = q.display_columns;
        }

        db.prepare(`
          INSERT INTO queries (id, name, group_name, region, sql_text, params, connection_ids, display_columns)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newQueryId,
          q.name || 'Consulta importada',
          q.group_name || null,
          q.region || null,
          q.sql_text,
          paramsStr,
          JSON.stringify(remappedCids),
          displayColsStr
        );

        createdQueries.push({ id: newQueryId, name: q.name || 'Consulta importada' });
      }
    }

    // 4. Update query nodes in the flow definition with mapped query IDs
    for (const node of definitionObj.nodes) {
      if (node.type === 'query' && node.data?.queryId) {
        const remapped = queryIdMap.get(node.data.queryId as string);
        if (remapped) {
          node.data.queryId = remapped;
        }
      }
    }

    // 5. Create new flow in SQLite
    const newFlowId = uuid();
    const finalDefinitionStr = JSON.stringify(definitionObj);

    db.prepare(`
      INSERT INTO flows (id, name, description, definition, is_locked)
      VALUES (?, ?, ?, ?, 0)
    `).run(newFlowId, flowName, flowDesc, sealDefinition(finalDefinitionStr));

    const createdFlow = withOpenFlow(db.prepare('SELECT * FROM flows WHERE id = ?').get(newFlowId) as any);

    return {
      data: createdFlow,
      summary: {
        createdConnections,
        reusedConnections,
        createdQueries,
        reusedQueries,
        requiresCredentials: createdConnections.length > 0
      }
    };
  });

  // Export flow as complete JSON bundle (including queries and sanitized connections)
  app.get<{ Params: { id: string } }>('/:id/export-json', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    let definition: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
    try {
      definition = typeof flow.definition === 'string' ? JSON.parse(flow.definition) : flow.definition;
    } catch {
      definition = { nodes: [], edges: [] };
    }

    const nodes: any[] = definition.nodes || [];
    const queryNodes = nodes.filter(n => n.type === 'query');

    const queriesMap = new Map<string, any>();
    const connectionsMap = new Map<string, any>();

    for (const qNode of queryNodes) {
      const queryId = qNode.data?.queryId as string;
      if (queryId && !queriesMap.has(queryId)) {
        const queryInfo = db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId) as any;
        if (queryInfo) {
          let connectionIds: string[] = [];
          try {
            connectionIds = typeof queryInfo.connection_ids === 'string' ? JSON.parse(queryInfo.connection_ids) : (queryInfo.connection_ids || []);
          } catch {}

          let params: any[] = [];
          try {
            params = typeof queryInfo.params === 'string' ? JSON.parse(queryInfo.params) : (queryInfo.params || []);
          } catch {}

          let displayColumns: any[] = [];
          try {
            displayColumns = typeof queryInfo.display_columns === 'string' ? JSON.parse(queryInfo.display_columns) : (queryInfo.display_columns || []);
          } catch {}

          queriesMap.set(queryId, {
            id: queryInfo.id,
            name: queryInfo.name,
            group_name: queryInfo.group_name || null,
            region: queryInfo.region || null,
            sql_text: queryInfo.sql_text,
            params,
            connection_ids: connectionIds,
            display_columns: displayColumns
          });

          for (const cid of connectionIds) {
            if (!connectionsMap.has(cid)) {
              const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(cid) as any;
              if (conn) {
                connectionsMap.set(cid, {
                  id: conn.id,
                  name: conn.name,
                  group_name: conn.group_name || null,
                  region: conn.region || 'Default',
                  city: conn.city || null,
                  host: conn.host,
                  database_name: conn.database_name,
                  port: conn.port || 1433,
                  driver: conn.driver || 'ODBC Driver 17 for SQL Server',
                  env_credential_key: conn.env_credential_key || null,
                  username: '',
                  password: ''
                });
              }
            }
          }
        }
      }
    }

    const bundle = {
      version: '1.0',
      format: 'orquestaflow-bundle',
      exported_at: new Date().toISOString(),
      flow: {
        name: flow.name,
        description: flow.description || '',
        definition: stripNodeSecrets(definition)
      },
      queries: Array.from(queriesMap.values()),
      connections: Array.from(connectionsMap.values())
    };

    const slug = (flow.name || 'flujo').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'flujo';
    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${slug}_flow.json"`)
      .send(bundle);
  });

  // Update flow
  app.put<{ Params: { id: string }; Body: { name?: string; description?: string; definition?: string; status?: string; is_locked?: number } }>(
    '/:id',
    async (request, reply) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
      if (!existing) return reply.status(404).send({ error: 'Flow not found' });

      const { name, description, definition, status, is_locked } = request.body;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (description !== undefined) { updates.push('description = ?'); values.push(description); }
      if (definition !== undefined) {
        // Secrets that did not change keep their ciphertext, so an unchanged flow compares equal
        const definitionStr = sealDefinition(typeof definition === 'object' ? JSON.stringify(definition) : definition, existing.definition);
        updates.push('definition = ?');
        values.push(definitionStr);
        if (definitionStr !== existing.definition) {
          const hasVersions = db.prepare('SELECT 1 FROM flow_versions WHERE flow_id = ? LIMIT 1').get(existing.id);
          if (!hasVersions) {
            recordFlowVersion(existing.id, existing.name, existing.definition, 'initial', 'Estado previo al historial');
          }
          recordFlowVersion(existing.id, name ?? existing.name, definitionStr, 'auto', null);
        }
      }
      if (status !== undefined) { updates.push('status = ?'); values.push(status); }
      if (is_locked !== undefined) { updates.push('is_locked = ?'); values.push(is_locked); }
      updates.push("updated_at = datetime('now')");

      values.push(request.params.id);
      db.prepare(`UPDATE flows SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
      return { data: withOpenFlow(flow) };
    }
  );

  // Delete flow
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Flow not found' });

    const { cancelFlowExecution } = await import('../engine/executor.js');
    cancelFlowExecution(request.params.id);

    // Delete schedules associated with this flow
    const flowSchedules = db.prepare("SELECT id FROM schedules WHERE target_type = 'flow' AND target_id = ?")
      .all(request.params.id) as Array<{ id: string }>;
    db.prepare("DELETE FROM schedules WHERE target_type = 'flow' AND target_id = ?").run(request.params.id);
    if (flowSchedules.length > 0) {
      const { updateJobSchedule } = await import('../engine/scheduler.js');
      for (const s of flowSchedules) updateJobSchedule(s.id);
    }

    db.prepare('DELETE FROM flow_versions WHERE flow_id = ?').run(request.params.id);
    db.prepare('DELETE FROM webhook_logs WHERE flow_id = ?').run(request.params.id);
    // Delete flow
    db.prepare('DELETE FROM flows WHERE id = ?').run(request.params.id);
    deleteRunCache(request.params.id);

    return { data: { deleted: true } };
  });

  // Get active execution state for flow (for live canvas sync)
  app.get<{ Params: { id: string } }>('/:id/execution-state', async (request) => {
    const { activeFlowExecutions } = await import('../engine/executor.js');
    const state = activeFlowExecutions.get(request.params.id);
    if (!state) {
      return { data: { isRunning: false, status: 'idle', nodes: {}, startTime: null } };
    }
    return {
      data: {
        isRunning: state.status === 'running',
        status: state.status,
        mode: state.mode === 'debug' ? 'debug' : 'normal',
        startTime: state.startTime,
        nodes: state.nodes
      }
    };
  });

  // Execution history for a flow (newest first). Query: limit (max 100), offset, status
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; status?: string } }>('/:id/logs', async (request) => {
    const db = getDb();
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const status = ['running', 'completed', 'error', 'cancelled'].includes(String(request.query.status)) ? String(request.query.status) : null;

    const where = `target_type = 'flow' AND target_id = ?${status ? ' AND status = ?' : ''}`;
    const params: any[] = status ? [request.params.id, status] : [request.params.id];

    const logs = db.prepare(`
      SELECT * FROM execution_logs WHERE ${where}
      ORDER BY started_at DESC, rowid DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM execution_logs WHERE ${where}`).get(...params) as any)?.count ?? 0;

    const stats = db.prepare(`
      SELECT status, COUNT(*) AS count, AVG(duration_ms) AS avg_ms
      FROM execution_logs WHERE target_type = 'flow' AND target_id = ?
      GROUP BY status
    `).all(request.params.id);

    return { data: logs, total, limit, offset, stats };
  });

  // Delete the execution history of a flow
  app.delete<{ Params: { id: string } }>('/:id/logs', async (request) => {
    const db = getDb();
    db.prepare("DELETE FROM execution_logs WHERE target_type = 'flow' AND target_id = ? AND status != 'running'").run(request.params.id);
    return { data: { cleared: true } };
  });

  // Stop flow execution
  app.post<{ Params: { id: string } }>('/:id/stop', async (request, reply) => {
    const { stopFlowEngine } = await import('../engine/executor.js');
    const stopped = stopFlowEngine(request.params.id);
    if (!stopped) {
      return reply.status(400).send({ error: 'No active execution found to stop' });
    }
    const io = await safeIo();
    io.emit('flow-stopped', { flowId: request.params.id });
    return { data: { stopped: true } };
  });

  // Resume debug execution
  app.post<{ Params: { id: string }, Body: { nodeId?: string, action: 'step_over' | 'continue' | 'continue_node' | 'step_request' } }>('/:id/debug/resume', async (request, reply) => {
    const { resumeNodeExecution } = await import('../engine/executor.js');
    const resumed = resumeNodeExecution(request.params.id, request.body.nodeId, request.body.action);
    if (!resumed) {
      return reply.status(400).send({ error: 'Failed to resume execution (invalid node or not in debug mode)' });
    }
    return { data: { resumed: true } };
  });

  // Pause debug execution
  app.post<{ Params: { id: string } }>('/:id/debug/pause', async (request, reply) => {
    const { pauseDebugExecution } = await import('../engine/executor.js');
    const paused = pauseDebugExecution(request.params.id);
    if (!paused) {
      return reply.status(400).send({ error: 'Failed to pause execution (not running in debug mode)' });
    }
    return { data: { paused: true } };
  });

  // Execute flow (using DAG engine)
  app.post<{ Params: { id: string }, Body: { mode?: 'normal' | 'debug'; params?: Record<string, any> } }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const flowId = request.params.id;
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    const mode = request.body?.mode || 'normal';
    const params = request.body?.params && typeof request.body.params === 'object' && !Array.isArray(request.body.params)
      ? request.body.params
      : undefined;

    const logId = startExecutionLog(flowId, mode === 'debug' ? 'debug' : 'manual');
    const tracer = new ExecutionTracer();
    const startTime = Date.now();
    const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
    const io = await safeIo();
    const progress = createProgressEmitter(io, flowId);

    try {

      // Execute the DAG with real-time socket callbacks
      const context = await executeFlowEngine(flowId, progress.emit, { mode, tracer, params, executionId: logId });
      saveRunCache(flowId, context, progress.skippedNodeIds, { merge: false });
      const duration = Date.now() - startTime;

      const summary = summarizeContext(context);
      const exportedFiles = progress.exportedFiles.length > 0 ? progress.exportedFiles : summary.exportedFiles;
      const { recordCount } = summary;
      const trace = tracer.toJSON('completed');
      const warnings = trace.filter(t => t.status === 'continued').length;

      finishExecutionLog(logId, {
        status: 'completed',
        durationMs: duration,
        recordCount,
        result: { exportedFiles, recordCount, duration, nodeCount: Object.keys(context).length, warnings },
        trace
      });

      db.prepare(`
        UPDATE flows
        SET last_run_at = datetime('now'), last_run_duration_ms = ?, last_run_record_count = ?, status = 'saved'
        WHERE id = ?
      `).run(duration, recordCount, flowId);

      io.emit('flow-completed', { flowId, duration, recordCount, exportedFiles, warnings });

      return {
        data: {
          logId,
          status: 'completed',
          duration,
          recordCount,
          exportedFiles,
          warnings,
          context
        }
      };

    } catch (err: any) {
      const duration = Date.now() - startTime;
      const isCancelled = isCancellationError(err, activeFlowExecutions.get(flowId)?.status);
      const status: ExecutionStatus = isCancelled ? 'cancelled' : 'error';
      const errorMessage = isCancelled ? 'Ejecución detenida por el usuario' : err.message;

      finishExecutionLog(logId, { status, durationMs: duration, errorMessage, trace: tracer.toJSON(status) });
      saveRunCache(flowId, withLabels(progress.outputs, flow), progress.skippedNodeIds, { merge: true });
      db.prepare("UPDATE flows SET status = 'saved' WHERE id = ?").run(flowId);

      if (isCancelled) {
        io.emit('flow-stopped', { flowId, duration });
        return { data: { logId, status: 'cancelled', duration } };
      }

      io.emit('flow-failed', { flowId, error: err.message, duration });
      return reply.status(500).send({ error: 'Flow execution failed', message: err.message });
    }
  });

  // Partial run: only the given nodes run, in dependency order among themselves. Inputs from nodes
  // outside the set come from the last run: the results the editor sends, completed with the ones cached
  // on the server. The saved definition is used, so the editor saves before calling.
  const runPartial = async (
    flowId: string,
    nodeIds: string[],
    body: { context?: Record<string, any>; mode?: 'normal' | 'debug' } | undefined,
    reply: any
  ) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const definition = JSON.parse(flow.definition || '{"nodes":[],"edges":[]}');
    const nodes: any[] = (definition.nodes || []).filter((n: any) => n.type !== 'note');
    const ids = [...new Set(nodeIds)];
    const unknown = ids.filter(id => !nodes.some(n => n.id === id));
    if (ids.length === 0) return reply.status(400).send({ error: 'No hay nodos para ejecutar' });
    if (unknown.length > 0) return reply.status(404).send({ error: 'Algunos nodos no existen en la versión guardada del flujo' });

    const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
    if (activeFlowExecutions.get(flowId)?.status === 'running') {
      return reply.status(409).send({ error: 'El flujo se está ejecutando; espera a que termine' });
    }

    const cache = loadRunCache(flowId);
    const edges = normalizeEdges(nodes, definition.edges || []);
    // {{_item}} is only valid when a loop body runs without its loop; anywhere else it would make
    // HTTP nodes believe they run inside a loop and send a single request instead of iterating
    const bodyContext = runsLoopBodyAlone(ids, nodes, edges) ? (body?.context || {}) : withoutIterationKeys(body?.context || {});
    const initialContext = { ...(cache?.context || {}), ...bodyContext };
    const missing = findMissingInputs(ids, nodes, edges, initialContext, cache?.skipped);
    if (missing.length > 0) {
      const names = missing.map(n => `«${n.data?.label || n.id}»`).join(', ');
      return reply.status(422).send({
        error: `Faltan los resultados de ${names}. Ejecuta el flujo completo (o esos nodos) primero.`,
        missingNodeIds: missing.map(n => n.id)
      });
    }

    const io = await safeIo();
    const progress = createProgressEmitter(io, flowId);
    const startTime = Date.now();
    try {
      const context = await executeFlowEngine(flowId, progress.emit, {
        mode: body?.mode === 'debug' ? 'debug' : 'normal',
        initialContext,
        onlyNodeIds: ids
      });
      saveRunCache(flowId, context, progress.skippedNodeIds, { merge: true, ranNodeIds: ids });
      const outputs = Object.fromEntries(ids.filter(id => context[id] !== undefined).map(id => [id, context[id]]));
      return {
        data: { nodeIds: ids, status: 'completed', duration: Date.now() - startTime, outputs, exportedFiles: progress.exportedFiles }
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      if (isCancellationError(err, activeFlowExecutions.get(flowId)?.status)) {
        return { data: { nodeIds: ids, status: 'cancelled', duration } };
      }
      return reply.status(422).send({ error: err.message, duration });
    }
  };

  app.post<{ Params: { id: string }; Body: { nodeIds?: string[]; context?: Record<string, any>; mode?: 'normal' | 'debug' } }>(
    '/:id/execute-partial',
    // The upstream results travel in the body and can be large
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => runPartial(request.params.id, request.body?.nodeIds || [], request.body, reply)
  );

  // Test a single node with the results of the last run
  app.post<{ Params: { id: string; nodeId: string }; Body: { context?: Record<string, any> } }>(
    '/:id/nodes/:nodeId/execute',
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      const res = await runPartial(request.params.id, [request.params.nodeId], request.body, reply);
      if (res?.data?.outputs) return { data: { ...res.data, nodeId: request.params.nodeId, output: res.data.outputs[request.params.nodeId] } };
      return res;
    }
  );


  // ── Flow versions ──

  app.get<{ Params: { id: string } }>('/:id/versions', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT id FROM flows WHERE id = ?').get(request.params.id);
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const rows = db.prepare(`
      SELECT id, flow_id, version_number, name, note, kind, definition, created_at, updated_at
      FROM flow_versions WHERE flow_id = ? ORDER BY version_number DESC
    `).all(request.params.id) as any[];

    return {
      data: rows.map(({ definition, ...row }) => ({ ...row, ...summarizeDefinition(definition) }))
    };
  });

  app.get<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId', async (request, reply) => {
    const db = getDb();
    const version = db.prepare('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?')
      .get(request.params.versionId, request.params.id);
    if (!version) return reply.status(404).send({ error: 'Versión no encontrada' });
    return { data: withOpenDefinition(version as any) };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/:id/versions', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const version = recordFlowVersion(flow.id, flow.name, flow.definition, 'manual', request.body?.note?.trim() || null);
    return { data: withOpenDefinition(version as any) };
  });

  app.post<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId/restore', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    if (flow.is_locked === 1) return reply.status(409).send({ error: 'El flujo está bloqueado. Desbloquéalo para restaurar una versión.' });

    const version = db.prepare('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?')
      .get(request.params.versionId, request.params.id) as any;
    if (!version) return reply.status(404).send({ error: 'Versión no encontrada' });

    const { activeFlowExecutions } = await import('../engine/executor.js');
    if (activeFlowExecutions.get(flow.id)?.status === 'running') {
      return reply.status(409).send({ error: 'No se puede restaurar mientras el flujo se está ejecutando' });
    }

    recordFlowVersion(flow.id, flow.name, flow.definition, 'auto', null);
    db.prepare("UPDATE flows SET definition = ?, updated_at = datetime('now') WHERE id = ?").run(version.definition, flow.id);
    recordFlowVersion(flow.id, flow.name, version.definition, 'restore', `Restaurada desde v${version.version_number}`);

    const updated = db.prepare('SELECT * FROM flows WHERE id = ?').get(flow.id) as any;
    return { data: withOpenFlow(updated) };
  });

  // Publish a specific flow version (Feature 4.7: Draft vs Published)
  app.post<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId/publish', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const version = db.prepare('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?')
      .get(request.params.versionId, request.params.id) as any;
    if (!version) return reply.status(404).send({ error: 'Versión no encontrada' });

    db.prepare(`
      UPDATE flows
      SET published_version_id = ?, published_definition = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(version.id, version.definition, flow.id);

    const updated = db.prepare('SELECT * FROM flows WHERE id = ?').get(flow.id) as any;
    return { data: withOpenFlow(updated) };
  });

  // Unpublish a flow (clears published_version_id and published_definition)
  app.post<{ Params: { id: string } }>('/:id/unpublish', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    db.prepare(`
      UPDATE flows
      SET published_version_id = NULL, published_definition = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(flow.id);

    const updated = db.prepare('SELECT * FROM flows WHERE id = ?').get(flow.id) as any;
    return { data: withOpenFlow(updated) };
  });

  // Recent webhook call logs for a flow (last 50)
  app.get<{ Params: { id: string } }>('/:id/webhook-logs', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT id FROM flows WHERE id = ?').get(request.params.id);
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const rows = db.prepare(`
      SELECT id, flow_id, webhook_id, method, headers_json, query_json, body_json, status_code, response_json, idempotency_key, created_at
      FROM webhook_logs
      WHERE flow_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 50
    `).all(request.params.id) as Array<Record<string, any>>;

    const parseJson = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw.trim()) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };

    return {
      data: rows.map(row => ({
        id: row.id,
        flow_id: row.flow_id,
        webhook_id: row.webhook_id,
        method: row.method,
        headers: parseJson(row.headers_json),
        query: parseJson(row.query_json),
        body: parseJson(row.body_json),
        status_code: row.status_code,
        response: parseJson(row.response_json),
        headers_json: row.headers_json,
        query_json: row.query_json,
        body_json: row.body_json,
        response_json: row.response_json,
        idempotency_key: row.idempotency_key,
        created_at: row.created_at,
      })),
    };
  });

  // ── Webhook trigger (v2: multi-method, secret resolution, idempotency, sync webhookRespond, logs) ──
  // Registered in its own scope so the raw body is available for HMAC validation
  // without changing how JSON is parsed on the other flow routes.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as any).rawBody = body;
      const text = String(body || '').trim();
      if (!text) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch {
        const err: any = new Error('El cuerpo de la petición no es un JSON válido');
        err.statusCode = 400;
        done(err, undefined);
      }
    });

    scope.route<{ Params: { webhookId: string } }>({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: '/webhook/:webhookId',
      handler: async (request, reply) => {
        const { webhookId } = request.params;
        const db = getDb();
        const flows = db.prepare('SELECT * FROM flows').all() as any[];

        let targetFlow: any = null;
        let targetNode: any = null;
        let targetDef: any = null;
        for (const f of flows) {
          try {
            // Published flows run their published snapshot; unpublished flows fall back to draft
            const rawDef = f.published_definition || f.definition || '{}';
            const def = JSON.parse(openDefinition(rawDef));
            const node = (def.nodes || []).find(
              (n: any) => n.type === 'webhookTrigger' && (n.data?.webhookId === webhookId || n.id === webhookId)
            );
            if (node) {
              targetFlow = f;
              targetNode = node;
              targetDef = def;
              break;
            }
          } catch {}
        }

        if (!targetFlow || !targetNode) {
          return reply.status(404).send({ error: `Webhook ${webhookId} no encontrado` });
        }

        const expectedMethod = String(targetNode.data?.httpMethod ?? targetNode.data?.method ?? '').trim().toUpperCase();
        if (expectedMethod && expectedMethod !== 'ANY' && expectedMethod !== request.method.toUpperCase()) {
          return reply.status(405).send({
            error: `Método ${request.method} no permitido para este webhook (esperado: ${expectedMethod})`,
          });
        }

        const rawSecret = String(targetNode.data?.secret || '').trim();
        if (rawSecret) {
          const { resolveSecret } = await import('../engine/executor.js');
          let resolvedSecret: string;
          try {
            resolvedSecret = resolveSecret({}, rawSecret);
          } catch (err: any) {
            return reply.status(500).send({ error: err?.message || 'No se pudo resolver el secreto del webhook' });
          }
          if (resolvedSecret) {
            const authError = verifyWebhookAuth(request, resolvedSecret);
            if (authError) return reply.status(401).send({ error: authError });
          }
        }

        const rawIdempotencyKey = request.headers['idempotency-key'];
        const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';
        const idempotencyEnabled = targetNode.data?.idempotencyEnabled !== false;

        if (idempotencyKey && idempotencyEnabled) {
          const cached = db.prepare(`
            SELECT status_code, response_json
            FROM webhook_logs
            WHERE webhook_id = ? AND idempotency_key = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT 1
          `).get(webhookId, idempotencyKey) as { status_code?: number; response_json?: string | null } | undefined;

          if (cached && cached.status_code != null) {
            let cachedBody: unknown = {};
            if (cached.response_json) {
              try {
                cachedBody = JSON.parse(cached.response_json);
              } catch {
                cachedBody = cached.response_json;
              }
            }
            return reply
              .header('X-Idempotent-Replay', 'true')
              .status(cached.status_code)
              .send(cachedBody);
          }
        }

        const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
        if (activeFlowExecutions.get(targetFlow.id)?.status === 'running') {
          return reply.status(409).send({ error: 'El flujo ya se está ejecutando; reintenta cuando termine' });
        }

        const io = await safeIo();
        const cleanHeaders = sanitizeWebhookHeaders(request.headers as Record<string, any>);
        const queryObj = (request.query ?? {}) as Record<string, any>;
        const bodyObj = request.body ?? {};

        const payload = {
          method: request.method,
          body: bodyObj,
          headers: cleanHeaders,
          query: queryObj,
          timestamp: new Date().toISOString(),
        };

        const recordWebhookLog = (statusCode: number, responseBody: unknown) => {
          try {
            const responseJson = responseBody === undefined
              ? null
              : typeof responseBody === 'string'
                ? responseBody
                : JSON.stringify(responseBody);
            db.prepare(`
              INSERT INTO webhook_logs (id, flow_id, webhook_id, method, headers_json, query_json, body_json, status_code, response_json, idempotency_key)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              uuid(),
              targetFlow.id,
              webhookId,
              request.method,
              JSON.stringify(cleanHeaders),
              JSON.stringify(queryObj),
              JSON.stringify(bodyObj),
              statusCode,
              responseJson,
              idempotencyKey && idempotencyEnabled ? idempotencyKey : null
            );
          } catch (logErr) {
            app.log.error(logErr, 'Error recording webhook log');
          }
        };

        const logId = startExecutionLog(targetFlow.id, 'webhook');
        const tracer = new ExecutionTracer();
        const startTime = Date.now();

        const emitWebhookProgress = (nodeId: string, status: ProgressStatus, result?: any) => {
          const safeResult = sanitizeProgressResult(result);
          io.emit('flow-progress', {
            flowId: targetFlow.id,
            nodeId,
            status,
            result: safeResult,
            current: safeResult?.current,
            total: safeResult?.total,
          });
        };

        const hasRespondNode = (targetDef?.nodes || []).some((n: any) => n.type === 'webhookRespond');
        const waitFlag = String(queryObj.wait ?? '').toLowerCase() === 'true';
        const isSync = targetNode.data?.responseMode === 'sync' || waitFlag || hasRespondNode;

        const engineOptions = {
          mode: 'normal' as const,
          initialContext: { _webhookPayload: payload },
          tracer,
          usePublished: true,
          executionId: logId,
        };

        const completeWebhookRun = (context: Record<string, any>) => {
          const duration = Date.now() - startTime;
          const { exportedFiles, recordCount } = summarizeContext(context);
          finishExecutionLog(logId, {
            status: 'completed',
            durationMs: duration,
            recordCount,
            result: { trigger: 'webhook', webhookId, exportedFiles, recordCount },
            trace: tracer.toJSON('completed'),
          });
          db.prepare("UPDATE flows SET last_run_at = datetime('now'), last_run_duration_ms = ? WHERE id = ?").run(duration, targetFlow.id);
          io.emit('flow-completed', { flowId: targetFlow.id, duration, source: 'webhook' });
          return { duration, exportedFiles, recordCount };
        };

        const failWebhookRun = (err: any) => {
          const duration = Date.now() - startTime;
          const status: ExecutionStatus = isCancellationError(err, activeFlowExecutions.get(targetFlow.id)?.status) ? 'cancelled' : 'error';
          finishExecutionLog(logId, { status, durationMs: duration, errorMessage: err.message, trace: tracer.toJSON(status) });
          io.emit('flow-failed', { flowId: targetFlow.id, error: err.message, duration });
          app.log.error(err, 'Error executing flow via webhook');
        };

        if (isSync) {
          try {
            const context = await executeFlowEngine(targetFlow.id, emitWebhookProgress, engineOptions);
            const { duration, exportedFiles, recordCount } = completeWebhookRun(context);

            const whRes = (context as any)?.webhookResponse ?? (context as any)?.__webhookResponse;
            if (whRes && typeof whRes === 'object') {
              const statusCode = Number(whRes.statusCode) || 200;
              if (whRes.headers && typeof whRes.headers === 'object') {
                for (const [hk, hv] of Object.entries(whRes.headers)) {
                  const lower = hk.toLowerCase();
                  if (lower === 'content-length' || lower === 'transfer-encoding') continue;
                  if (hv !== undefined && hv !== null) reply.header(hk, String(hv));
                }
              }
              const respBody = whRes.body !== undefined ? whRes.body : { ok: true, executionId: logId };
              recordWebhookLog(statusCode, respBody);
              return reply.status(statusCode).send(respBody);
            }

            const syncBody = {
              message: 'Webhook procesado',
              flowId: targetFlow.id,
              executionId: logId,
              status: 'completed',
              duration,
              recordCount,
              exportedFiles,
            };
            recordWebhookLog(200, syncBody);
            return reply.status(200).send(syncBody);
          } catch (err: any) {
            failWebhookRun(err);
            const errBody = { error: 'Error ejecutando flujo vía webhook', message: err.message, executionId: logId };
            recordWebhookLog(500, errBody);
            return reply.status(500).send(errBody);
          }
        }

        executeFlowEngine(targetFlow.id, emitWebhookProgress, engineOptions)
          .then(completeWebhookRun)
          .catch(failWebhookRun);

        const asyncBody = {
          message: 'Webhook recibido; flujo en ejecución',
          flowId: targetFlow.id,
          executionId: logId,
        };
        recordWebhookLog(202, asyncBody);
        return reply.status(202).send(asyncBody);
      },
    });
  });
}

const SENSITIVE_WEBHOOK_HEADERS = ['authorization', 'x-webhook-signature', 'x-hub-signature-256', 'cookie'];

function sanitizeWebhookHeaders(headers: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SENSITIVE_WEBHOOK_HEADERS.includes(k.toLowerCase())) clean[k] = v;
  }
  return clean;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Accepts either an HMAC-SHA256 signature of the raw body or the secret as a Bearer token
function verifyWebhookAuth(request: any, secret: string): string | null {
  const signature = (request.headers['x-webhook-signature'] || request.headers['x-hub-signature-256']) as string | undefined;
  if (signature) {
    const raw = typeof request.rawBody === 'string'
      ? request.rawBody
      : (request.body !== undefined ? JSON.stringify(request.body) : '');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return safeEqual(signature.trim(), expected) ? null : 'Firma HMAC inválida';
  }

  const auth = request.headers['authorization'] as string | undefined;
  if (auth) {
    return safeEqual(auth.replace(/^Bearer\s+/i, '').trim(), secret) ? null : 'Token de autorización inválido';
  }

  return 'Este webhook requiere autenticación: envía la cabecera x-webhook-signature o Authorization: Bearer <secreto>';
}

// Moved to engine/nodeSecrets.ts, kept here for existing imports
export { stripNodeSecrets };

const MAX_VERSIONS_PER_FLOW = 50;
const AUTO_VERSION_MERGE_WINDOW_MS = 5 * 60 * 1000;

function summarizeDefinition(definition: string) {
  try {
    const def = JSON.parse(definition || '{}');
    return { node_count: (def.nodes || []).length, edge_count: (def.edges || []).length };
  } catch {
    return { node_count: 0, edge_count: 0 };
  }
}

// Consecutive automatic saves within a short window are folded into one version
// so every click on "Guardar"/"Ejecutar" does not flood the history.
export function recordFlowVersion(
  flowId: string,
  name: string,
  definition: string,
  kind: 'auto' | 'manual' | 'restore' | 'initial',
  note: string | null
) {
  const db = getDb();
  const latest = db.prepare(`
    SELECT * FROM flow_versions WHERE flow_id = ? ORDER BY version_number DESC LIMIT 1
  `).get(flowId) as any;

  if (latest && latest.definition === definition && kind === 'auto') {
    return latest;
  }

  const latestAge = latest ? Date.now() - Date.parse(`${String(latest.created_at).replace(' ', 'T')}Z`) : Infinity;
  if (kind === 'auto' && latest?.kind === 'auto' && latestAge < AUTO_VERSION_MERGE_WINDOW_MS) {
    db.prepare("UPDATE flow_versions SET definition = ?, name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(definition, name, latest.id);
    return db.prepare('SELECT * FROM flow_versions WHERE id = ?').get(latest.id);
  }

  const id = uuid();
  const versionNumber = (latest?.version_number || 0) + 1;
  db.prepare(`
    INSERT INTO flow_versions (id, flow_id, version_number, name, definition, kind, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, flowId, versionNumber, name, definition, kind, note);

  db.prepare(`
    DELETE FROM flow_versions
    WHERE flow_id = ? AND version_number <= ?
  `).run(flowId, versionNumber - MAX_VERSIONS_PER_FLOW);

  return db.prepare('SELECT * FROM flow_versions WHERE id = ?').get(id);
}
