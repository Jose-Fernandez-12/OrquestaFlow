import { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';

interface EnvironmentRow {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  variables_json: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PublicEnvironment {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  variables: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

function parseVariables(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = value === null || value === undefined ? '' : String(value);
    }
    return result;
  } catch {
    return {};
  }
}

function normalizeVariables(input: unknown): Record<string, string> | null {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const clean: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    clean[key] = rawVal === null || rawVal === undefined ? '' : String(rawVal);
  }
  return clean;
}

function normalizeSlug(rawSlug: unknown, fallbackName?: string): string {
  const base = typeof rawSlug === 'string' && rawSlug.trim() ? rawSlug : (fallbackName || '');
  return base
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatEnvironment(row: EnvironmentRow): PublicEnvironment {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    is_active: Number(row.is_active) === 1 ? 1 : 0,
    variables: parseVariables(row.variables_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function environmentRoutes(app: FastifyInstance): Promise<void> {
  // List all environments
  app.get('/', async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, name, slug, is_active, variables_json, created_at, updated_at
      FROM environments
      ORDER BY is_active DESC, created_at ASC, name ASC
    `).all() as EnvironmentRow[];
    return { data: rows.map(formatEnvironment) };
  });

  // Get currently active environment
  app.get('/active', async (_request, reply) => {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, name, slug, is_active, variables_json, created_at, updated_at
      FROM environments
      WHERE is_active = 1
      LIMIT 1
    `).get() as EnvironmentRow | undefined;
    if (!row) return reply.status(404).send({ error: 'No hay ningún entorno activo' });
    return { data: formatEnvironment(row) };
  });

  // Create environment
  app.post<{ Body: { name?: string; slug?: string; variables?: Record<string, unknown> } }>(
    '/',
    async (request, reply) => {
      const db = getDb();
      const body = request.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return reply.status(400).send({ error: 'El nombre del entorno es obligatorio' });
      }

      const slug = normalizeSlug(body.slug, name);
      if (!slug || !SLUG_PATTERN.test(slug)) {
        return reply.status(400).send({ error: 'El slug del entorno solo admite minúsculas, números, guion y guion bajo' });
      }

      const existingSlug = db.prepare('SELECT id FROM environments WHERE slug = ?').get(slug);
      if (existingSlug) {
        return reply.status(409).send({ error: `Ya existe un entorno con slug «${slug}»` });
      }

      const variables = normalizeVariables(body.variables);
      if (variables === null) {
        return reply.status(400).send({ error: 'variables debe ser un objeto clave-valor' });
      }

      const id = uuid();
      db.prepare(`
        INSERT INTO environments (id, name, slug, is_active, variables_json, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))
      `).run(id, name, slug, JSON.stringify(variables));

      const created = db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvironmentRow;
      return { data: formatEnvironment(created) };
    }
  );

  // Update environment
  app.put<{ Params: { id: string }; Body: { name?: string; slug?: string; variables?: Record<string, unknown> } }>(
    '/:id',
    async (request, reply) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM environments WHERE id = ?').get(request.params.id) as EnvironmentRow | undefined;
      if (!existing) {
        return reply.status(404).send({ error: 'Entorno no encontrado' });
      }

      const body = request.body ?? {};
      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          return reply.status(400).send({ error: 'El nombre del entorno no puede estar vacío' });
        }
        updates.push('name = ?');
        values.push(name);
      }

      if (body.slug !== undefined) {
        const slug = normalizeSlug(body.slug);
        if (!slug || !SLUG_PATTERN.test(slug)) {
          return reply.status(400).send({ error: 'El slug del entorno solo admite minúsculas, números, guion y guion bajo' });
        }
        const duplicate = db.prepare('SELECT id FROM environments WHERE slug = ? AND id != ?').get(slug, request.params.id);
        if (duplicate) {
          return reply.status(409).send({ error: `Ya existe otro entorno con slug «${slug}»` });
        }
        updates.push('slug = ?');
        values.push(slug);
      }

      if (body.variables !== undefined) {
        const variables = normalizeVariables(body.variables);
        if (variables === null) {
          return reply.status(400).send({ error: 'variables debe ser un objeto clave-valor' });
        }
        updates.push('variables_json = ?');
        values.push(JSON.stringify(variables));
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No hay campos para actualizar' });
      }

      updates.push("updated_at = datetime('now')");
      values.push(request.params.id);

      db.prepare(`UPDATE environments SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const updated = db.prepare('SELECT * FROM environments WHERE id = ?').get(request.params.id) as EnvironmentRow;
      return { data: formatEnvironment(updated) };
    }
  );

  // Activate environment
  app.post<{ Params: { id: string } }>('/:id/activate', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM environments WHERE id = ?').get(request.params.id) as EnvironmentRow | undefined;
    if (!existing) {
      return reply.status(404).send({ error: 'Entorno no encontrado' });
    }

    db.prepare("UPDATE environments SET is_active = 0, updated_at = datetime('now')").run();
    db.prepare("UPDATE environments SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(request.params.id);

    const updated = db.prepare('SELECT * FROM environments WHERE id = ?').get(request.params.id) as EnvironmentRow;
    return { data: formatEnvironment(updated) };
  });

  // Delete environment
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM environments WHERE id = ?').get(request.params.id) as EnvironmentRow | undefined;
    if (!existing) {
      return reply.status(404).send({ error: 'Entorno no encontrado' });
    }
    if (Number(existing.is_active) === 1) {
      return reply.status(409).send({ error: 'No se puede eliminar el entorno activo. Activa otro entorno primero.' });
    }

    db.prepare('DELETE FROM environments WHERE id = ?').run(request.params.id);
    return { data: { deleted: true } };
  });
}
