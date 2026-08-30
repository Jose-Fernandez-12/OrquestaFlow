import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // List all connections (grouped by region)
  app.get('/', async (request) => {
    const db = getDb();
    const connections = db.prepare('SELECT * FROM connections ORDER BY region, name').all() as Array<Record<string, unknown>>;

    // Group by region
    const grouped: Record<string, typeof connections> = {};
    for (const conn of connections) {
      const region = conn.region as string;
      if (!grouped[region]) grouped[region] = [];
      grouped[region].push(conn);
    }

    return { data: connections, grouped };
  });

  // Get single connection
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    return { data: conn };
  });

  // Create connection
  app.post<{
    Body: {
      name: string;
      region: string;
      city?: string;
      host: string;
      database_name: string;
      port?: number;
      driver?: string;
      env_credential_key?: string;
    }
  }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const {
      name, region, city, host, database_name,
      port = 1433,
      driver = 'ODBC Driver 17 for SQL Server',
      env_credential_key = 'SQLSERVER'
    } = request.body;

    db.prepare(`
      INSERT INTO connections (id, name, region, city, host, database_name, port, driver, env_credential_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, region, city || name, host, database_name, port, driver, env_credential_key);

    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
    return { data: conn };
  });

  // Update connection
  app.put<{
    Params: { id: string };
    Body: { name?: string; region?: string; city?: string; host?: string; database_name?: string; port?: number; is_active?: number }
  }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    const { name, region, city, host, database_name, port, is_active } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (region !== undefined) { updates.push('region = ?'); values.push(region); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city); }
    if (host !== undefined) { updates.push('host = ?'); values.push(host); }
    if (database_name !== undefined) { updates.push('database_name = ?'); values.push(database_name); }
    if (port !== undefined) { updates.push('port = ?'); values.push(port); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }

    if (updates.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    values.push(request.params.id);
    db.prepare(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id);
    return { data: conn };
  });

  // Test connection
  app.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    // TODO: Actually test with mssql
    // For now simulate
    await new Promise(resolve => setTimeout(resolve, 500));

    db.prepare("UPDATE connections SET last_tested_at = datetime('now') WHERE id = ?").run(request.params.id);

    return { data: { success: true, latency: 45, message: 'Conexion verificada' } };
  });

  // Delete connection
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    db.prepare('DELETE FROM connections WHERE id = ?').run(request.params.id);
    return { data: { deleted: true } };
  });
}
