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
      if (definition !== undefined) { updates.push('definition = ?'); values.push(definition); }
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

  // Execute flow (using DAG engine)
  app.post<{ Params: { id: string } }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

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
      
      // Execute the DAG with real-time socket callbacks
      const context = await executeFlowEngine(request.params.id, (nodeId, status, result) => {
        io.emit('flow-progress', { flowId: request.params.id, nodeId, status, result });
      });
      const duration = Date.now() - startTime;

      // Find any export output to surface the download link
      const exportResults = Object.values(context).filter((v: any) => v?.filePath && v?.success);
      
      const exportedFiles = exportResults.map((exportResult: any) => {
        const fileName = exportResult.filePath.split(/[/\\]/).pop();
        const info = {
          fileName,
          downloadUrl: `/api/files/${fileName}`,
          records: exportResult.records,
          format: exportResult.format,
          filePath: exportResult.filePath
        };
        io.emit('flow-export-ready', {
          flowId: request.params.id,
          ...info
        });
        return info;
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
