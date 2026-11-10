import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { getDb } from '../src/db/database';
import { executeFlowEngine } from '../src/engine/executor';
import { isSecretReference, openDefinition, sealDefinition, stripNodeSecrets } from '../src/engine/nodeSecrets';
import { encryptSecret, decryptSecret } from '../src/engine/secrets';
import { pruneExecutionLogs, DEFAULT_RETENTION_DAYS } from '../src/engine/retention';
import { flowRoutes } from '../src/routes/flows';
import { jsonResponse, setupDb } from './helpers';

beforeAll(setupDb);

const definition = (token: string, extra: Record<string, any> = {}) => JSON.stringify({
  nodes: [
    { id: 's', type: 'start', data: { label: 'Inicio' } },
    { id: 'h', type: 'httpRequest', data: { label: 'API', method: 'GET', endpoint: 'https://api.example.test/v1', authType: 'bearer', authToken: token, ...extra } },
  ],
  edges: [{ id: 's->h', source: 's', target: 'h' }],
});

describe('secrets typed into nodes', () => {
  it('are stored encrypted and opened back to the same definition', () => {
    const sealed = sealDefinition(definition('tok_en_claro'));
    expect(sealed).not.toContain('tok_en_claro');
    expect(JSON.parse(sealed).nodes[1].data.authToken).toMatch(/^enc:v1:/);
    expect(JSON.parse(openDefinition(sealed))).toEqual(JSON.parse(definition('tok_en_claro')));
  });

  it('leave references and nodes without secrets untouched', () => {
    for (const ref of ['env:API_TOKEN', 'cred:api-ventas', '{{login.data.token}}']) {
      expect(sealDefinition(definition(ref))).toBe(definition(ref));
    }
  });

  it('keep the same ciphertext when the secret did not change, so no new version is recorded', () => {
    const first = sealDefinition(definition('uno'));
    expect(sealDefinition(definition('uno'), first)).toBe(first);
    expect(sealDefinition(definition('dos'), first)).not.toBe(first);
  });

  it('become empty when the key that encrypted them is gone, instead of breaking the flow', () => {
    const foreign = definition('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(JSON.parse(openDefinition(foreign)).nodes[1].data.authToken).toBe('');
  });
});

describe('flows API and engine with sealed secrets', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    getDb().exec('DELETE FROM flows; DELETE FROM flow_versions');
    app = Fastify();
    await app.register(flowRoutes, { prefix: '/api/flows' });
  });

  it('stores flows and their versions encrypted, returns them in clear and runs with the secret', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/flows', payload: { name: 'Con token', definition: definition('tok_123') } })).json().data;
    expect(JSON.parse(created.definition).nodes[1].data.authToken).toBe('tok_123');

    // Saving twice without changes records one version, and every stored copy is encrypted
    await app.inject({ method: 'PUT', url: `/api/flows/${created.id}`, payload: { definition: definition('tok_456') } });
    await app.inject({ method: 'PUT', url: `/api/flows/${created.id}`, payload: { definition: definition('tok_456') } });
    const stored = getDb().prepare('SELECT definition FROM flows WHERE id = ?').get(created.id) as { definition: string };
    const versions = getDb().prepare('SELECT definition FROM flow_versions WHERE flow_id = ?').all(created.id) as Array<{ definition: string }>;
    for (const text of [stored.definition, ...versions.map(v => v.definition)]) {
      expect(text).not.toMatch(/tok_123|tok_456/);
    }
    expect(versions.length).toBe(2); // the initial state and the change

    const fetched = (await app.inject({ method: 'GET', url: `/api/flows/${created.id}` })).json().data;
    expect(JSON.parse(fetched.definition).nodes[1].data.authToken).toBe('tok_456');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    try {
      await executeFlowEngine(created.id);
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok_456');
    } finally {
      fetchMock.mockRestore();
    }
    await app.close();
  });
});

describe('export filter and encryption input', () => {
  it('only keeps values that are entirely a reference', () => {
    expect(isSecretReference('env:API_TOKEN')).toBe(true);
    expect(isSecretReference('env:no es variable')).toBe(false);
    expect(isSecretReference('Bearer {{login.token}}')).toBe(false);
    expect(isSecretReference('abc{{x}}def')).toBe(false);
    const { nodes } = stripNodeSecrets({ nodes: [{ id: 'a', data: { authToken: 'abc{{x}}', apiKey: 'env:no es variable', secret: '{{wh.secret}}' } }], edges: [] });
    expect(nodes[0].data).toEqual({ authToken: '', apiKey: '', secret: '{{wh.secret}}' });
  });

  it('encrypts a value that only looks encrypted and refuses non-text', () => {
    const fake = 'enc:v1:esto-no-es-un-cifrado';
    const stored = encryptSecret(fake)!;
    expect(stored).not.toBe(fake);
    expect(decryptSecret(stored)).toBe(fake);
    const real = encryptSecret('x')!;
    expect(encryptSecret(real)).toBe(real);
    expect(decryptSecret(encryptSecret(1234)!)).toBe('1234');
    expect(() => encryptSecret({ a: 1 })).toThrow(/texto/);
  });
});

describe('retention is opt-in', () => {
  it('keeps everything until a period is chosen', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(0);
    getDb().exec('DELETE FROM execution_logs; DELETE FROM system_settings');
    getDb().prepare("INSERT INTO execution_logs (id, target_type, target_id, status, started_at) VALUES ('viejo', 'flow', 'f', 'completed', '2020-01-01 00:00:00'), ('nuevo', 'flow', 'f', 'completed', datetime('now'))").run();
    expect(pruneExecutionLogs()).toBe(0);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM execution_logs').get() as { n: number }).n).toBe(2);
  });
});
