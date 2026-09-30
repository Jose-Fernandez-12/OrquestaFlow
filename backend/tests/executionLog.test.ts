import { describe, it, expect } from 'vitest';
import { ExecutionTracer } from '../src/engine/executionLog';

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const nodes = [
  { id: 'a', type: 'httpRequest', data: { label: 'Obtener datos' } },
  { id: 'b', type: 'export', data: { label: 'Exportar' } },
  { id: 'c', type: 'dataList', data: {} },
];

describe('ExecutionTracer', () => {
  it('records status, duration, retries and records per node', () => {
    const c = clock();
    const tracer = new ExecutionTracer(nodes, c.now);
    tracer.record('a', 'running');
    tracer.record('a', 'progress', { retry: { attempt: 1 } });
    c.advance(250);
    tracer.record('a', 'completed', [{ id: 1 }, { id: 2 }]);

    const [entry] = tracer.toJSON();
    expect(entry).toMatchObject({ nodeId: 'a', label: 'Obtener datos', type: 'httpRequest', status: 'completed', durationMs: 250, runs: 1, retries: 1, records: 2 });
  });

  it('adds up the runs of a node inside a loop', () => {
    const c = clock();
    const tracer = new ExecutionTracer(nodes, c.now);
    for (let i = 0; i < 3; i++) {
      tracer.record('a', 'running');
      c.advance(100);
      tracer.record('a', 'completed', {});
    }
    expect(tracer.toJSON()[0]).toMatchObject({ runs: 3, durationMs: 300 });
  });

  it('does not count debug pauses as execution time', () => {
    const c = clock();
    const tracer = new ExecutionTracer(nodes, c.now);
    tracer.record('a', 'running');
    c.advance(50);
    tracer.record('a', 'paused');
    c.advance(10_000);
    tracer.record('a', 'running');
    c.advance(50);
    tracer.record('a', 'completed', {});
    expect(tracer.toJSON()[0].durationMs).toBe(100);
  });

  it('distinguishes errors, errors that let the flow continue and skipped branches', () => {
    const tracer = new ExecutionTracer(nodes);
    tracer.record('a', 'running');
    tracer.record('a', 'error', { error: 'HTTP 404', continued: true });
    tracer.record('b', 'running');
    tracer.record('b', 'error', { error: 'disco lleno' });
    tracer.record('c', 'completed', { skipped: true });

    const byId = Object.fromEntries(tracer.toJSON().map(e => [e.nodeId, e]));
    expect(byId.a).toMatchObject({ status: 'continued', error: 'HTTP 404' });
    expect(byId.b).toMatchObject({ status: 'error', error: 'disco lleno' });
    expect(byId.c.status).toBe('skipped');
  });

  it('marks nodes still running when the flow is stopped', () => {
    const tracer = new ExecutionTracer(nodes);
    tracer.record('a', 'running');
    expect(tracer.toJSON('cancelled')[0]).toMatchObject({ status: 'error', error: 'Interrumpido al detener el flujo' });
  });
});
