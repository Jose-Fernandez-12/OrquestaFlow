import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '../src/db/database';
import {
  CredentialError, createCredential, credentialHeaders, credentialLogin, credentialSecret, deleteCredential, listCredentials, updateCredential,
} from '../src/engine/credentials';
import { describeMssqlCredentials } from '../src/engine/mssql';
import { stripNodeSecrets } from '../src/routes/flows';
import { runFlow, edge, jsonResponse, setupDb } from './helpers';
import { vi } from 'vitest';

beforeAll(setupDb);
beforeEach(() => {
  const db = getDb();
  for (const table of ['credentials', 'connections', 'flows']) db.exec(`DELETE FROM ${table}`);
});

describe('credential store', () => {
  it('saves the secret encrypted and never lists it', () => {
    const created = createCredential({ name: 'api-ventas', type: 'bearer', secret: 'tok_123' });
    expect(created).toMatchObject({ name: 'api-ventas', type: 'bearer', has_secret: true });
    expect(JSON.stringify(listCredentials())).not.toContain('tok_123');

    const stored = getDb().prepare('SELECT secret FROM credentials WHERE id = ?').get(created.id) as { secret: string };
    expect(stored.secret.startsWith('enc:v1:')).toBe(true);
    expect(stored.secret).not.toContain('tok_123');
    expect(credentialSecret('api-ventas')).toBe('tok_123');
  });

  it('validates what each type needs and keeps names unique', () => {
    expect(() => createCredential({ name: 'con espacios', type: 'bearer', secret: 'x' })).toThrow(CredentialError);
    expect(() => createCredential({ name: 'a', type: 'basic', secret: 'x' })).toThrow(/usuario/);
    expect(() => createCredential({ name: 'a', type: 'api_key', secret: 'x' })).toThrow(/cabecera/);
    expect(() => createCredential({ name: 'a', type: 'bearer' })).toThrow(/token/);
    createCredential({ name: 'a', type: 'bearer', secret: 'x' });
    expect(() => createCredential({ name: 'a', type: 'bearer', secret: 'y' })).toThrow(/Ya existe/);
  });

  it('keeps the saved secret when an update sends none, and replaces it when it sends one', () => {
    const { id } = createCredential({ name: 'erp', type: 'basic', username: 'lector', secret: 'uno' });
    updateCredential(id, { username: 'escritor', secret: '' });
    expect(credentialLogin(id, 'La conexión «ERP»')).toEqual({ username: 'escritor', password: 'uno' });
    updateCredential(id, { secret: 'dos' });
    expect(credentialLogin('erp', 'La conexión «ERP»').password).toBe('dos');
  });

  it('builds the request headers of each type and a masked copy for previews', () => {
    createCredential({ name: 'tok', type: 'bearer', secret: 'abc' });
    createCredential({ name: 'bas', type: 'basic', username: 'u', secret: 'p' });
    createCredential({ name: 'key', type: 'api_key', header_name: 'X-API-Key', secret: 'k-1' });

    expect(credentialHeaders('tok').headers).toEqual({ Authorization: 'Bearer abc' });
    expect(credentialHeaders('bas').headers).toEqual({ Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` });
    expect(credentialHeaders('key')).toEqual({ headers: { 'X-API-Key': 'k-1' }, masked: { 'X-API-Key': '••••••••' } });
    expect(JSON.stringify(credentialHeaders('tok').masked)).not.toContain('abc');
  });

  it('explains a reference to a credential that no longer exists', () => {
    expect(() => credentialHeaders('borrada', 'El nodo «Ventas»')).toThrow(/El nodo «Ventas» usa una credencial que ya no existe/);
    expect(() => credentialLogin('', 'La conexión «ERP»')).toThrow(/no tiene una credencial elegida/);
  });

  it('refuses to delete or rename a credential that something still uses', () => {
    const cred = createCredential({ name: 'erp', type: 'basic', username: 'u', secret: 'p' });
    getDb().prepare("INSERT INTO connections (id, name, region, host, database_name, credential_id) VALUES ('c1', 'ERP producción', 'x', 'h', 'd', ?)").run(cred.id);
    getDb().prepare("INSERT INTO flows (id, name, definition) VALUES ('f1', 'Carga diaria', ?)")
      .run(JSON.stringify({ nodes: [{ id: 'n', type: 'aiChatCompletion', data: { apiKey: 'cred:erp' } }], edges: [] }));

    expect(listCredentials()[0].used_by).toEqual({ connections: ['ERP producción'], flows: ['Carga diaria'] });
    expect(() => deleteCredential(cred.id)).toThrow(/está en uso \(conexiones: ERP producción · flujos: Carga diaria\)/);
    expect(() => updateCredential(cred.id, { name: 'otro' })).toThrow(/No se puede renombrar/);

    getDb().exec('DELETE FROM connections; DELETE FROM flows');
    deleteCredential(cred.id);
    expect(listCredentials()).toEqual([]);
  });

  it('reports a connection that uses the store as such', () => {
    expect(describeMssqlCredentials({ credential_id: 'x', env_credential_key: 'K' }, {})).toMatchObject({ source: 'credential' });
  });
});

describe('credentials in flows', () => {
  it('sends the stored secret in the HTTP request of a node that uses a credential', async () => {
    const cred = createCredential({ name: 'api', type: 'api_key', header_name: 'X-API-Key', secret: 'k-secreta' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    try {
      await runFlow(
        [
          { id: 's', type: 'start', data: { label: 'Inicio' } },
          { id: 'h', type: 'httpRequest', data: { label: 'Ventas', method: 'GET', endpoint: 'https://api.example.test/v1', authType: 'credential', credentialId: cred.id } },
        ],
        [edge('s', 'h')],
      );
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('k-secreta');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('does not export secrets typed into HTTP nodes, but keeps references', () => {
    const { nodes } = stripNodeSecrets({
      nodes: [
        { id: 'a', data: { authToken: 'tok_en_claro', authPassword: 'clave' } },
        { id: 'b', data: { authToken: '{{login.data.token}}', apiKey: 'cred:openai', secret: 'env:WEBHOOK_SECRET', credentialId: 'abc' } },
      ],
      edges: [],
    });
    expect(nodes[0].data).toEqual({ authToken: '', authPassword: '' });
    expect(nodes[1].data).toEqual({ authToken: '{{login.data.token}}', apiKey: 'cred:openai', secret: 'env:WEBHOOK_SECRET', credentialId: 'abc' });
  });
});
