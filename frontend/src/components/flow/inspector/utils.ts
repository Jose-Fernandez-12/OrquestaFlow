import type { Node, Edge } from '@xyflow/react';

/* ── Node type helpers ── */

export const isDataProducerNode = (type?: string) => {
  if (!type) return false;
  return type.startsWith('http') || type === 'query' || type === 'dataSource' || type === 'fileSource' || type === 'dataList' || type === 'forEach' || type === 'forEachEnd';
};

/* ── Graph traversal ── */

export const getUpstreamNodes = (node: Node, edges: Edge[] = [], nodes: Node[] = []): Node[] => {
  const visited = new Set<string>();

  function findProducers(targetId: string): Node[] {
    if (visited.has(targetId)) return [];
    visited.add(targetId);

    const producers: Node[] = [];
    const incomingEdges = edges.filter(e => e.target === targetId);

    for (const edge of incomingEdges) {
      const srcNode = nodes.find(n => n.id === edge.source);
      if (!srcNode) continue;

      if (srcNode.type === 'start') {
        continue;
      }

      if (isDataProducerNode(srcNode.type)) {
        producers.push(srcNode);
      }

      // Continuar navegando hacia atrás para encontrar todos los productores previos
      producers.push(...findProducers(srcNode.id));
    }

    return producers;
  }

  const directProducers = findProducers(node.id);
  return Array.from(new Map(directProducers.map(n => [n.id, n])).values());
};

/* ── ForEach item resolution ── */

export function getForEachItems(
  forEachNode: Node,
  nodes: Node[] = [],
  edges: Edge[] = [],
  nodeResults: Record<string, any> = {},
  intermediateContext: Record<string, any> = {}
): any[] {
  // 1. Check if iterateOver is explicitly set, e.g. {{dataList_1}}
  const expr = forEachNode.data?.iterateOver as string;
  if (expr && expr.trim()) {
    const match = expr.match(/\{\{([^}]+)\}\}/);
    const key = match ? match[1].trim() : expr.trim();
    const resolved = intermediateContext?.[key] ?? nodeResults?.[key];
    if (Array.isArray(resolved)) return resolved;
    if (resolved && typeof resolved === 'object') {
      if (Array.isArray(resolved.rows)) return resolved.rows;
      if (Array.isArray(resolved.data)) return resolved.data;
      if (Array.isArray(resolved.items)) return resolved.items;
    }
    const targetNode = nodes.find(n => n.id === key);
    if (targetNode?.type === 'dataList' && targetNode.data?.items) {
      try {
        const parsed = typeof targetNode.data.items === 'string' ? JSON.parse(targetNode.data.items) : targetNode.data.items;
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
  }

  // 2. Look at incoming nodes to forEachNode
  const incomingEdges = edges.filter(e => e.target === forEachNode.id);
  for (const edge of incomingEdges) {
    const src = nodes.find(n => n.id === edge.source);
    if (!src) continue;
    if (src.type === 'dataList' && src.data?.items) {
      try {
        const parsed = typeof src.data.items === 'string' ? JSON.parse(src.data.items) : src.data.items;
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    const res = nodeResults?.[src.id] ?? intermediateContext?.[src.id];
    if (Array.isArray(res)) return res;
    if (res && typeof res === 'object') {
      if (Array.isArray(res.rows)) return res.rows;
      if (Array.isArray(res.data)) return res.data;
      if (Array.isArray(res.items)) return res.items;
    }
  }

  // 3. Fallback: intermediateContext or nodeResults for forEachNode
  if (Array.isArray(intermediateContext?.[forEachNode.id])) return intermediateContext[forEachNode.id];
  if (Array.isArray(intermediateContext?._items)) return intermediateContext._items;
  if (Array.isArray(nodeResults?.[forEachNode.id])) return nodeResults[forEachNode.id];

  return [];
}

/* ── JSON helpers ── */

export function truncateArrays(obj: any): any {
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      return obj.slice(0, 3).map(truncateArrays);
    }
    return [];
  } else if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = truncateArrays(obj[key]);
    }
    return newObj;
  }
  return obj;
}

export function extractExportableSample(data: any): any {
  if (!data) return null;
  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.data) && data.data.length > 0) {
        return extractExportableSample(data.data);
      }
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        return extractExportableSample(data.rows);
      }
      if (Array.isArray(data.items) && data.items.length > 0) {
        return extractExportableSample(data.items);
      }
      return data;
    }
    return data;
  }
  const nonEmpties: any[] = [];
  for (const item of data) {
    if (!item) continue;
    if (Array.isArray(item)) {
      const sample = extractExportableSample(item);
      if (sample) nonEmpties.push(...(Array.isArray(sample) ? sample : [sample]));
    } else if (typeof item === 'object') {
      if (Array.isArray(item.data) && item.data.length > 0) {
        nonEmpties.push(...item.data);
      } else if (Array.isArray(item.rows) && item.rows.length > 0) {
        nonEmpties.push(...item.rows);
      } else if (Array.isArray(item.items) && item.items.length > 0) {
        nonEmpties.push(...item.items);
      } else if (Object.keys(item).length > 0 && !item.data) {
        nonEmpties.push(item);
      }
    }
  }
  return nonEmpties.length > 0 ? nonEmpties : data;
}

/* ── Parent forEach finder ── */

export function findParentForEachNode(node: Node, edges: Edge[], nodes: Node[]): Node | null {
  if (node.type === 'forEach') return null;
  const visited = new Set<string>();
  const queue = [node.id];
  while (queue.length > 0) {
    const currId = queue.shift()!;
    const incoming = edges.filter(e => e.target === currId);
    for (const edge of incoming) {
      if (!visited.has(edge.source)) {
        visited.add(edge.source);
        const srcNode = nodes.find(n => n.id === edge.source);
        if (srcNode?.type === 'forEach') {
          return srcNode;
        }
        if (srcNode && srcNode.type !== 'forEachEnd') {
          queue.push(srcNode.id);
        }
      }
    }
  }
  return null;
}
