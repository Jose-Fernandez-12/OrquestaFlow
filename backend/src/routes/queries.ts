import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  // List all queries
  app.get('/', async () => {
    const db = getDb();
    const queries = db.prepare('SELECT * FROM queries ORDER BY updated_at DESC').all();
    return { data: queries };
  });

  // Get single query
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const query = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id);
    if (!query) return reply.status(404).send({ error: 'Query not found' });
    return { data: query };
  });

  // Create query
  app.post<{ Body: { name: string; sql_text: string; connection_ids?: string[] } }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { name, sql_text, connection_ids = [] } = request.body;

    // Auto-detect named params (:param_name)
    const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const params: string[] = [];
    let match;
    while ((match = paramRegex.exec(sql_text)) !== null) {
      if (!params.includes(match[1])) params.push(match[1]);
    }

    db.prepare(`
      INSERT INTO queries (id, name, sql_text, params, connection_ids)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, sql_text, JSON.stringify(params), JSON.stringify(connection_ids));

    const query = db.prepare('SELECT * FROM queries WHERE id = ?').get(id);
    return { data: query };
  });

  // Update query
  app.put<{ Params: { id: string }; Body: { name?: string; sql_text?: string; connection_ids?: string[] } }>(
    '/:id',
    async (request, reply) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Query not found' });

      const { name, sql_text, connection_ids } = request.body;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (sql_text !== undefined) {
        updates.push('sql_text = ?');
        values.push(sql_text);
        // Re-detect params
        const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
        const params: string[] = [];
        let match;
        while ((match = paramRegex.exec(sql_text)) !== null) {
          if (!params.includes(match[1])) params.push(match[1]);
        }
        updates.push('params = ?');
        values.push(JSON.stringify(params));
      }
      if (connection_ids !== undefined) {
        updates.push('connection_ids = ?');
        values.push(JSON.stringify(connection_ids));
      }
      updates.push("updated_at = datetime('now')");

      values.push(request.params.id);
      db.prepare(`UPDATE queries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const query = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id);
      return { data: query };
    }
  );

  // Validate SQL (basic check)
  app.post<{ Body: { sql_text: string } }>('/validate', async (request) => {
    const { sql_text } = request.body;
    const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const params: string[] = [];
    let match;
    while ((match = paramRegex.exec(sql_text)) !== null) {
      if (!params.includes(match[1])) params.push(match[1]);
    }

    // Basic validation
    const errors: string[] = [];
    const trimmed = sql_text.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      errors.push('Solo se permiten consultas SELECT o CTE (WITH)');
    }
    if (trimmed.includes('DROP ') || trimmed.includes('DELETE ') || trimmed.includes('TRUNCATE ')) {
      errors.push('No se permiten operaciones destructivas');
    }

    return {
      data: {
        valid: errors.length === 0,
        params,
        paramCount: params.length,
        errors
      }
    };
  });

  // Execute query against selected connections
  app.post<{
    Params: { id: string };
    Body: { connection_ids: string[]; params?: Record<string, string> }
  }>('/:id/execute', async (request, reply) => {
    const db = getDb();
    const query = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!query) return reply.status(404).send({ error: 'Query not found' });

    const { connection_ids, params = {} } = request.body;
    const logId = uuid();

    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status, result)
      VALUES (?, 'query', ?, 'running', ?)
    `).run(logId, request.params.id, JSON.stringify({ connection_ids, params }));

    // TODO: Execute against real SQL Server connections using mssql
    // For now, return simulated results
    await new Promise(resolve => setTimeout(resolve, 800));

    const simulatedResults = [
      { region: 'Centro', pedidos: 428, facturacion: 82430 },
      { region: 'Norte', pedidos: 331, facturacion: 64820 },
      { region: 'Sur', pedidos: 276, facturacion: 51190 }
    ];

    db.prepare(`
      UPDATE execution_logs
      SET status = 'completed', duration_ms = 1800, record_count = ?, completed_at = datetime('now'),
          result = ?
      WHERE id = ?
    `).run(simulatedResults.length, JSON.stringify(simulatedResults), logId);

    db.prepare(`
      UPDATE queries SET last_run_at = datetime('now'), last_row_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(simulatedResults.length, request.params.id);

    return {
      data: {
        logId,
        status: 'completed',
        duration: 1800,
        rowCount: simulatedResults.length,
        columns: ['region', 'pedidos', 'facturacion'],
        rows: simulatedResults
      }
    };
  });
}
