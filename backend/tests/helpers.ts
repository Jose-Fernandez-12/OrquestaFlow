import { initDb, getDb } from '../src/db/database';
import { executeFlowEngine } from '../src/engine/executor';
import { ExecutionTracer } from '../src/engine/executionLog';

let ready: Promise<void> | null = null;

/** Initialises the in-memory database once per test file (ORQUESTA_DB_PATH=':memory:' in vitest.config.ts) */
export function setupDb(): Promise<void> {
  if (!ready) ready = initDb();
  return ready;
}

let seq = 0;

export function createFlow(nodes: any[], edges: any[]): string {
  const id = `test_flow_${++seq}_${Date.now()}`;
  getDb().prepare('INSERT INTO flows (id, name, definition) VALUES (?, ?, ?)').run(id, id, JSON.stringify({ nodes, edges }));
  return id;
}

export const edge = (source: string, target: string, extra: Record<string, any> = {}) => ({
  id: `${source}->${target}${extra.sourceHandle ? ':' + extra.sourceHandle : ''}`,
  source,
  target,
  ...extra,
});

export interface RunResult {
  context: Record<string, any>;
  events: Array<{ nodeId: string; status: string; result?: any }>;
  trace: ReturnType<ExecutionTracer['toJSON']>;
}

export async function runFlow(nodes: any[], edges: any[]): Promise<RunResult> {
  const flowId = createFlow(nodes, edges);
  const events: RunResult['events'] = [];
  const tracer = new ExecutionTracer();
  const context = await executeFlowEngine(flowId, (nodeId, status, result) => events.push({ nodeId, status, result }), { tracer });
  return { context, events, trace: tracer.toJSON() };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
