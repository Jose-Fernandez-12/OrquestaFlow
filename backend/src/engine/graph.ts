// Graph helpers shared by the execution engine and the Python transpiler.

export function isBranchHandle(handle?: string | null): boolean {
  if (!handle) return false;
  return handle === 'true' || handle === 'false' || handle === 'default' || handle.startsWith('case_');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keys that hold free text or layout, never a reference to another node.
// `waitForNodeIds` lists the nodes a "Esperar nodo" waits for: it is an ordering rule, not a data
// reference, so it must never make normalizeEdges flip an edge.
const NON_REFERENCE_KEYS = new Set(['label', 'description', 'notes', 'waitForNodeIds']);

/** Type of the "Esperar nodo" node: lets its branch continue only after other nodes have finished. */
export const WAIT_NODE_TYPE = 'waitFor';

export interface WaitDependency {
  /** Node that must finish first */
  source: string;
  /** The "Esperar nodo" that waits for it */
  target: string;
}

/**
 * Implicit edges of every "Esperar nodo": `waitForNodeIds` -> the wait node.
 * They only order the execution; they carry no data, so they are never part of the drawn edges.
 * Ids that no longer exist (deleted nodes), notes and the node itself are ignored.
 */
export function getWaitDependencies(nodes: any[]): WaitDependency[] {
  const runnable = new Set(nodes.filter(n => n.type !== 'note').map(n => n.id));
  const deps: WaitDependency[] = [];
  for (const node of nodes) {
    if (node.type !== WAIT_NODE_TYPE) continue;
    const ids: unknown[] = Array.isArray(node.data?.waitForNodeIds) ? node.data.waitForNodeIds : [];
    for (const source of new Set(ids)) {
      if (typeof source === 'string' && source !== node.id && runnable.has(source)) {
        deps.push({ source, target: node.id });
      }
    }
  }
  return deps;
}

/**
 * Wait dependencies that can never be satisfied: the awaited node (transitively) runs after the
 * wait node, so both would wait for each other forever.
 */
export function findWaitDeadlocks(edges: any[], deps: WaitDependency[]): WaitDependency[] {
  const adj = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  edges.forEach(e => link(e.source, e.target));
  deps.forEach(d => link(d.source, d.target));

  // A dependency source -> target deadlocks when target already reaches source
  const reaches = (from: string, goal: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === goal) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(adj.get(id) || []));
    }
    return false;
  };
  return deps.filter(d => reaches(d.target, d.source));
}

/**
 * True when a node's configuration points at `nodeId`: either a field whose whole value is the id
 * (e.g. `sourceNodeId: "node_5"`) or a template such as `{{node_5}}`, `{{ node_5.campo }}` or `{{node_5[0]}}`.
 *
 * Ids are matched as whole tokens, so `node_1` never matches inside `node_10` or `mi_node_1_backup`.
 */
export function configReferencesNode(data: unknown, nodeId: string): boolean {
  if (!nodeId) return false;
  const template = new RegExp(`\\{\\{\\s*${escapeRegExp(nodeId)}\\s*[.\\[}]`);

  const visit = (value: unknown, key?: string): boolean => {
    if (typeof value === 'string') {
      if (key !== undefined && NON_REFERENCE_KEYS.has(key)) return false;
      return value.trim() === nodeId || template.test(value);
    }
    if (Array.isArray(value)) return value.some(v => visit(v, key));
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).some(([k, v]) => visit(v, k));
    }
    return false;
  };

  return visit(data);
}

/**
 * Fixes edges drawn in the wrong direction.
 *
 * - An edge that ends on a branch output handle of a conditionalBranch is flipped.
 * - An edge A -> B where A's configuration references B (and B does not reference A)
 *   was connected backwards: B must run first, so it becomes B -> A.
 */
export function normalizeEdges(nodes: any[], edges: any[]): any[] {
  const byId = new Map(nodes.map(n => [n.id, n]));

  return edges.map(edge => {
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);

    if (tgt?.type === 'conditionalBranch' && isBranchHandle(edge.targetHandle)) {
      return { ...edge, source: edge.target, target: edge.source, sourceHandle: edge.targetHandle, targetHandle: edge.sourceHandle };
    }
    if (src?.type === 'conditionalBranch' && isBranchHandle(edge.sourceHandle)) {
      return edge;
    }
    if (src && tgt && configReferencesNode(src.data, tgt.id) && !configReferencesNode(tgt.data, src.id)) {
      return { ...edge, source: tgt.id, target: src.id };
    }
    return edge;
  });
}

/**
 * BFS from a forEach node to its paired "Fin de bucle" node.
 *
 * Loops can be nested, so pairing works like parentheses: every forEach crossed on the way opens a
 * level and every forEachEnd closes one; the pair is the first forEachEnd reached at level 0.
 * In `A → B(forEach) → C → B_end → A_end`, A pairs with A_end and B with B_end.
 */
export function findForEachEndNode(forEachNodeId: string, adjList: Record<string, string[]>, nodes: any[]): string | null {
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  const visited = new Set<string>();
  const queue: Array<[string, number]> = (adjList[forEachNodeId] || []).map(id => [id, 0]);

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    const key = `${current}@${depth}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const type = typeOf.get(current);
    let nextDepth = depth;
    if (type === 'forEachEnd') {
      if (depth === 0) return current;
      nextDepth = depth - 1;
    } else if (type === 'forEach') {
      if (current === forEachNodeId) continue; // cycle back to itself
      nextDepth = depth + 1;
    }

    for (const next of adjList[current] || []) {
      if (!visited.has(`${next}@${nextDepth}`)) queue.push([next, nextDepth]);
    }
  }
  return null;
}

// Node ids strictly between a forEach and its forEachEnd (both excluded).
// Includes any nested loop entirely: its forEach, its body and its forEachEnd.
export function getForEachSubgraphNodes(
  forEachNodeId: string,
  forEachEndNodeId: string,
  adjList: Record<string, string[]>,
  _nodes?: any[]
): string[] {
  const subgraphNodes: string[] = [];
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === forEachEndNodeId) continue;

    subgraphNodes.push(current);
    for (const next of adjList[current] || []) {
      if (!visited.has(next) && next !== forEachEndNodeId) queue.push(next);
    }
  }
  return subgraphNodes;
}
