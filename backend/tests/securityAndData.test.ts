import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getDb } from '../src/db/database';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/engine/secrets';
import { resolveMssqlCredentials } from '../src/engine/mssql';
import { pruneExecutionLogs } from '../src/engine/retention';
import { publicConnection } from '../src/routes/connections';
import {
  checkAccess, clearLoginFailures, hostnameOf, isAllowedHostname, isLocalAddress, loginLockedUntil, readCookie, recordLoginFailure,
} from '../src/security/access';
import { setupDb } from './helpers';

const TOKEN = 'clave-de-prueba-123';

describe('secrets', () => {
  it('encrypts so the stored text never contains the password, and decrypts it back', () => {
    const stored = encryptSecret('S3cret!')!;
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain('S3cret!');
    expect(encryptSecret('S3cret!')).not.toBe(stored); // random IV each time
    expect(decryptSecret(stored)).toBe('S3cret!');
  });

  it('keeps empty secrets empty, leaves encrypted ones alone and reads old plain passwords', () => {
    expect(encryptSecret('')).toBeNull();
    expect(encryptSecret(null)).toBeNull();
    const stored = encryptSecret('x')!;
    expect(encryptSecret(stored)).toBe(stored);
    expect(decryptSecret('plano-antiguo')).toBe('plano-antiguo');
    expect(decryptSecret(null)).toBeNull();
  });

  it('refuses a tampered value with a message that says what to do', () => {
    const stored = encryptSecret('S3cret!')!;
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow(/Vuelve a escribir la contraseña/);
  });

  it('gives SQL Server the decrypted password', () => {
    const creds = resolveMssqlCredentials({ name: 'Ventas', username: 'sa', password: encryptSecret('P@ss')!, env_credential_key: 'X' }, {});
    expect(creds).toEqual({ user: 'sa', password: 'P@ss' });
  });

  it('never returns the password through the API, only whether there is one', () => {
    expect(publicConnection({ id: 'c1', name: 'Ventas', password: encryptSecret('P@ss') })).toEqual({ id: 'c1', name: 'Ventas', has_password: true });
    expect(publicConnection({ id: 'c2', password: null })).toEqual({ id: 'c2', has_password: false });
  });
});

describe('access', () => {
  const previous = process.env.ORQUESTA_ALLOWED_HOSTS;
  beforeAll(() => { process.env.ORQUESTA_ACCESS_TOKEN = TOKEN; });
  afterEach(() => {
    if (previous === undefined) delete process.env.ORQUESTA_ALLOWED_HOSTS;
    else process.env.ORQUESTA_ALLOWED_HOSTS = previous;
  });

  const request = (fields: Partial<Parameters<typeof checkAccess>[0]>) => checkAccess({
    remoteAddress: '127.0.0.1', host: 'localhost:3001', origin: null, cookie: null, authorization: null, ...fields,
  });

  it('lets this computer in without a key when it uses one of its own names', () => {
    expect(request({})).toEqual({ ok: true, via: 'local' });
    expect(request({ remoteAddress: '::ffff:127.0.0.1', host: '127.0.0.1:3001' })).toMatchObject({ ok: true, via: 'local' });
    expect(request({ remoteAddress: '::1', host: '[::1]:3001', origin: 'http://localhost:5173' })).toMatchObject({ ok: true });
  });

  it('refuses a local request addressed to a foreign name (DNS rebinding)', () => {
    expect(request({ host: 'evil.example:3001' })).toMatchObject({ ok: false, status: 403, code: 'host_not_allowed' });
    process.env.ORQUESTA_ALLOWED_HOSTS = 'orquesta.miempresa.local, otro';
    expect(request({ host: 'orquesta.miempresa.local:3001' })).toMatchObject({ ok: true });
  });

  it('asks other computers for the key, by cookie or bearer header', () => {
    expect(request({ remoteAddress: '203.0.113.7', host: '203.0.113.1:3001' })).toMatchObject({ ok: false, status: 401, code: 'auth_required' });
    expect(request({ remoteAddress: '203.0.113.7', cookie: `a=1; orquesta_access=${TOKEN}` })).toEqual({ ok: true, via: 'token' });
    expect(request({ remoteAddress: '203.0.113.7', authorization: `Bearer ${TOKEN}` })).toEqual({ ok: true, via: 'token' });
    expect(request({ remoteAddress: '203.0.113.7', cookie: 'orquesta_access=otra' })).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses requests sent by pages of other sites, even with the key', () => {
    expect(request({ origin: 'https://evil.example' })).toMatchObject({ ok: false, status: 403, code: 'origin_not_allowed' });
    expect(request({ remoteAddress: '203.0.113.7', origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` })).toMatchObject({ ok: false, status: 403 });
    expect(request({ origin: 'http://localhost:5173' })).toMatchObject({ ok: true });
  });

  it('reads names, addresses and cookies the way browsers send them', () => {
    expect(hostnameOf('localhost:3001')).toBe('localhost');
    expect(hostnameOf('[::1]:3001')).toBe('[::1]');
    expect(isAllowedHostname('app.localhost')).toBe(true);
    expect(isAllowedHostname('evil.example')).toBe(false);
    expect(isLocalAddress('127.0.0.5')).toBe(true);
    expect(isLocalAddress('203.0.113.7')).toBe(false);
    expect(readCookie('a=1; orquesta_access=x%20y', 'orquesta_access')).toBe('x y');
    expect(readCookie(undefined, 'orquesta_access')).toBeNull();
  });

  it('locks an address out for a while after many wrong keys', () => {
    const ip = '203.0.113.9';
    const now = 1_000_000;
    for (let i = 0; i < 9; i++) recordLoginFailure(ip, now);
    expect(loginLockedUntil(ip, now)).toBeNull();
    recordLoginFailure(ip, now);
    expect(loginLockedUntil(ip, now)).toBe(now + 10 * 60_000);
    expect(loginLockedUntil(ip, now + 10 * 60_000 + 1)).toBeNull();
    clearLoginFailures(ip);
  });
});

describe('execution history retention', () => {
  const NOW = Date.parse('2026-11-10T00:00:00Z');
  const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  let seq = 0;
  const log = (target: string, days: number, status = 'completed') => {
    const id = `r${++seq}`;
    getDb().prepare("INSERT INTO execution_logs (id, target_type, target_id, status, started_at) VALUES (?, 'flow', ?, ?, ?)").run(id, target, status, daysAgo(days));
    return id;
  };
  const ids = () => (getDb().prepare('SELECT id FROM execution_logs ORDER BY rowid').all() as Array<{ id: string }>).map(r => r.id);

  beforeAll(setupDb);
  beforeEach(() => getDb().exec('DELETE FROM execution_logs'));

  it('deletes runs older than the period but keeps the latest run of each target', () => {
    const oldA = log('a', 200);
    const recentA = log('a', 5);
    const onlyB = log('b', 400);              // the only run of b: kept however old
    const oldC = log('c', 120);
    const lastC = log('c', 100, 'error');     // latest of c, older than the period: kept
    const running = log('d', 300, 'running');
    log('d', 1);

    expect(pruneExecutionLogs(90, NOW)).toBe(2);
    expect(ids()).toEqual(expect.arrayContaining([recentA, onlyB, lastC, running]));
    expect(ids()).not.toContain(oldA);
    expect(ids()).not.toContain(oldC);
  });

  it('keeps everything when the period is 0', () => {
    log('a', 1000);
    log('a', 999);
    expect(pruneExecutionLogs(0, NOW)).toBe(0);
    expect(ids()).toHaveLength(2);
  });
});
