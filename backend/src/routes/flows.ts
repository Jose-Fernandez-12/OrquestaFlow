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
  app.post<{ Body: { name: string; description?: string; definition?: string } }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { name, description = '', definition = '{"nodes":[],"edges":[]}' } = request.body;

    db.prepare(`
      INSERT INTO flows (id, name, description, definition)
      VALUES (?, ?, ?, ?)
    `).run(id, name, description, definition);

    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(id);
    return { data: flow };
  });

  // Update flow
  app.put<{ Params: { id: string }; Body: { name?: string; description?: string; definition?: string; status?: string } }>(
    '/:id',
    async (request, reply) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Flow not found' });

      const { name, description, definition, status } = request.body;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (description !== undefined) { updates.push('description = ?'); values.push(description); }
      if (definition !== undefined) { updates.push('definition = ?'); values.push(definition); }
      if (status !== undefined) { updates.push('status = ?'); values.push(status); }
      updates.push("updated_at = datetime('now')");

      values.push(request.params.id);
      db.prepare(`UPDATE flows SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id);
      return { data: flow };
    }
  );

  // Execute flow (placeholder - will be implemented with DAG engine)
  app.post<{ Params: { id: string } }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!flow) return reply.status(404).send({ error: 'Flow not found' });

    const logId = uuid();
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status)
      VALUES (?, 'flow', ?, 'running')
    `).run(logId, request.params.id);

    // Simulate execution for now
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1300));
    const duration = Date.now() - startTime;

    db.prepare(`
      UPDATE execution_logs
      SET status = 'completed', duration_ms = ?, record_count = 148, completed_at = datetime('now')
      WHERE id = ?
    `).run(duration, logId);

    db.prepare(`
      UPDATE flows
      SET last_run_at = datetime('now'), last_run_duration_ms = ?, last_run_record_count = 148, status = 'saved'
      WHERE id = ?
    `).run(duration, request.params.id);

    return { data: { logId, status: 'completed', duration, recordCount: 148 } };
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
