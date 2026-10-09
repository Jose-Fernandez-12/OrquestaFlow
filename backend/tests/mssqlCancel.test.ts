import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// A fake SQL Server: each query hangs until the test settles it or the request is cancelled
const fake = vi.hoisted(() => {
  const state = {
    cancelled: 0,
    poolsCreated: [] as any[],
    /** How the next queries behave: 'hang' never answers, 'ok' answers right away */
    mode: 'hang' as 'hang' | 'ok',
    /** When false, cancel() does not settle the query (a server slow to honour the cancel) */
    cancelSettles: true,
  };
  class FakeRequest {
    parameters: Record<string, any> = {};
    private rejectQuery: ((err: any) => void) | null = null;
    input(name: string, value: any) {
      this.parameters[name] = value;
    }
    query() {
      if (state.mode === 'ok') return Promise.resolve({ recordset: [{ ok: 1 }], rowsAffected: [1] });
      return new Promise((_, reject) => {
        this.rejectQuery = reject;
      });
    }
    cancel() {
      state.cancelled++;
      if (state.cancelSettles) this.rejectQuery?.(Object.assign(new Error('Canceled.'), { code: 'ECANCEL' }));
    }
  }
  class FakePool {
    connected = false;
    constructor(public config: any) {
      state.poolsCreated.push(config);
    }
    async connect() {
      this.connected = true;
      return this;
    }
    request() {
      return new FakeRequest();
    }
    async close() {
      this.connected = false;
    }
  }
  return { state, FakePool };
});

vi.mock('mssql', () => ({ default: { ConnectionPool: fake.FakePool } }));

import { getDb } from '../src/db/database';
import { executeMssqlQuery, closeAllMssqlPools } from '../src/engine/mssql';
import { executeFlowEngine, stopFlowEngine } from '../src/engine/executor';
import { setupDb, createFlow, edge } from './helpers';

const setSetting = (key: string, value: string) =>
  getDb().prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(key, value);

beforeAll(async () => {
  await setupDb();
  getDb()
    .prepare('INSERT OR REPLACE INTO connections (id, name, region, host, database_name, username, password) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('conn_test', 'Pruebas', 'local', 'sql.test.local', 'ventas', 'usuario', 'clave');
  getDb()
    .prepare('INSERT OR REPLACE INTO queries (id, name, sql_text, connection_ids) VALUES (?, ?, ?, ?)')
    .run('q_lenta', 'Consulta lenta', 'SELECT * FROM ventas', JSON.stringify(['conn_test']));
});

beforeEach(async () => {
  await closeAllMssqlPools();
  fake.state.cancelled = 0;
  fake.state.poolsCreated = [];
  fake.state.mode = 'hang';
  fake.state.cancelSettles = true;
  setSetting('mssql_request_timeout_seconds', '1');
  setSetting('mssql_connection_timeout_seconds', '30');
});

describe('executeMssqlQuery · timeout and cancellation', () => {
  it('cancels the query on the server and fails when the configured time runs out', async () => {
    const started = Date.now();
    await expect(executeMssqlQuery('conn_test', 'SELECT 1')).rejects.toThrow(/tiempo límite de 1 s/);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(fake.state.cancelled).toBe(1);
  });

  it('fails on time even when the server is slow to honour the cancel', async () => {
    fake.state.cancelSettles = false;
    await expect(executeMssqlQuery('conn_test', 'SELECT 1')).rejects.toThrow(/tiempo límite/);
    expect(fake.state.cancelled).toBe(1);
  });

  it('applies a changed timeout to the next query without restarting (the pool is reused)', async () => {
    fake.state.mode = 'ok';
    await executeMssqlQuery('conn_test', 'SELECT 1');
    fake.state.mode = 'hang';
    setSetting('mssql_request_timeout_seconds', '2');
    const started = Date.now();
    await expect(executeMssqlQuery('conn_test', 'SELECT 1')).rejects.toThrow(/tiempo límite de 2 s/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(fake.state.poolsCreated).toHaveLength(1);
    // The driver itself never times out: the limit is enforced per query
    expect(fake.state.poolsCreated[0].requestTimeout).toBe(0);
  });

  it('opens a new pool when the connection timeout changes', async () => {
    fake.state.mode = 'ok';
    await executeMssqlQuery('conn_test', 'SELECT 1');
    setSetting('mssql_connection_timeout_seconds', '5');
    await executeMssqlQuery('conn_test', 'SELECT 1');
    expect(fake.state.poolsCreated.map(c => c.connectionTimeout)).toEqual([30000, 5000]);
  });

  it('cancels the query when its signal is aborted', async () => {
    setSetting('mssql_request_timeout_seconds', '60');
    const controller = new AbortController();
    const running = executeMssqlQuery('conn_test', 'SELECT 1', {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toThrow(/detenida por el usuario/);
    expect(fake.state.cancelled).toBe(1);
  });
});

describe('query node · stopping the flow', () => {
  it('cancels the running query on the server when the flow is stopped', async () => {
    setSetting('mssql_request_timeout_seconds', '60');
    const flowId = createFlow(
      [
        { id: 'start', type: 'start', data: { label: 'Inicio' } },
        { id: 'sql', type: 'query', data: { label: 'sql', queryId: 'q_lenta' } },
      ],
      [edge('start', 'sql')]
    );
    const events: Array<{ nodeId: string; status: string }> = [];
    const run = executeFlowEngine(flowId, (nodeId, status) => events.push({ nodeId, status }));
    run.catch(() => {});
    await vi.waitFor(() => expect(events.some(e => e.nodeId === 'sql' && e.status === 'running')).toBe(true));
    await new Promise(r => setTimeout(r, 20));

    expect(stopFlowEngine(flowId)).toBe(true);
    await expect(run).rejects.toThrow(/detenida/);
    await vi.waitFor(() => expect(fake.state.cancelled).toBe(1));

    // A new run of the same flow is not disturbed by the stopped one
    fake.state.mode = 'ok';
    const context = await executeFlowEngine(flowId);
    expect(context.sql).toEqual([{ ok: 1 }]);
  });
});
