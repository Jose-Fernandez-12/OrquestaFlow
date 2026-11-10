import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Encryption of the secrets OrquestaFlow keeps in its database (passwords of SQL Server connections).
 * AES-256-GCM with one key per installation: ORQUESTA_SECRET_KEY when it is set, otherwise
 * data/secret.key, created on first use. Without that key the saved passwords cannot be read, so a
 * backup of data/orquesta.sqlite must include data/secret.key.
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

export function secretKeyFile(): string {
  return path.join(process.cwd(), 'data', 'secret.key');
}

function readKeyFile(file: string): Buffer {
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`${file} no contiene una clave de cifrado válida`);
  return key;
}

function secretKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.ORQUESTA_SECRET_KEY?.trim();
  if (fromEnv) {
    cachedKey = crypto.createHash('sha256').update(fromEnv).digest();
  } else if (process.env.ORQUESTA_DB_PATH === ':memory:') {
    // Tests: the database lives only in memory, and so does its key
    cachedKey = crypto.randomBytes(32);
  } else {
    const file = secretKeyFile();
    if (fs.existsSync(file)) {
      cachedKey = readKeyFile(file);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const key = crypto.randomBytes(32);
      try {
        fs.writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
        cachedKey = key;
      } catch (err: any) {
        // Another process created it first: use that one
        if (err?.code !== 'EEXIST') throw err;
        cachedKey = readKeyFile(file);
      }
    }
  }
  return cachedKey;
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypted text to store; null for an empty secret. A value that is already encrypted is kept as is,
 * but only when this installation's key opens it: anything else that merely starts with "enc:v1:"
 * (typed by someone, or from another installation) is encrypted like any other text, so it is never
 * stored in clear. Numbers are accepted as text; other values are refused.
 */
export function encryptSecret(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string' && typeof input !== 'number') {
    const err: any = new TypeError('El secreto debe ser un texto.');
    err.statusCode = 400;
    throw err;
  }
  const plain = String(input);
  if (isEncryptedSecret(plain) && canDecrypt(plain)) return plain;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function canDecrypt(value: string): boolean {
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

/** The secret in clear. Values saved before encryption existed are returned unchanged */
export function decryptSecret(value: string | null | undefined): string | null | undefined {
  if (!isEncryptedSecret(value)) return value;

  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'No se pudo descifrar la contraseña guardada: la clave de cifrado cambió (data/secret.key u ORQUESTA_SECRET_KEY). ' +
      'Vuelve a escribir la contraseña en la conexión.'
    );
  }
}
