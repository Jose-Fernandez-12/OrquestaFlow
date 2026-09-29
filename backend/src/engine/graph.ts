// Graph helpers shared by the execution engine and the Python transpiler.

export function isBranchHandle(handle?: string | null): boolean {
  if (!handle) return false;
  return handle === 'true' || handle === 'false' || handle === 'default' || handle.startsWith('case_');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keys that hold free text or layout, never a reference to another node
const NON_REFERENCE_KEYS = new Set(['label', 'description', 'notes']);

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

// BFS from a forEach node to its paired "Fin de bucle" node
export function findForEachEndNode(forEachNodeId: string, adjList: Record<string, string[]>, nodes: any[]): string | null {
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (nodes.find(n => n.id === current)?.type === 'forEachEnd') return current;

    for (const next of adjList[current] || []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return null;
}

// Node ids strictly between a forEach and its forEachEnd (both excluded)
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
