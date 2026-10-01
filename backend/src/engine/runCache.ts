// Results of the last editor run of each flow, kept on disk so a partial run
// ("ejecutar selección", "ejecutar desde aquí", "probar nodo") can read the inputs
// of the nodes it does not run, even after the editor or the server was restarted.

import fs from 'fs';
import path from 'path';

export interface RunCache {
  updatedAt: string;
  // Engine context: outputs by node id and by label
  context: Record<string, any>;
  // Nodes skipped by a conditional branch in the last run (they have no output on purpose)
  skipped: string[];
}

const PASS_THROUGH_TYPES = ['timer', 'delay', 'conditionalBranch'];

// Variables of the current loop iteration: they belong to one moment of a run, never to its results.
// Left in the context, an HTTP node would think it runs inside a loop and send a single request.
export const ITERATION_KEYS = ['_item', '_index', '_total'];

export function withoutIterationKeys(context: Record<string, any>): Record<string, any> {
  const clean = { ...context };
  for (const key of ITERATION_KEYS) delete clean[key];
  return clean;
}

function cacheDir(): string {
  return path.join(process.cwd(), 'data', 'run-cache');
}

function cacheFile(flowId: string): string {
  // Flow ids are uuids; strip anything else so the id can never leave the folder
  return path.join(cacheDir(), `${flowId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

export function loadRunCache(flowId: string): RunCache | null {
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile(flowId), 'utf8')) as RunCache;
    return { ...cache, context: withoutIterationKeys(cache.context || {}) };
  } catch {
    return null;
  }
}

/**
 * Stores the results of a run. A full run replaces the cache; a partial run is merged on top,
 * so the outputs of the nodes it did not run are kept.
 */
export function saveRunCache(
  flowId: string,
  context: Record<string, any>,
  skipped: string[],
  opts: { merge: boolean; ranNodeIds?: string[] }
): void {
  try {
    const previous = opts.merge ? loadRunCache(flowId) : null;
    const ran = new Set(opts.ranNodeIds || []);
    const cache: RunCache = {
      updatedAt: new Date().toISOString(),
      context: withoutIterationKeys({ ...(previous?.context || {}), ...context }),
      skipped: [...new Set([...(previous?.skipped || []).filter(id => !ran.has(id)), ...skipped])],
    };
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFile(flowId), JSON.stringify(cache));
  } catch (err) {
    // The cache only speeds up debugging; a failure must never fail the run
    console.error(`No se pudo guardar el caché de ejecución del flujo ${flowId}`, err);
  }
}

/** Saved results of all flows: how many and how much space they take. */
export function runCacheStats(): { flows: number; bytes: number } {
  try {
    const files = fs.readdirSync(cacheDir()).filter(f => f.endsWith('.json'));
    const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(cacheDir(), f)).size, 0);
    return { flows: files.length, bytes };
  } catch {
    return { flows: 0, bytes: 0 };
  }
}

/** Removes the saved results of every flow. Partial runs need a full run again afterwards. */
export function clearRunCache(): number {
  const { flows } = runCacheStats();
  fs.rmSync(cacheDir(), { recursive: true, force: true });
  return flows;
}

export function deleteRunCache(flowId: string): void {
  try {
    fs.rmSync(cacheFile(flowId), { force: true });
  } catch {
    // ignore
  }
}

/**
 * Nodes outside `runIds` whose output the run needs and is not in `context`.
 * Timers and conditional branches only pass data through, so their own inputs are checked instead;
 * the start node has no output to wait for. A loop body run on its own gets its item as {{_item}}.
 */
export function findMissingInputs(
  runIds: string[],
  nodes: any[],
  edges: any[],
  context: Record<string, any>,
  skipped: string[] = []
): any[] {
  const run = new Set(runIds);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const skippedSet = new Set(skipped);
  const missing = new Map<string, any>();

  const check = (sourceId: string, seen: Set<string>) => {
    if (run.has(sourceId) || seen.has(sourceId)) return;
    seen.add(sourceId);
    const src = byId.get(sourceId);
    if (!src || src.type === 'start' || src.type === 'note') return;
    if (PASS_THROUGH_TYPES.includes(src.type)) {
      edges.filter(e => e.target === sourceId).forEach(e => check(e.source, seen));
      return;
    }
    if (src.type === 'forEach' && context._item !== undefined) return;
    if (context[sourceId] === undefined && !skippedSet.has(sourceId)) missing.set(sourceId, src);
  };

  for (const edge of edges) {
    if (run.has(edge.target) && !run.has(edge.source)) check(edge.source, new Set());
  }
  return [...missing.values()];
}
