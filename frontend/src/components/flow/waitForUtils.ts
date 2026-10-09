import type { Node, Edge } from '@xyflow/react';

/** Type of the "Esperar nodo" node (mirrors WAIT_NODE_TYPE in backend/src/engine/graph.ts) */
export const WAIT_NODE_TYPE = 'waitFor';

/** Nodes an "Esperar nodo" can wait for: everything that runs, except itself and other waits' notes */
export function getWaitCandidates(waitNodeId: string, nodes: Node[]): Node[] {
  return nodes.filter(n => n.id !== waitNodeId && n.type !== 'note');
}

function reachable(fromId: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges) {
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return seen;
}

/** Nodes between a forEach and the first "Fin de bucle" on each path: the engine runs them inside the loop */
function loopBodyIds(nodes: Node[], edges: Edge[]): Set<string> {
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  const body = new Set<string>();
  for (const loop of nodes.filter(n => n.type === 'forEach')) {
    const found = new Set<string>();
    const stack = edges.filter(e => e.source === loop.id).map(e => e.target);
    let closes = false;
    while (stack.length) {
      const id = stack.pop()!;
      if (found.has(id)) continue;
      if (typeOf.get(id) === 'forEachEnd') {
        closes = true;
        continue;
      }
      found.add(id);
      stack.push(...edges.filter(e => e.source === id).map(e => e.target));
    }
    if (closes) found.forEach(id => body.add(id));
  }
  return body;
}

/**
 * Why waiting for `targetId` from `waitNodeId` will not work as intended, or null when it is fine.
 * A deadlock is an error for the engine; the other cases are ignored or never resolve and deserve a warning.
 */
export function getWaitIssue(waitNodeId: string, targetId: string, nodes: Node[], edges: Edge[]): string | null {
  if (reachable(waitNodeId, edges).has(targetId)) {
    return 'Este nodo se ejecuta después de "Esperar nodo": ambos se esperarían para siempre.';
  }
  const inLoop = loopBodyIds(nodes, edges);
  if (inLoop.has(targetId) || inLoop.has(waitNodeId)) {
    return 'Dentro de un bucle no se puede esperar a otro nodo: la espera se ignora.';
  }
  return null;
}
