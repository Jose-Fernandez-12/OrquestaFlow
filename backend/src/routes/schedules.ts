import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  // List all schedules
  app.get('/', async () => {
    const db = getDb();
    const schedules = db.prepare(`
      SELECT s.*,
        CASE s.target_type
          WHEN 'flow' THEN (SELECT name FROM flows WHERE id = s.target_id)
          WHEN 'script' THEN (SELECT name FROM scripts WHERE id = s.target_id)
          WHEN 'query' THEN (SELECT name FROM queries WHERE id = s.target_id)
        END as target_name
      FROM schedules s
      ORDER BY s.created_at DESC
    `).all();
    return { data: schedules };
  });

  // Get single schedule
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(request.params.id);
    if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
    return { data: schedule };
  });

  // Create schedule
  app.post<{
    Body: {
      target_type: 'flow' | 'script' | 'query';
      target_id: string;
      name?: string;
      cron_expression: string;
    }
  }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { target_type, target_id, name, cron_expression } = request.body;

    db.prepare(`
      INSERT INTO schedules (id, target_type, target_id, name, cron_expression)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, target_type, target_id, name || '', cron_expression);

    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

    // Update cron job dynamically
    const { updateJobSchedule } = await import('../engine/scheduler.js');
    updateJobSchedule(id);

    return { data: schedule };
  });

  // Update schedule
  app.put<{
    Params: { id: string };
    Body: { name?: string; cron_expression?: string; is_active?: number }
  }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Schedule not found' });

    const { name, cron_expression, is_active } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (cron_expression !== undefined) { updates.push('cron_expression = ?'); values.push(cron_expression); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    updates.push("updated_at = datetime('now')");

    values.push(request.params.id);
    db.prepare(`UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Update cron job dynamically
    const { updateJobSchedule } = await import('../engine/scheduler.js');
    updateJobSchedule(request.params.id);

    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(request.params.id);
    return { data: schedule };
  });

  // Delete schedule
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Schedule not found' });

    db.prepare('DELETE FROM schedules WHERE id = ?').run(request.params.id);

    // Stop cron job dynamically
    const { updateJobSchedule } = await import('../engine/scheduler.js');
    updateJobSchedule(request.params.id);

    return { data: { deleted: true } };
  });

  // Get schedule logs
  app.get<{ Params: { id: string } }>('/:id/logs', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Schedule not found' });

    const logs = db.prepare(`
      SELECT id, status, error_message, duration_ms, record_count, result, started_at, completed_at
      FROM execution_logs 
      WHERE schedule_id = ?
      ORDER BY started_at DESC
      LIMIT 20
    `).all(request.params.id);
    
    return { data: logs };
  });
}
