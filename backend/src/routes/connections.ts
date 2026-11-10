import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { encryptSecret } from '../engine/secrets.js';

/** A connection as the API returns it: never the password, only whether one is saved */
export function publicConnection(row: Record<string, unknown>): Record<string, unknown> {
  const { password, ...rest } = row;
  return { ...rest, has_password: typeof password === 'string' && password !== '' };
}

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // List all connections (grouped by region)
  app.get('/', async (request) => {
    const db = getDb();
    const connections = (db.prepare('SELECT * FROM connections ORDER BY region, name').all() as Array<Record<string, unknown>>).map(publicConnection);

    // Group by group_name -> region
    const grouped: Record<string, Record<string, typeof connections>> = {};
    for (const conn of connections) {
      const groupName = (conn.group_name as string) || '';
      const region = conn.region as string;
      
      if (!grouped[groupName]) grouped[groupName] = {};
      if (!grouped[groupName][region]) grouped[groupName][region] = [];
      
      grouped[groupName][region].push(conn);
    }

    return { data: connections, grouped };
  });

  // Get single connection
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    return { data: publicConnection(conn) };
  });

  // Create connection
  app.post<{
    Body: {
      name: string;
      group_name?: string;
      region: string;
      city?: string;
      host: string;
      database_name?: string;
      port?: number;
      driver?: string;
      username?: string;
      password?: string;
      env_credential_key?: string;
      credential_id?: string | null;
    }
  }>('/', async (request) => {
    const db = getDb();
    const id = uuid();
    const {
      name, group_name, region, city, host, database_name,
      port,
      driver = 'ODBC Driver 17 for SQL Server',
      username,
      password,
      env_credential_key,
      credential_id
    } = request.body;

    const isSqlite = driver === 'sqlite';
    const finalPort = isSqlite ? 0 : (port || 1433);
    const finalDbName = isSqlite ? 'sqlite' : (database_name || '');
    const finalCredKey = isSqlite ? 'NONE' : (env_credential_key || 'SQLSERVER');

    db.prepare(`
      INSERT INTO connections (id, name, group_name, region, city, host, database_name, port, driver, username, password, env_credential_key, credential_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, group_name || null, region, city || name, host, finalDbName, finalPort, driver, username || null, isSqlite ? null : encryptSecret(password), finalCredKey, isSqlite ? null : credential_id || null);

    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown>;
    return { data: publicConnection(conn) };
  });

  // Update connection
  app.put<{
    Params: { id: string };
    Body: {
      name?: string; group_name?: string; region?: string; city?: string; host?: string; database_name?: string; port?: number; is_active?: number;
      driver?: string; username?: string | null; password?: string | null; env_credential_key?: string | null; credential_id?: string | null;
    }
  }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    const { name, group_name, region, city, host, database_name, port, is_active, driver, username, password, env_credential_key, credential_id } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (group_name !== undefined) { updates.push('group_name = ?'); values.push(group_name); }
    if (region !== undefined) { updates.push('region = ?'); values.push(region); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city); }
    if (host !== undefined) { updates.push('host = ?'); values.push(host); }
    if (database_name !== undefined) { updates.push('database_name = ?'); values.push(database_name); }
    if (port !== undefined) { updates.push('port = ?'); values.push(port); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    if (driver !== undefined) { updates.push('driver = ?'); values.push(driver); }
    if (username !== undefined) { updates.push('username = ?'); values.push(username || null); }
    if (env_credential_key !== undefined) { updates.push('env_credential_key = ?'); values.push(env_credential_key || null); }
    if (credential_id !== undefined) { updates.push('credential_id = ?'); values.push(driver === 'sqlite' ? null : credential_id || null); }
    // The form never receives the saved password: an empty one means "keep it". A SQLite file has none
    if (driver === 'sqlite') { updates.push('password = NULL'); }
    else if (password) { updates.push('password = ?'); values.push(encryptSecret(password)); }

    if (updates.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    values.push(request.params.id);
    db.prepare(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id) as Record<string, unknown>;
    return { data: publicConnection(conn) };
  });

  // Test connection
  app.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(request.params.id) as Record<string, any> | undefined;
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const startTime = Date.now();
    try {
      if (conn.driver === 'sqlite') {
        const { executeSqliteQuery } = await import('../engine/sqlite.js');
        await executeSqliteQuery(conn.host, 'SELECT 1 as connection_test');
      } else {
        const { executeMssqlQuery } = await import('../engine/mssql.js');
        await executeMssqlQuery(request.params.id, 'SELECT 1 as connection_test');
      }
      const latency = Date.now() - startTime;

      db.prepare("UPDATE connections SET last_tested_at = datetime('now') WHERE id = ?").run(request.params.id);

      return { data: { success: true, latency, message: 'Conexión verificada exitosamente' } };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      return { data: { success: false, latency, message: `Error de conexión: ${err.message}` } };
    }
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
