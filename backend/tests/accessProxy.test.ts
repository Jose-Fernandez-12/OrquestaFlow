import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import Fastify from 'fastify';
import { authRoutes } from '../src/routes/auth';
import { checkAccess, isForwarded, isFrontendOrigin } from '../src/security/access';

const TOKEN = 'clave-de-prueba-proxy';

beforeAll(() => { process.env.ORQUESTA_ACCESS_TOKEN = TOKEN; });
afterEach(() => {
  delete process.env.ORQUESTA_REQUIRE_ACCESS_TOKEN;
  delete process.env.ORQUESTA_FRONTEND_PORTS;
});

const local = (fields: Partial<Parameters<typeof checkAccess>[0]> = {}) => checkAccess({
  remoteAddress: '127.0.0.1', host: 'localhost:3001', origin: null, cookie: null, authorization: null, ...fields,
});

describe('reverse proxy', () => {
  it('does not let a request relayed by a proxy in as local', () => {
    // nginx/Caddy on this computer: the connection comes from 127.0.0.1, the client is elsewhere
    for (const headers of [
      { 'x-forwarded-for': '203.0.113.7' },
      { forwarded: 'for=203.0.113.7;proto=https' },
      { 'x-real-ip': '203.0.113.7' },
      { 'x-forwarded-host': 'orquesta.example.com' },
      { via: '1.1 proxy' },
    ]) {
      expect(local({ headers }), JSON.stringify(headers)).toMatchObject({ ok: false, status: 401, code: 'auth_required' });
    }
  });

  it('lets it in with the key', () => {
    expect(local({ headers: { 'x-forwarded-for': '203.0.113.7' }, cookie: `orquesta_access=${TOKEN}` })).toEqual({ ok: true, via: 'token' });
  });

  it('keeps direct local requests working, and can require the key for them too', () => {
    expect(local({ headers: { host: 'localhost:3001', accept: 'application/json' } })).toEqual({ ok: true, via: 'local' });
    process.env.ORQUESTA_REQUIRE_ACCESS_TOKEN = 'true';
    expect(local()).toMatchObject({ ok: false, status: 401 });
    expect(local({ authorization: `Bearer ${TOKEN}` })).toEqual({ ok: true, via: 'token' });
  });

  it('only counts headers that carry a value', () => {
    expect(isForwarded({ 'x-forwarded-for': '' })).toBe(false);
    expect(isForwarded({ 'x-forwarded-for': ['10.0.0.1'] })).toBe(true);
    expect(isForwarded(undefined)).toBe(false);
  });
});

describe('GET /api/auth/token', () => {
  async function server() {
    const app = Fastify();
    await app.register(authRoutes, { prefix: '/api/auth' });
    return app;
  }

  const get = async (headers: Record<string, string>, remoteAddress = '127.0.0.1') => {
    const app = await server();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/token', headers: { host: 'localhost:3001', ...headers }, remoteAddress });
      return { status: res.statusCode, body: res.json(), cacheControl: res.headers['cache-control'] };
    } finally {
      await app.close();
    }
  };

  it('gives the key to OrquestaFlow’s own page on this computer, never cached', async () => {
    const res = await get({ origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe(TOKEN);
    expect(res.cacheControl).toBe('no-store');
    // Without Origin (curl on this computer) too
    expect((await get({})).status).toBe(200);
  });

  it('refuses another page on this computer, on another port', async () => {
    const res = await get({ origin: 'http://localhost:8080' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('refuses other computers and proxied requests, even with the key', async () => {
    expect((await get({ origin: 'http://localhost:5173' }, '203.0.113.7')).status).toBe(403);
    expect((await get({ origin: 'http://localhost:5173', 'x-forwarded-for': '203.0.113.7' })).status).toBe(403);
    expect((await get({ authorization: `Bearer ${TOKEN}` }, '203.0.113.7')).status).toBe(403);
  });

  it('accepts other frontend ports when configured', async () => {
    expect(isFrontendOrigin('http://localhost:8080')).toBe(false);
    process.env.ORQUESTA_FRONTEND_PORTS = '8080';
    expect(isFrontendOrigin('http://localhost:8080')).toBe(true);
    expect(isFrontendOrigin('https://evil.example:8080')).toBe(false);
  });
});
