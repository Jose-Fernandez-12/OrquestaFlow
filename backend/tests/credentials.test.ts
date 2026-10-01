import { describe, it, expect } from 'vitest';
import { resolveMssqlCredentials } from '../src/engine/mssql';
import { stripNodeSecrets } from '../src/routes/flows';

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

describe('stripNodeSecrets', () => {
  const node = (data: Record<string, any>) => ({ id: 'n', type: 'httpRequest', data });
  const strip = (data: Record<string, any>) => stripNodeSecrets({ nodes: [node(data)], edges: [] }).nodes[0].data;

  it('removes passwords typed inside a JSON request body and keeps the rest', () => {
    const data = strip({ body: '{\n  "username": "Jose14",\n  "password": "MDAwMA==",\n  "rememberMe": true\n}' });
    expect(JSON.parse(data.body)).toEqual({ username: 'Jose14', password: '', rememberMe: true });
  });

  it('keeps references and env: values, which do not hold the secret', () => {
    const data = strip({
      authToken: '{{Logearse.data.token}}',
      body: '{"password": "{{Variables.clave}}", "apiKey": "env:API_KEY"}',
    });
    expect(data.authToken).toBe('{{Logearse.data.token}}');
    expect(JSON.parse(data.body)).toEqual({ password: '{{Variables.clave}}', apiKey: 'env:API_KEY' });
  });

  it('removes a token typed directly in the node', () => {
    expect(strip({ authToken: 'eyJhbGciOi...' }).authToken).toBe('');
  });

  it('leaves bodies that are not JSON untouched', () => {
    expect(strip({ body: '{{_item}}' }).body).toBe('{{_item}}');
  });
});
