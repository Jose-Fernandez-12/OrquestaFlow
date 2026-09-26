import { FastifyInstance } from 'fastify';
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

export async function flowRoutes(app: FastifyInstance): Promise<void> {
  // List all flows
  app.get('/', async () => {
    const db = getDb();
    const flows = db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all();
    return { data: flows };
  });

  // Get single flow
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    return { data: flow };
  });

  // Create flow
  app.post<{ Body: { name: string; description?: string; definition?: string; is_locked?: number } }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { name, description = '', definition = '{"nodes":[],"edges":[]}', is_locked = 0 } = request.body;

    db.prepare(`
      INSERT INTO flows (id, name, description, definition, is_locked)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description, definition, is_locked);

    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(id);
    return { data: flow };
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
  }>('/import', async (request) => {
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
          conn.password || '',
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
    `).run(newFlowId, flowName, flowDesc, finalDefinitionStr);

    const createdFlow = db.prepare('SELECT * FROM flows WHERE id = ?').get(newFlowId);

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
        const definitionStr = typeof definition === 'object' ? JSON.stringify(definition) : definition;
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

      const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
      return { data: flow };
    }
  );

  // Delete flow
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Flow not found' });

    // Delete schedules associated with this flow
    db.prepare("DELETE FROM schedules WHERE target_type = 'flow' AND target_id = ?").run(request.params.id);
    db.prepare('DELETE FROM flow_versions WHERE flow_id = ?').run(request.params.id);
    // Delete flow
    db.prepare('DELETE FROM flows WHERE id = ?').run(request.params.id);

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
    const { getIo } = await import('../engine/socket.js');
    getIo().emit('flow-stopped', { flowId: request.params.id });
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
  app.post<{ Params: { id: string }, Body: { mode?: 'normal' | 'debug' } }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const flowId = request.params.id;
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    const mode = request.body?.mode || 'normal';

    const logId = startExecutionLog(flowId, mode === 'debug' ? 'debug' : 'manual');
    const tracer = new ExecutionTracer();
    const startTime = Date.now();
    const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
    const { getIo } = await import('../engine/socket.js');
    const io = getIo();

    try {
      // Track exported files emitted in real-time so we also include them in the final DB log
      const realtimeExportedFiles: any[] = [];

      // Execute the DAG with real-time socket callbacks
      const context = await executeFlowEngine(flowId, (nodeId, status, result) => {
        io.emit('flow-progress', {
          flowId,
          nodeId,
          status,
          result,
          current: result?.current,
          total: result?.total,
          remainingSeconds: result?.remainingSeconds,
          totalSeconds: result?.totalSeconds,
          context: result?.context
        });

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
          realtimeExportedFiles.push(info);
          io.emit('flow-export-ready', { flowId, ...info });
        }
      }, { mode, tracer });
      const duration = Date.now() - startTime;

      const summary = summarizeContext(context);
      const exportedFiles = realtimeExportedFiles.length > 0 ? realtimeExportedFiles : summary.exportedFiles;
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
      db.prepare("UPDATE flows SET status = 'saved' WHERE id = ?").run(flowId);

      if (isCancelled) {
        io.emit('flow-stopped', { flowId, duration });
        return { data: { logId, status: 'cancelled', duration } };
      }

      io.emit('flow-failed', { flowId, error: err.message, duration });
      return reply.status(500).send({ error: 'Flow execution failed', message: err.message });
    }
  });

  // Test a single node: runs only that node, reading the upstream results sent by the editor
  // (the last run's results). The saved definition is used, so the editor saves before calling.
  app.post<{ Params: { id: string; nodeId: string }; Body: { context?: Record<string, any> } }>(
    '/:id/nodes/:nodeId/execute',
    // The upstream results travel in the body and can be large
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      const db = getDb();
      const flowId = request.params.id;
      const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
      if (!flow) return reply.status(404).send({ error: 'Flow not found' });

      const definition = JSON.parse(flow.definition || '{"nodes":[]}');
      const node = (definition.nodes || []).find((n: any) => n.id === request.params.nodeId);
      if (!node) return reply.status(404).send({ error: 'El nodo no existe en la versión guardada del flujo' });

      const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
      if (activeFlowExecutions.get(flowId)?.status === 'running') {
        return reply.status(409).send({ error: 'El flujo se está ejecutando; espera a que termine para probar un nodo' });
      }

      const { getIo } = await import('../engine/socket.js');
      const io = getIo();
      const startTime = Date.now();
      try {
        const context = await executeFlowEngine(
          flowId,
          (nodeId, status, result) => {
            io.emit('flow-progress', { flowId, nodeId, status, result, current: result?.current, total: result?.total });
          },
          { mode: 'normal', initialContext: request.body?.context || {}, onlyNodeIds: [node.id] }
        );
        return { data: { nodeId: node.id, status: 'completed', duration: Date.now() - startTime, output: context[node.id] } };
      } catch (err: any) {
        return reply.status(422).send({ error: err.message, nodeId: node.id, duration: Date.now() - startTime });
      }
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
    return { data: version };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/:id/versions', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const version = recordFlowVersion(flow.id, flow.name, flow.definition, 'manual', request.body?.note?.trim() || null);
    return { data: version };
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

    const updated = db.prepare('SELECT * FROM flows WHERE id = ?').get(flow.id);
    return { data: updated };
  });

  // ── Webhook trigger ──
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

    scope.post<{ Params: { webhookId: string } }>('/webhook/:webhookId', async (request, reply) => {
      const { getSystemSettingsFromDb } = await import('./settings.js');
      if (!getSystemSettingsFromDb().experimental_nodes_enabled) {
        return reply.status(403).send({ error: 'Los webhooks están deshabilitados (nodos experimentales desactivados en Configuración)' });
      }

      const { webhookId } = request.params;
      const db = getDb();
      const flows = db.prepare('SELECT * FROM flows').all() as any[];

      let targetFlow: any = null;
      let targetNode: any = null;
      for (const f of flows) {
        try {
          const def = JSON.parse(f.definition || '{}');
          const node = (def.nodes || []).find(
            (n: any) => n.type === 'webhookTrigger' && (n.data?.webhookId === webhookId || n.id === webhookId)
          );
          if (node) {
            targetFlow = f;
            targetNode = node;
            break;
          }
        } catch {}
      }

      if (!targetFlow || !targetNode) {
        return reply.status(404).send({ error: `Webhook ${webhookId} no encontrado` });
      }

      const secret = String(targetNode.data?.secret || '');
      if (secret) {
        const authError = verifyWebhookAuth(request, secret);
        if (authError) return reply.status(401).send({ error: authError });
      }

      const { executeFlowEngine, activeFlowExecutions } = await import('../engine/executor.js');
      if (activeFlowExecutions.get(targetFlow.id)?.status === 'running') {
        return reply.status(409).send({ error: 'El flujo ya se está ejecutando; reintenta cuando termine' });
      }

      const { getIo } = await import('../engine/socket.js');
      const io = getIo();

      const payload = {
        body: request.body ?? {},
        headers: sanitizeWebhookHeaders(request.headers as Record<string, any>),
        query: request.query ?? {},
        timestamp: new Date().toISOString()
      };

      const logId = startExecutionLog(targetFlow.id, 'webhook');
      const tracer = new ExecutionTracer();
      const startTime = Date.now();

      executeFlowEngine(
        targetFlow.id,
        (nodeId, status, result) => {
          io.emit('flow-progress', { flowId: targetFlow.id, nodeId, status, result, current: result?.current, total: result?.total });
        },
        { mode: 'normal', initialContext: { _webhookPayload: payload }, tracer }
      ).then(context => {
        const duration = Date.now() - startTime;
        const { exportedFiles, recordCount } = summarizeContext(context);
        finishExecutionLog(logId, {
          status: 'completed',
          durationMs: duration,
          recordCount,
          result: { trigger: 'webhook', webhookId, exportedFiles, recordCount },
          trace: tracer.toJSON('completed')
        });
        db.prepare("UPDATE flows SET last_run_at = datetime('now'), last_run_duration_ms = ? WHERE id = ?").run(duration, targetFlow.id);
        io.emit('flow-completed', { flowId: targetFlow.id, duration, source: 'webhook' });
      }).catch(err => {
        const duration = Date.now() - startTime;
        const status: ExecutionStatus = isCancellationError(err, activeFlowExecutions.get(targetFlow.id)?.status) ? 'cancelled' : 'error';
        finishExecutionLog(logId, { status, durationMs: duration, errorMessage: err.message, trace: tracer.toJSON(status) });
        io.emit('flow-failed', { flowId: targetFlow.id, error: err.message, duration });
        app.log.error(err, 'Error executing flow via webhook');
      });

      return reply.status(202).send({
        message: 'Webhook recibido; flujo en ejecución',
        flowId: targetFlow.id,
        executionId: logId
      });
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
    const raw = typeof request.rawBody === 'string' ? request.rawBody : JSON.stringify(request.body ?? {});
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return safeEqual(signature.trim(), expected) ? null : 'Firma HMAC inválida';
  }

  const auth = request.headers['authorization'] as string | undefined;
  if (auth) {
    return safeEqual(auth.replace(/^Bearer\s+/i, '').trim(), secret) ? null : 'Token de autorización inválido';
  }

  return 'Este webhook requiere autenticación: envía la cabecera x-webhook-signature o Authorization: Bearer <secreto>';
}

const SECRET_NODE_FIELDS = ['apiKey', 'clientSecret', 'password', 'refreshToken', 'secret'];

// Secrets typed directly into nodes are removed from exports; env:VARIABLE references are kept
export function stripNodeSecrets(definition: { nodes: any[]; edges: any[] }) {
  return {
    ...definition,
    nodes: (definition.nodes || []).map(node => {
      if (!node?.data) return node;
      const data = { ...node.data };
      for (const field of SECRET_NODE_FIELDS) {
        if (typeof data[field] === 'string' && data[field] && !data[field].startsWith('env:')) {
          data[field] = '';
        }
      }
      return { ...node, data };
    })
  };
}

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
