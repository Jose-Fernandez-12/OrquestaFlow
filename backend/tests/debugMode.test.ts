import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setupDb, createFlow, edge, jsonResponse } from './helpers';
import { executeFlowEngine, resumeNodeExecution, stopFlowEngine } from '../src/engine/executor';
import { ExecutionTracer } from '../src/engine/executionLog';

beforeAll(() => setupDb());
afterEach(() => vi.unstubAllGlobals());

const start = { id: 'start', type: 'start', data: { label: 'Inicio' } };
const list = (id: string, items: any[]) => ({ id, type: 'dataList', data: { label: id, items: JSON.stringify(items) } });
const transform = (id: string, expression: string, extra: Record<string, any> = {}) =>
  ({ id, type: 'jsonTransform', data: { label: id, transformType: 'javascript', expression, ...extra } });
const timer = (id: string) => ({ id, type: 'timer', data: { label: id, duration: 0.2, unit: 'seconds' } });
const wait = (id: string, waitFor: string[]) => ({ id, type: 'waitFor', data: { label: id, waitForNodeIds: waitFor } });
const branch = (id: string) => ({
  id,
  type: 'conditionalBranch',
  data: { label: id, mode: 'if_else', conditions: [{ id: 'r1', left: '{{ventas.total}}', operator: 'gt', right: '100' }] },
});

type Ev = { nodeId: string; status: string; result?: any };

interface DebugRun {
  context: Record<string, any>;
  events: Ev[];
  flowId: string;
  /** Node ids in the order the debugger paused them before running (not the extra pauses with a result) */
  pausedOrder: string[];
}

/**
 * Runs a flow in debug mode and plays the user: every pause is answered with `answer(nodeId, event)`
 * (default: "Siguiente paso"). Returns once the flow ends.
 */
async function runDebug(
  nodes: any[],
  edges: any[],
  answer: (flowId: string, ev: Ev, count: number) => void = (flowId, ev) => resumeNodeExecution(flowId, ev.nodeId, 'step_over'),
  options: { onlyNodeIds?: string[]; initialContext?: Record<string, any> } = {}
): Promise<DebugRun> {
  const flowId = createFlow(nodes, edges);
  const events: Ev[] = [];
  const pausedOrder: string[] = [];
  const tracer = new ExecutionTracer();
  const context = await executeFlowEngine(
    flowId,
    (nodeId, status, result) => {
      const ev = { nodeId, status, result };
      events.push(ev);
      if (status === 'paused') {
        if (!result?.debugType) pausedOrder.push(nodeId);
        // The resolver is registered right after the event: answer on the next tick like a user would
        setTimeout(() => answer(flowId, ev, pausedOrder.length), 0);
      }
    },
    { mode: 'debug', tracer, ...options }
  );
  return { context, events, flowId, pausedOrder };
}

const statusIndex = (events: Ev[], nodeId: string, status: string) =>
  events.findIndex(e => e.nodeId === nodeId && e.status === status);

describe('debug mode · stepping', () => {
  it('pauses before every node and finishes when each pause is stepped over', async () => {
    const { context, pausedOrder, events } = await runDebug(
      [start, list('ventas', [{ total: 10 }]), transform('suma', 'return data[0].total;')],
      [edge('start', 'ventas'), edge('ventas', 'suma')]
    );
    expect(pausedOrder).toEqual(['start', 'ventas', 'suma']);
    expect(context.suma).toBe(10);
    // A node never completes before it was resumed
    for (const id of pausedOrder) {
      expect(statusIndex(events, id, 'paused')).toBeLessThan(statusIndex(events, id, 'completed'));
    }
  });

  it('"Continuar todo" releases the pending pauses and does not pause again', async () => {
    const { context, pausedOrder } = await runDebug(
      [start, list('ventas', [{ total: 10 }]), transform('suma', 'return data[0].total;')],
      [edge('start', 'ventas'), edge('ventas', 'suma')],
      flowId => resumeNodeExecution(flowId, undefined, 'continue')
    );
    expect(pausedOrder).toEqual(['start']);
    expect(context.suma).toBe(10);
  });

  it('stopping while paused rejects the run and clears the execution', async () => {
    const flowId = createFlow([start, list('a', [{ n: 1 }])], [edge('start', 'a')]);
    const events: Ev[] = [];
    const run = executeFlowEngine(flowId, (nodeId, status) => {
      events.push({ nodeId, status });
      if (status === 'paused') setTimeout(() => stopFlowEngine(flowId), 0);
    }, { mode: 'debug' });
    await expect(run).rejects.toThrow(/detenida/);
    expect(resumeNodeExecution(flowId, 'start')).toBe(false);
  });

  it('a conditional branch pauses with the outcome as preview and skips the other side', async () => {
    const { events, context } = await runDebug(
      [list('ventas', [{ total: 250 }]), branch('br'), transform('si', 'return "si";'), transform('no', 'return "no";')],
      [edge('ventas', 'br'), edge('br', 'si', { sourceHandle: 'true' }), edge('br', 'no', { sourceHandle: 'false' })]
    );
    const paused = events.find(e => e.nodeId === 'br' && e.status === 'paused');
    expect(paused?.result.nodePreview.kind).toBe('condition');
    expect(context.si).toBe('si');
    expect(context.no).toBeUndefined();
    // The skipped node never asks for a step
    expect(events.some(e => e.nodeId === 'no' && e.status === 'paused')).toBe(false);
  });
});

describe('debug mode · Esperar nodo', () => {
  const flow = () => ({
    nodes: [
      start, list('a', [{ n: 1 }, { n: 2 }]),
      timer('espera_d'), list('d', [{ validado: true }]),
      wait('w', ['d']), transform('b', 'return data.length;'), transform('c', 'return "c";'),
    ],
    edges: [
      edge('start', 'a'), edge('a', 'espera_d'), edge('espera_d', 'd'),
      edge('a', 'w'), edge('w', 'b'), edge('w', 'c'),
    ],
  });

  it('only asks for the step of the wait node once the awaited node finished', async () => {
    const { nodes, edges } = flow();
    const { events, context } = await runDebug(nodes, edges);
    expect(statusIndex(events, 'd', 'completed')).toBeGreaterThan(-1);
    expect(statusIndex(events, 'w', 'paused')).toBeGreaterThan(statusIndex(events, 'd', 'completed'));
    expect(statusIndex(events, 'b', 'paused')).toBeGreaterThan(statusIndex(events, 'w', 'completed'));
    expect(statusIndex(events, 'c', 'paused')).toBeGreaterThan(statusIndex(events, 'w', 'completed'));
    expect(context.b).toBe(2);
    expect(context.c).toBe('c');
  });

  it('pauses the wait node with a preview of the nodes it was waiting for', async () => {
    const { nodes, edges } = flow();
    const { events } = await runDebug(nodes, edges);
    const paused = events.find(e => e.nodeId === 'w' && e.status === 'paused');
    expect(paused?.result.nodePreview).toMatchObject({
      kind: 'wait',
      waitedFor: [expect.objectContaining({ id: 'd', label: 'd', state: 'completed' })],
    });
  });

  it('reports an awaited node that was skipped by a branch', async () => {
    const { events, context } = await runDebug(
      [list('ventas', [{ total: 50 }]), branch('br'), list('d', [{ x: 1 }]), wait('w', ['d']), transform('b', 'return "b";')],
      [edge('ventas', 'br'), edge('br', 'd', { sourceHandle: 'true' }), edge('ventas', 'w'), edge('w', 'b')]
    );
    const paused = events.find(e => e.nodeId === 'w' && e.status === 'paused');
    expect(paused?.result.nodePreview.waitedFor).toEqual([expect.objectContaining({ id: 'd', state: 'skipped' })]);
    expect(context.b).toBe('b');
  });

  it('does not pause the wait node when its own input comes from a branch not taken', async () => {
    const { events, pausedOrder } = await runDebug(
      [list('ventas', [{ total: 250 }]), branch('br'), list('d', [{ x: 1 }]), wait('w', ['d']), transform('b', 'return "b";')],
      [edge('ventas', 'br'), edge('br', 'd', { sourceHandle: 'true' }), edge('br', 'w', { sourceHandle: 'false' }), edge('w', 'b')]
    );
    expect(pausedOrder).not.toContain('w');
    expect(pausedOrder).not.toContain('b');
    expect(events.find(e => e.nodeId === 'w' && e.status === 'completed')?.result.skipped).toBe(true);
  });

  it('refuses to start a deadlocked flow and leaves nothing registered', async () => {
    const flowId = createFlow(
      [start, list('a', [{ n: 1 }]), wait('w', ['b']), transform('b', 'return 1;')],
      [edge('start', 'a'), edge('a', 'w'), edge('w', 'b')]
    );
    await expect(executeFlowEngine(flowId, undefined, { mode: 'debug' })).rejects.toThrow(/Bloqueo en "Esperar nodo"/);
    expect(resumeNodeExecution(flowId, 'w')).toBe(false);
  });

  it('"Continuar todo" while the awaited node is still running does not skip the wait', async () => {
    const { nodes, edges } = flow();
    const { events } = await runDebug(nodes, edges, flowId => resumeNodeExecution(flowId, undefined, 'continue'));
    expect(statusIndex(events, 'w', 'completed')).toBeGreaterThan(statusIndex(events, 'd', 'completed'));
  });
});

describe('debug mode · retries and continue on error', () => {
  const http = (id: string, extra: Record<string, any> = {}) =>
    ({ id, type: 'httpRequest', data: { label: id, method: 'GET', endpoint: 'https://api.test.local/items', retryDelayMs: 0, ...extra } });

  it('pauses an HTTP node before the request and after the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ id: 1 }])));
    const { events } = await runDebug([start, http('api')], [edge('start', 'api')]);
    const kinds = events.filter(e => e.nodeId === 'api' && e.status === 'paused').map(e => e.result.debugType);
    expect(kinds).toEqual(['http_request', 'http_response']);
  });

  it('does not pause on every retry attempt of the HTTP node', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'x' }, 503))
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);
    const { events, context } = await runDebug([start, http('api', { retryCount: 2 })], [edge('start', 'api')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = events.filter(e => e.nodeId === 'api' && e.status === 'paused' && e.result.debugType === 'http_request');
    expect(requests.length).toBeLessThanOrEqual(2);
    expect(context.api).toBeDefined();
  });

  it('keeps the flow going after a node fails with onError = continue', async () => {
    const { context, events } = await runDebug(
      [start, transform('roto', 'throw new Error("boom");', { onError: 'continue' }), transform('despues', 'return "ok";')],
      [edge('start', 'roto'), edge('roto', 'despues')]
    );
    expect(context.roto).toMatchObject({ failed: true });
    expect(context.despues).toBe('ok');
    expect(events.some(e => e.nodeId === 'roto' && e.status === 'error' && e.result.continued)).toBe(true);
  });
});

describe('debug mode · transform script', () => {
  it('records breakpoints and console calls as stops of the paused transform', async () => {
    const { events } = await runDebug(
      [start, list('a', [{ n: 1 }, { n: 2 }]), transform('t', 'const total = data.length;\nconsole.log("total", total);\nreturn total;', { breakpoints: [1] })],
      [edge('start', 'a'), edge('a', 't')]
    );
    const result = events.find(e => e.nodeId === 't' && e.status === 'paused' && e.result.debugType === 'transform_result');
    expect(result).toBeDefined();
    const stops = result!.result.nodePreview.trace.stops;
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(result!.result.nodePreview.output).toBe(2);
  });

  it('pauses with the error when the script throws', async () => {
    const flowId = createFlow(
      [start, list('a', [{ n: 1 }]), transform('t', 'throw new Error("fallo");')],
      [edge('start', 'a'), edge('a', 't')]
    );
    const kinds: string[] = [];
    await expect(
      executeFlowEngine(flowId, (nodeId, status, result) => {
        if (status === 'paused') {
          if (nodeId === 't' && result?.debugType) kinds.push(result.debugType);
          setTimeout(() => resumeNodeExecution(flowId, nodeId, 'step_over'), 0);
        }
      }, { mode: 'debug' })
    ).rejects.toThrow(/fallo/);
    expect(kinds).toEqual(['transform_error']);
  });
});

describe('debug mode · loops', () => {
  it('steps the nodes of the body once per item', async () => {
    const forEach = { id: 'fe', type: 'forEach', data: { label: 'fe', sourceNode: 'a' } };
    const end = { id: 'fe_end', type: 'forEachEnd', data: { label: 'fe_end' } };
    const { pausedOrder, context } = await runDebug(
      [start, list('a', [{ n: 1 }, { n: 2 }, { n: 3 }]), forEach, transform('dentro', 'return data.n * 2;', { inputData: '{{_item}}' }), end],
      [edge('start', 'a'), edge('a', 'fe'), edge('fe', 'dentro'), edge('dentro', 'fe_end')]
    );
    expect(pausedOrder.filter(id => id === 'dentro')).toHaveLength(3);
    expect(context.fe_end).toBeDefined();
  });

  it('"Restantes" on an HTTP node inside the loop sends the other requests without pausing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));
    const forEach = { id: 'fe', type: 'forEach', data: { label: 'fe', sourceNode: 'a' } };
    const end = { id: 'fe_end', type: 'forEachEnd', data: { label: 'fe_end' } };
    const api = { id: 'api', type: 'httpRequest', data: { label: 'api', method: 'GET', endpoint: 'https://api.test.local/x/{{_item.n}}', retryDelayMs: 0 } };
    const { events } = await runDebug(
      [start, list('a', [{ n: 1 }, { n: 2 }, { n: 3 }]), forEach, api, end],
      [edge('start', 'a'), edge('a', 'fe'), edge('fe', 'api'), edge('api', 'fe_end')],
      (flowId, ev) => resumeNodeExecution(flowId, ev.nodeId, ev.result?.debugType === 'http_request' ? 'continue_node' : 'step_over')
    );
    const requests = events.filter(e => e.nodeId === 'api' && e.status === 'paused' && e.result.debugType === 'http_request');
    expect(requests).toHaveLength(1);
    // ...but every iteration still ran
    expect(events.filter(e => e.nodeId === 'api' && e.status === 'completed')).toHaveLength(3);
  });
});

describe('debug mode · single node test', () => {
  it('runs only the requested node, pausing it once', async () => {
    const { pausedOrder, context } = await runDebug(
      [start, list('a', [{ n: 1 }]), transform('t', 'return data.length;')],
      [edge('start', 'a'), edge('a', 't')],
      undefined,
      { onlyNodeIds: ['t'], initialContext: { a: [{ n: 1 }, { n: 2 }] } }
    );
    expect(pausedOrder).toEqual(['t']);
    expect(context.t).toBe(2);
  });
});
