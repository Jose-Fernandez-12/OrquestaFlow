import { decryptSecret, encryptSecret, isEncryptedSecret } from './secrets.js';

/**
 * Secrets typed straight into a node (an HTTP token, an AI API key, a webhook secret…). In the
 * database they are kept encrypted, in the flow and in each saved version, and they are decrypted
 * only where they are used: the engine, the webhook check, and the editor that shows the field.
 * References are not secrets and stay readable: env:VARIABLE, cred:nombre and a single {{template}}.
 */

export const SECRET_NODE_FIELDS = ['apiKey', 'clientSecret', 'password', 'refreshToken', 'secret', 'authToken', 'authPassword'];

const ENV_REFERENCE = /^env:[A-Za-z_][A-Za-z0-9_]*$/;
const CREDENTIAL_REFERENCE = /^cred:[A-Za-z0-9_.-]+$/;
// The whole value is one template: "Bearer {{x}}" or "abc{{x}}" still carry literal text
const TEMPLATE_REFERENCE = /^\{\{[^{}]+\}\}$/;

/** A value that points at a secret kept elsewhere, as opposed to the secret itself */
export function isSecretReference(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return ENV_REFERENCE.test(v) || CREDENTIAL_REFERENCE.test(v) || TEMPLATE_REFERENCE.test(v);
}

type Definition = { nodes?: any[]; edges?: any[]; [key: string]: any };

function parse(definition: string | Definition | null | undefined): Definition | null {
  if (!definition) return null;
  if (typeof definition !== 'string') return definition;
  try {
    const parsed = JSON.parse(definition);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapSecretFields(definition: Definition, map: (value: string, nodeId: string, field: string) => string): Definition {
  return {
    ...definition,
    nodes: (definition.nodes || []).map(node => {
      if (!node?.data) return node;
      let data = node.data;
      for (const field of SECRET_NODE_FIELDS) {
        const value = data[field];
        if (typeof value !== 'string' || value === '') continue;
        const next = map(value, String(node.id), field);
        if (next !== value) data = { ...data, [field]: next };
      }
      return data === node.data ? node : { ...node, data };
    }),
  };
}

function tryDecrypt(value: string): string | null {
  try {
    return decryptSecret(value) ?? '';
  } catch {
    return null;
  }
}

/**
 * The definition to store, with literal secrets encrypted. `previous` is the stored definition it
 * replaces: a secret that did not change keeps its ciphertext, so an unchanged flow is stored as the
 * same text (versions are only recorded when something changed).
 */
export function sealDefinition(definition: string, previous?: string | null): string {
  const parsed = parse(definition);
  if (!parsed) return definition;

  const previousCipher = new Map<string, string>();
  const old = parse(previous);
  if (old) {
    for (const node of old.nodes || []) {
      for (const field of SECRET_NODE_FIELDS) {
        const value = node?.data?.[field];
        if (isEncryptedSecret(value)) previousCipher.set(`${node.id}\u0000${field}`, value);
      }
    }
  }

  let changed = false;
  const sealed = mapSecretFields(parsed, (value, nodeId, field) => {
    if (isSecretReference(value)) return value;
    // Already encrypted with this installation's key
    if (isEncryptedSecret(value) && tryDecrypt(value) !== null) return value;
    const reused = previousCipher.get(`${nodeId}\u0000${field}`);
    if (reused && tryDecrypt(reused) === value) {
      changed = true;
      return reused;
    }
    changed = true;
    return encryptSecret(value) ?? '';
  });
  return changed ? JSON.stringify(sealed) : definition;
}

/** The definition with its secrets in clear, for the engine and the editor. Unreadable ones become empty */
export function openDefinition(definition: string): string {
  const parsed = parse(definition);
  if (!parsed) return definition;
  let changed = false;
  const opened = mapSecretFields(parsed, value => {
    if (!isEncryptedSecret(value)) return value;
    changed = true;
    // Encrypted with another key (data/secret.key replaced): the field has to be typed again
    return tryDecrypt(value) ?? '';
  });
  return changed ? JSON.stringify(opened) : definition;
}

/** A flow or version row as the API returns it: the definition with its secrets in clear */
export function withOpenDefinition<T extends { definition?: unknown }>(row: T): T {
  if (!row || typeof row.definition !== 'string') return row;
  return { ...row, definition: openDefinition(row.definition) };
}

/**
 * Secrets typed directly into nodes are removed from exports. References are kept: env:VARIABLE,
 * cred:nombre and a value that is only a {{template}}.
 */
export function stripNodeSecrets(definition: { nodes: any[]; edges: any[] }) {
  return mapSecretFields(definition, value => (isSecretReference(value) ? value : '')) as { nodes: any[]; edges: any[] };
}
