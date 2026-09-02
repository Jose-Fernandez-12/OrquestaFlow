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
  app.post<{ Body: { name: string; sql_text: string; connection_ids?: string[]; display_columns?: string[] } }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const { name, sql_text, connection_ids = [], display_columns = [] } = request.body;

    // Auto-detect named params (:param_name)
    const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const params: string[] = [];
    let match;
    while ((match = paramRegex.exec(sql_text)) !== null) {
      if (!params.includes(match[1])) params.push(match[1]);
    }

    db.prepare(`
      INSERT INTO queries (id, name, sql_text, params, connection_ids, display_columns)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, sql_text, JSON.stringify(params), JSON.stringify(connection_ids), JSON.stringify(display_columns));

    const query = db.prepare('SELECT * FROM queries WHERE id = ?').get(id);
    return { data: query };
  });

  // Update query
  app.put<{ Params: { id: string }; Body: { name?: string; sql_text?: string; connection_ids?: string[]; display_columns?: string[] } }>(
    '/:id',
    async (request, reply) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Query not found' });

      const { name, sql_text, connection_ids, display_columns } = request.body;
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
      if (display_columns !== undefined) {
        updates.push('display_columns = ?');
        values.push(JSON.stringify(display_columns));
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

    let { connection_ids, params = {} } = request.body;
    
    // Si no se envían conexiones, intentar usar las asociadas a la consulta
    if (!connection_ids || connection_ids.length === 0) {
      try {
        connection_ids = JSON.parse(query.connection_ids as string || '[]');
      } catch (e) {}
    }

    if (!connection_ids || connection_ids.length === 0) {
      return reply.status(400).send({ error: 'Debe seleccionar al menos una conexión de base de datos' });
    }

    const logId = uuid();
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, status, result)
      VALUES (?, 'query', ?, 'running', ?)
    `).run(logId, request.params.id, JSON.stringify({ connection_ids, params }));

    const startTime = Date.now();
    try {
      let combinedRows: any[] = [];
      let columns: string[] = [];

      // Execute on each selected connection in parallel
      const executionPromises = connection_ids.map(async (connId) => {
        const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(connId) as Record<string, any> | undefined;
        if (!conn) throw new Error(`Conexión no encontrada: ${connId}`);

        let result;
        if (conn.driver === 'sqlite') {
          const { executeSqliteQuery } = await import('../engine/sqlite.js');
          result = await executeSqliteQuery(conn.host, query.sql_text as string, params);
        } else {
          const { executeMssqlQuery } = await import('../engine/mssql.js');
          result = await executeMssqlQuery(connId, query.sql_text as string, params);
        }
        return result;
      });

      const results = await Promise.all(executionPromises);
      
      for (const result of results) {
        if (columns.length === 0) columns = result.columns;
        combinedRows = [...combinedRows, ...result.rows];
      }

      const duration = Date.now() - startTime;

      db.prepare(`
        UPDATE execution_logs
        SET status = 'completed', duration_ms = ?, record_count = ?, completed_at = datetime('now'),
            result = ?
        WHERE id = ?
      `).run(duration, combinedRows.length, JSON.stringify(combinedRows), logId);

      db.prepare(`
        UPDATE queries SET last_run_at = datetime('now'), last_row_count = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(combinedRows.length, request.params.id);

      return {
        data: {
          logId,
          status: 'completed',
          duration,
          rowCount: combinedRows.length,
          columns,
          rows: combinedRows
        }
      };

    } catch (err: any) {
      const duration = Date.now() - startTime;
      db.prepare(`
        UPDATE execution_logs
        SET status = 'error', duration_ms = ?, record_count = ?, completed_at = datetime('now'), result = ?
        WHERE id = ?
      `).run(duration, 0, JSON.stringify({ error: err.message }), logId);

      return reply.status(500).send({ error: 'Query execution failed', message: err.message });
    }
  });

  // Delete query
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM queries WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Query not found' });

    db.prepare('DELETE FROM queries WHERE id = ?').run(request.params.id);
    return { data: { deleted: true } };
  });
}
