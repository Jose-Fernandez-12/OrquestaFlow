import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  // List all scripts
  app.get('/', async () => {
    const db = getDb();
    const scripts = db.prepare('SELECT * FROM scripts ORDER BY created_at DESC').all();
    const todayLogs = db.prepare(`
      SELECT COUNT(*) as count FROM execution_logs
      WHERE target_type = 'script' AND started_at >= date('now')
    `).get() as { count: number };

    return {
      data: scripts,
      meta: {
        activeCount: scripts.length,
        executedToday: todayLogs.count
      }
    };
  });

  // Get single script
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    return { data: script };
  });

  // Upload script
  app.post('/', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const id = uuid();
    const uploadsDir = join(process.cwd(), 'uploads', 'scripts');
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

    const fileName = `${id}_${data.filename}`;
    const filePath = join(uploadsDir, fileName);
    const buffer = await data.toBuffer();
    writeFileSync(filePath, buffer);

    const name = data.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const db = getDb();

    db.prepare(`
      INSERT INTO scripts (id, name, description, file_path, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, '', `scripts/${fileName}`, 'python');

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
    return { data: script };
  });

  // Update script
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; schedule_cron?: string }
  }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Script not found' });

    const { name, description, schedule_cron } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (schedule_cron !== undefined) { updates.push('schedule_cron = ?'); values.push(schedule_cron); }

    if (updates.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    values.push(request.params.id);
    db.prepare(`UPDATE scripts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    return { data: script };
  });

  // Execute script
  app.post<{
    Params: { id: string };
    Body: { args?: string[] }
  }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!script) return reply.status(404).send({ error: 'Script not found' });

    const logId = uuid();
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status)
      VALUES (?, 'script', ?, 'running')
    `).run(logId, request.params.id);

    const pythonPath = process.env.PYTHON_PATH || 'python';
    const scriptPath = join(process.cwd(), 'uploads', script.file_path as string);
    const args = request.body.args || [];

    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      const startTime = Date.now();
      const result = await execFileAsync(pythonPath, [scriptPath, ...args], {
        timeout: 120000, // 2 min timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB output
      });
      const duration = Date.now() - startTime;

      db.prepare(`
        UPDATE execution_logs
        SET status = 'completed', duration_ms = ?, completed_at = datetime('now'),
            result = ?
        WHERE id = ?
      `).run(duration, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }), logId);

      db.prepare("UPDATE scripts SET last_run_at = datetime('now'), last_run_status = 'completed' WHERE id = ?")
        .run(request.params.id);

      return {
        data: {
          logId,
          status: 'completed',
          duration,
          stdout: result.stdout,
          stderr: result.stderr
        }
      };
    } catch (err: unknown) {
      const error = err as Error & { stdout?: string; stderr?: string };
      db.prepare(`
        UPDATE execution_logs
        SET status = 'error', completed_at = datetime('now'), error_message = ?
        WHERE id = ?
      `).run(error.message, logId);

      db.prepare("UPDATE scripts SET last_run_at = datetime('now'), last_run_status = 'error' WHERE id = ?")
        .run(request.params.id);

      return reply.status(500).send({
        error: 'Script execution failed',
        message: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      });
    }
  });
}
