import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { decryptSecret, encryptSecret } from './secrets.js';

/**
 * Credential store: secrets saved once, encrypted (see secrets.ts), and used by reference from HTTP
 * nodes, SQL Server connections and the secret fields of other nodes (`cred:nombre`). The secret
 * itself never leaves the server: the API lists what exists, never its value.
 */

export type CredentialType = 'bearer' | 'basic' | 'api_key';
export const CREDENTIAL_TYPES: CredentialType[] = ['bearer', 'basic', 'api_key'];

interface CredentialRow {
  id: string;
  name: string;
  type: CredentialType;
  username: string | null;
  header_name: string | null;
  secret: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicCredential {
  id: string;
  name: string;
  type: CredentialType;
  username: string | null;
  header_name: string | null;
  notes: string | null;
  has_secret: boolean;
  updated_at: string;
  /** Where it is used, so deleting it does not break something silently */
  used_by: { connections: string[]; flows: string[] };
}

export interface CredentialInput {
  name?: string;
  type?: string;
  username?: string | null;
  header_name?: string | null;
  secret?: string | null;
  notes?: string | null;
}

export class CredentialError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function usage(row: CredentialRow): PublicCredential['used_by'] {
  const db = getDb();
  const connections = (db.prepare('SELECT name FROM connections WHERE credential_id = ? ORDER BY name').all(row.id) as Array<{ name: string }>).map(c => c.name);
  // A node references it by id (HTTP) or by name in a secret field (cred:nombre)
  const flows = (db.prepare(`
    SELECT name FROM flows
    WHERE instr(definition, ?) > 0 OR instr(definition, ?) > 0
    ORDER BY name
  `).all(`"credentialId":"${row.id}"`, `"cred:${row.name}"`) as Array<{ name: string }>).map(f => f.name);
  return { connections, flows };
}

function toPublic(row: CredentialRow): PublicCredential {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    username: row.username,
    header_name: row.header_name,
    notes: row.notes,
    has_secret: !!row.secret,
    updated_at: row.updated_at,
    used_by: usage(row),
  };
}

function findRow(idOrName: string): CredentialRow | undefined {
  const db = getDb();
  return (db.prepare('SELECT * FROM credentials WHERE id = ?').get(idOrName)
    ?? db.prepare('SELECT * FROM credentials WHERE name = ?').get(idOrName)) as CredentialRow | undefined;
}

export function listCredentials(): PublicCredential[] {
  return (getDb().prepare('SELECT * FROM credentials ORDER BY name').all() as CredentialRow[]).map(toPublic);
}

function validated(input: CredentialInput, existing?: CredentialRow) {
  const name = (input.name ?? existing?.name ?? '').trim();
  const type = (input.type ?? existing?.type) as CredentialType;
  if (!name) throw new CredentialError('La credencial necesita un nombre.');
  if (!NAME_PATTERN.test(name)) throw new CredentialError('El nombre solo admite letras, números, guion, guion bajo y punto (sin espacios), para poder escribirlo como cred:nombre.');
  if (!CREDENTIAL_TYPES.includes(type)) throw new CredentialError('Tipo de credencial no válido.');

  const duplicate = getDb().prepare('SELECT id FROM credentials WHERE name = ? AND id != ?').get(name, existing?.id ?? '') as { id: string } | undefined;
  if (duplicate) throw new CredentialError(`Ya existe una credencial llamada «${name}».`, 409);

  const username = type === 'basic' ? (input.username ?? existing?.username ?? '').trim() : null;
  const headerName = type === 'api_key' ? (input.header_name ?? existing?.header_name ?? '').trim() : null;
  if (type === 'basic' && !username) throw new CredentialError('Indica el usuario.');
  if (type === 'api_key' && !headerName) throw new CredentialError('Indica el nombre de la cabecera, por ejemplo X-API-Key.');
  if (headerName && !/^[A-Za-z0-9-]+$/.test(headerName)) throw new CredentialError('El nombre de la cabecera solo admite letras, números y guiones.');

  // An empty secret on update keeps the saved one: the form never receives it
  const secret = input.secret ? encryptSecret(input.secret) : existing?.secret ?? null;
  if (!secret) throw new CredentialError(type === 'basic' ? 'Indica la contraseña.' : type === 'bearer' ? 'Indica el token.' : 'Indica la clave.');

  return { name, type, username, headerName, secret, notes: (input.notes ?? existing?.notes ?? '').trim() || null };
}

export function createCredential(input: CredentialInput): PublicCredential {
  const v = validated(input);
  const id = uuid();
  getDb().prepare(`
    INSERT INTO credentials (id, name, type, username, header_name, secret, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, v.name, v.type, v.username, v.headerName, v.secret, v.notes);
  return toPublic(findRow(id)!);
}

export function updateCredential(id: string, input: CredentialInput): PublicCredential {
  const existing = getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  if (!existing) throw new CredentialError('La credencial no existe.', 404);
  if (input.name !== undefined && input.name.trim() !== existing.name) {
    const used = usage(existing);
    // Nodes that use cred:nombre reference it by name; renaming would silently break them
    const byName = (getDb().prepare('SELECT COUNT(*) AS count FROM flows WHERE instr(definition, ?) > 0').get(`"cred:${existing.name}"`) as { count: number }).count;
    if (byName > 0) throw new CredentialError(`No se puede renombrar: ${used.flows.length === 1 ? 'un flujo la usa' : 'hay flujos que la usan'} como cred:${existing.name}.`, 409);
  }
  const v = validated(input, existing);
  getDb().prepare(`
    UPDATE credentials SET name = ?, type = ?, username = ?, header_name = ?, secret = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.name, v.type, v.username, v.headerName, v.secret, v.notes, id);
  return toPublic(findRow(id)!);
}

export function deleteCredential(id: string): void {
  const existing = getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  if (!existing) throw new CredentialError('La credencial no existe.', 404);
  const used = usage(existing);
  const where = [
    used.connections.length > 0 ? `conexiones: ${used.connections.join(', ')}` : '',
    used.flows.length > 0 ? `flujos: ${used.flows.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  if (where) throw new CredentialError(`No se puede eliminar «${existing.name}» porque está en uso (${where}).`, 409);
  getDb().prepare('DELETE FROM credentials WHERE id = ?').run(id);
}

// ── Use by the engine (the only code that reads the secret) ──

function requireRow(idOrName: unknown, usedBy: string): CredentialRow {
  const key = String(idOrName ?? '').trim();
  if (!key) throw new Error(`${usedBy} no tiene una credencial elegida.`);
  const row = findRow(key);
  if (!row) throw new Error(`${usedBy} usa una credencial que ya no existe. Elige otra en sus propiedades o créala en Configuración → Credenciales.`);
  return row;
}

/** The secret of a credential referenced as `cred:nombre` in a secret field */
export function credentialSecret(name: string, usedBy = 'Este nodo'): string {
  return decryptSecret(requireRow(name, usedBy).secret) ?? '';
}

/** Headers an HTTP request needs to authenticate with the credential, and the same with the secret masked for previews */
export function credentialHeaders(idOrName: unknown, usedBy = 'Este nodo'): { headers: Record<string, string>; masked: Record<string, string> } {
  const row = requireRow(idOrName, usedBy);
  const secret = decryptSecret(row.secret) ?? '';
  const mask = '••••••••';
  if (row.type === 'bearer') {
    return { headers: { Authorization: `Bearer ${secret}` }, masked: { Authorization: `Bearer ${mask}` } };
  }
  if (row.type === 'basic') {
    const encoded = Buffer.from(`${row.username ?? ''}:${secret}`).toString('base64');
    return { headers: { Authorization: `Basic ${encoded}` }, masked: { Authorization: `Basic ${mask}` } };
  }
  const header = row.header_name || 'X-API-Key';
  return { headers: { [header]: secret }, masked: { [header]: mask } };
}

/** User and password for a database connection that points at a stored credential */
export function credentialLogin(idOrName: unknown, usedBy: string): { username: string; password: string } {
  const row = requireRow(idOrName, usedBy);
  if (row.type !== 'basic') throw new Error(`${usedBy} necesita una credencial de tipo «Usuario y contraseña»; «${row.name}» no lo es.`);
  return { username: row.username ?? '', password: decryptSecret(row.secret) ?? '' };
}

/** Name and type for messages and exports, without the secret */
export function credentialSummary(idOrName: unknown): { id: string; name: string; type: CredentialType; username: string | null; header_name: string | null } | null {
  const key = String(idOrName ?? '').trim();
  const row = key ? findRow(key) : undefined;
  return row ? { id: row.id, name: row.name, type: row.type, username: row.username, header_name: row.header_name } : null;
}
