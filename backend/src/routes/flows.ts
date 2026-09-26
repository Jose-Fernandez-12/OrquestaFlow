import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

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
        definition
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
      const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Flow not found' });

      const { name, description, definition, status, is_locked } = request.body;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (description !== undefined) { updates.push('description = ?'); values.push(description); }
      if (definition !== undefined) { updates.push('definition = ?'); values.push(typeof definition === 'object' ? JSON.stringify(definition) : definition); }
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

  // Get execution logs for flow
  app.get<{ Params: { id: string } }>('/:id/logs', async (request) => {
    const db = getDb();
    const logs = db.prepare(`
      SELECT * FROM execution_logs
      WHERE target_type = 'flow' AND target_id = ?
      ORDER BY started_at DESC
      LIMIT 30
    `).all(request.params.id);
    return { data: logs };
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
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });
    const mode = request.body?.mode || 'normal';

    const logId = uuid();
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status)
      VALUES (?, 'flow', ?, 'running')
    `).run(logId, request.params.id);

    const startTime = Date.now();
    try {
      const { executeFlowEngine } = await import('../engine/executor.js');
      const { getIo } = await import('../engine/socket.js');
      const io = getIo();
      
      // Track exported files emitted in real-time so we also include them in the final DB log
      const realtimeExportedFiles: any[] = [];

      // Execute the DAG with real-time socket callbacks
      const context = await executeFlowEngine(request.params.id, (nodeId, status, result) => {
        io.emit('flow-progress', { 
          flowId: request.params.id, 
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
          io.emit('flow-export-ready', {
            flowId: request.params.id,
            ...info
          });
        }
      }, { mode });
      const duration = Date.now() - startTime;

      // Ensure exportedFiles are collected for the execution logs and completion payload
      const exportResults = Object.values(context).filter((v: any) => v?.filePath && v?.success);
      const exportedFiles = realtimeExportedFiles.length > 0 ? realtimeExportedFiles : exportResults.map((exportResult: any) => {
        const fileName = exportResult.filePath.split(/[/\\]/).pop();
        return {
          fileName,
          downloadUrl: `/api/files/${fileName}`,
          records: exportResult.records,
          format: exportResult.format,
          filePath: exportResult.filePath,
          previewRows: exportResult.previewRows,
          headers: exportResult.headers
        };
      });

      let recordCount = 0;
      if (exportResults.length > 0) {
        recordCount = exportResults.reduce((acc, curr: any) => acc + (curr.records || 0), 0);
      } else {
        // Fallback: sum of items processed by nodes if no export node is present
        for (const val of Object.values(context)) {
          if (val && typeof val === 'object') {
            if (Array.isArray((val as any).data?.items)) {
              recordCount += (val as any).data.items.length;
            } else if (Array.isArray((val as any).data)) {
              recordCount += (val as any).data.length;
            }
          }
        }
      }

      const resultPayload = {
        exportedFiles,
        recordCount,
        duration,
        nodeCount: Object.keys(context).length
      };

      db.prepare(`
        UPDATE execution_logs
        SET status = 'completed', duration_ms = ?, record_count = ?, result = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(duration, recordCount, JSON.stringify(resultPayload), logId);

      db.prepare(`
        UPDATE flows
        SET last_run_at = datetime('now'), last_run_duration_ms = ?, last_run_record_count = ?, status = 'saved'
        WHERE id = ?
      `).run(duration, recordCount, request.params.id);

      io.emit('flow-completed', {
        flowId: request.params.id,
        duration,
        recordCount,
        exportedFiles
      });

      return {
        data: {
          logId,
          status: 'completed',
          duration,
          recordCount,
          exportedFiles,
          context
        }
      };

    } catch (err: any) {
      const duration = Date.now() - startTime;
      const { activeFlowExecutions } = await import('../engine/executor.js');
      const activeState = activeFlowExecutions.get(request.params.id);
      const isCancelled = activeState?.status === 'cancelled' || err.message?.toLowerCase().includes('detenid') || err.message?.toLowerCase().includes('cancelad');

      const targetStatus = isCancelled ? 'cancelled' : 'error';
      const errorMessage = isCancelled ? 'Ejecución detenida por el usuario' : err.message;

      try {
        db.prepare(`
          UPDATE execution_logs
          SET status = ?, duration_ms = ?, error_message = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(targetStatus, duration, errorMessage, logId);
      } catch {
        db.prepare(`
          UPDATE execution_logs
          SET status = 'error', duration_ms = ?, error_message = ?, completed_at = datetime('now')
          WHERE id = ?
        `).run(duration, errorMessage, logId);
      }

      db.prepare(`
        UPDATE flows
        SET status = 'saved'
        WHERE id = ?
      `).run(request.params.id);

      try {
        const { getIo } = await import('../engine/socket.js');
        const io = getIo();
        if (isCancelled) {
          io.emit('flow-stopped', {
            flowId: request.params.id,
            duration
          });
        } else {
          io.emit('flow-failed', {
            flowId: request.params.id,
            error: err.message,
            duration
          });
        }
      } catch {}

      if (isCancelled) {
        return { data: { logId, status: 'cancelled', duration } };
      }

      return reply.status(500).send({ error: 'Flow execution failed', message: err.message });
    }
  });

  // Execute individual node
  app.post<{ Params: { id: string; nodeId: string } }>('/:id/nodes/:nodeId/execute', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const logId = uuid();
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status)
      VALUES (?, 'node', ?, 'running')
    `).run(logId, request.params.nodeId);

    // Simulate node execution
    await new Promise(resolve => setTimeout(resolve, 650));
    const duration = 650;

    db.prepare(`
      UPDATE execution_logs
      SET status = 'completed', duration_ms = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(duration, logId);

    return { data: { logId, nodeId: request.params.nodeId, status: 'completed', duration } };
  });
}
