import { describe, it, expect } from 'vitest';
import { resolveMssqlCredentials } from '../src/engine/mssql';

describe('resolveMssqlCredentials', () => {
  const conn = { name: 'VantiHO40', env_credential_key: 'SQLSERVER' };

  it('uses the credentials saved in the connection first', () => {
    expect(resolveMssqlCredentials({ ...conn, username: 'u', password: 'p' }, { SQLSERVER_USER: 'env' }))
      .toEqual({ user: 'u', password: 'p' });
  });

  it('reads KEY_USER / KEY_PASSWORD from the environment, as backend/.env defines them', () => {
    expect(resolveMssqlCredentials(conn, { SQLSERVER_USER: 'u1', SQLSERVER_PASSWORD: 'p1' })).toEqual({ user: 'u1', password: 'p1' });
    expect(resolveMssqlCredentials({ ...conn, env_credential_key: 'SQLSERVER_2' }, { SQLSERVER_2_USER: 'u2', SQLSERVER_2_PASSWORD: 'p2' }))
      .toEqual({ user: 'u2', password: 'p2' });
  });

  it('still accepts DB_USER_KEY and the shared defaults', () => {
    expect(resolveMssqlCredentials(conn, { DB_USER_SQLSERVER: 'a', DB_PASSWORD_SQLSERVER: 'b' })).toEqual({ user: 'a', password: 'b' });
    expect(resolveMssqlCredentials(conn, { DB_USER_DEFAULT: 'c', DB_PASSWORD_DEFAULT: 'd' })).toEqual({ user: 'c', password: 'd' });
  });

  it('explains what is missing instead of trying a made-up login', () => {
    expect(() => resolveMssqlCredentials({ ...conn, username: '', password: '' }, {}))
      .toThrow(/«VantiHO40» no tiene usuario y contraseña.*SQLSERVER_USER y SQLSERVER_PASSWORD/);
    expect(() => resolveMssqlCredentials(conn, { SQLSERVER_USER: 'u' })).toThrow(/no tiene contraseña/);
  });
});
