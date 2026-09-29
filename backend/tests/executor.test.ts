import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setupDb, runFlow, edge, jsonResponse, createFlow } from './helpers';
import { executeFlowEngine } from '../src/engine/executor';

beforeAll(() => setupDb());
afterEach(() => vi.unstubAllGlobals());

const start = { id: 'start', type: 'start', data: { label: 'Inicio' } };
const list = (id: string, items: any[]) => ({ id, type: 'dataList', data: { label: id, items: JSON.stringify(items) } });
const transform = (id: string, expression: string, extra: Record<string, any> = {}) =>
  ({ id, type: 'jsonTransform', data: { label: id, transformType: 'javascript', expression, ...extra } });
const http = (id: string, extra: Record<string, any> = {}) =>
  ({ id, type: 'httpRequest', data: { label: id, method: 'GET', endpoint: 'https://api.test.local/items', retryDelayMs: 0, ...extra } });

describe('executeFlowEngine · basic DAG', () => {
  it('runs nodes in dependency order and passes data downstream', async () => {
    const { context } = await runFlow(
      [start, list('ventas', [{ total: 10 }, { total: 5 }]), transform('suma', 'return data.reduce((a, r) => a + r.total, 0);')],
      [edge('start', 'ventas'), edge('ventas', 'suma')]
    );
    expect(context.ventas).toHaveLength(2);
    expect(context.suma).toBe(15);
  });

  it('runs an edge drawn backwards in the right order', async () => {
    // "suma" reads from "ventas" but the edge was drawn suma -> ventas
    const { context } = await runFlow(
      [list('ventas', [{ total: 3 }]), transform('suma', 'return data.length;', { inputData: '{{ventas}}' })],
      [edge('suma', 'ventas')]
    );
    expect(context.suma).toBe(1);
  });

  it('keeps edges between ids that only share a prefix (node_1 / node_10)', async () => {
    const { events } = await runFlow(
      [
        list('node_10', [{ a: 1 }]),
        list('node_1', [{ b: 2 }]),
        transform('node_2', 'return data;', { inputData: '{{node_10}}' }),
      ],
      [edge('node_10', 'node_2'), edge('node_2', 'node_1')]
    );
    const order = events.filter(e => e.status === 'completed').map(e => e.nodeId);
    expect(order.indexOf('node_2')).toBeLessThan(order.indexOf('node_1'));
  });
});

describe('executeFlowEngine · notes', () => {
  it('ignores note nodes on the canvas', async () => {
    const { context, events } = await runFlow(
      [start, { id: 'nota', type: 'note', data: { label: 'Nota', text: 'Explica el flujo' } }, list('ventas', [{ total: 1 }])],
      [edge('start', 'ventas')]
    );
    expect(context.nota).toBeUndefined();
    expect(events.some(e => e.nodeId === 'nota')).toBe(false);
  });
});

describe('executeFlowEngine · conditional branch', () => {
  it('only runs the selected branch', async () => {
    const branch = {
      id: 'br',
      type: 'conditionalBranch',
      data: { label: 'br', mode: 'if_else', conditions: [{ id: 'r1', left: '{{ventas.total}}', operator: 'gt', right: '100' }] },
    };
    const { context, trace } = await runFlow(
      [list('ventas', [{ total: 250 }]), branch, transform('alta', 'return "alta";'), transform('baja', 'return "baja";')],
      [edge('ventas', 'br'), edge('br', 'alta', { sourceHandle: 'true' }), edge('br', 'baja', { sourceHandle: 'false' })]
    );
    expect(context.alta).toBe('alta');
    expect(context.baja).toBeUndefined();
    expect(trace.find(t => t.nodeId === 'baja')?.status).toBe('skipped');
  });
});

describe('executeFlowEngine · forEach loop', () => {
  it('runs the loop body once per item and collects the results', async () => {
    const { context, trace } = await runFlow(
      [
        list('items', [{ id: 1 }, { id: 2 }, { id: 3 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        transform('doble', 'return { doble: data.id * 2 };'),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'doble'), edge('doble', 'end')]
    );
    expect(context.end.map((r: any) => r.doble)).toEqual([2, 4, 6]);
    expect(trace.find(t => t.nodeId === 'doble')?.runs).toBe(3);
  });
});

describe('executeFlowEngine · retries', () => {
  it('retries an HTTP request that fails with 503 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValue(jsonResponse([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const { context, events, trace } = await runFlow([http('api', { retryCount: 3 })], []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(context.api).toEqual([{ id: 1 }]);
    expect(events.filter(e => e.status === 'progress' && e.result?.retry)).toHaveLength(2);
    expect(trace[0]).toMatchObject({ status: 'completed', retries: 2 });
  });

  it('does not retry a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'missing' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runFlow([http('api', { retryCount: 3 })], [])).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors and fails after the configured attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runFlow([http('api', { retryCount: 2 })], [])).rejects.toThrow(/ECONNREFUSED/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the global http_max_retries setting when the node has no retry count', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    vi.stubGlobal('fetch', fetchMock);

    // The seeded default is 1 retry
    await expect(runFlow([http('api')], [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('executeFlowEngine · continue on error', () => {
  it('lets downstream nodes run when a node fails with onError = continue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'missing' }, 404)));

    const { context, events, trace } = await runFlow(
      [http('api', { retryCount: 0, onError: 'continue' }), transform('despues', 'return data.failed ? "manejado" : "ok";')],
      [edge('api', 'despues')]
    );
    expect(context.api).toMatchObject({ failed: true });
    expect(context.despues).toBe('manejado');
    expect(events.find(e => e.nodeId === 'api' && e.status === 'error')?.result).toMatchObject({ continued: true });
    expect(trace.find(t => t.nodeId === 'api')?.status).toBe('continued');
  });

  it('stops the flow by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(
      runFlow([http('api', { retryCount: 0 }), transform('despues', 'return 1;')], [edge('api', 'despues')])
    ).rejects.toThrow(/400/);
  });

  it('continues inside a loop iteration', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const { context } = await runFlow(
      [
        list('items', [{ id: 1 }, { id: 2 }, { id: 3 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        http('api', { retryCount: 0, onError: 'continue', endpoint: 'https://api.test.local/items/{{_item.id}}' }),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'api'), edge('api', 'end')]
    );
    expect(context.end).toHaveLength(3);
    expect(context.end[1]).toMatchObject({ id: 2, failed: true });
  });
});

describe('executeFlowEngine · single-node test', () => {
  it('runs only the requested node with the upstream results provided', async () => {
    const flowId = createFlow(
      [start, list('ventas', [{ total: 1 }]), transform('suma', 'return data.reduce((a, r) => a + r.total, 0);'), transform('despues', 'return "no debe correr";')],
      [edge('start', 'ventas'), edge('ventas', 'suma'), edge('suma', 'despues')]
    );
    const events: Array<{ nodeId: string; status: string }> = [];
    const context = await executeFlowEngine(flowId, (nodeId, status) => events.push({ nodeId, status }), {
      initialContext: { ventas: [{ total: 10 }, { total: 32 }] },
      onlyNodeIds: ['suma'],
    });
    expect(context.suma).toBe(42);
    expect(context.despues).toBeUndefined();
    expect(new Set(events.map(e => e.nodeId))).toEqual(new Set(['suma']));
  });

  it('can test a node that lives inside a loop using the current item', async () => {
    const flowId = createFlow(
      [
        list('items', [{ id: 1 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        transform('doble', 'return { doble: data.id * 2 };'),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'doble'), edge('doble', 'end')]
    );
    const context = await executeFlowEngine(flowId, undefined, { initialContext: { _item: { id: 21 } }, onlyNodeIds: ['doble'] });
    expect(context.doble).toEqual({ doble: 42 });
  });
});

describe('executeFlowEngine · transform errors', () => {
  it('reports JavaScript errors from the transform node', async () => {
    await expect(runFlow([transform('t', 'throw new Error("dato inválido");')], [])).rejects.toThrow(/dato inválido/);
  });
});
