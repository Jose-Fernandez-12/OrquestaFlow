import type { Node, Edge } from '@xyflow/react';

// ── Snapshots (undo / redo) ──

export interface CanvasSnapshot {
  nodes: Node[];
  edges: Edge[];
  /** Structural fingerprint: ignores selection, dragging and measured sizes */
  signature: string;
}

function cleanNode(n: Node): Node {
  const { selected: _s, dragging: _d, measured: _m, ...rest } = n as Node & { measured?: unknown };
  return rest as Node;
}

function cleanEdge(e: Edge): Edge {
  const { selected: _s, ...rest } = e;
  return rest as Edge;
}

export function canvasSignature(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify([
    nodes.map(n => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.data, n.parentId ?? null]),
    edges.map(e => [e.id, e.source, e.target, e.sourceHandle ?? null, e.targetHandle ?? null]),
  ]);
}

export function takeSnapshot(nodes: Node[], edges: Edge[]): CanvasSnapshot {
  return {
    nodes: nodes.map(cleanNode),
    edges: edges.map(cleanEdge),
    signature: canvasSignature(nodes, edges),
  };
}

export const HISTORY_LIMIT = 100;

export interface HistoryState {
  past: CanvasSnapshot[];
  present: CanvasSnapshot | null;
  future: CanvasSnapshot[];
}

export const emptyHistory = (): HistoryState => ({ past: [], present: null, future: [] });

/** Records a new state; identical states (same signature) are ignored */
export function commit(history: HistoryState, snapshot: CanvasSnapshot): HistoryState {
  if (!history.present) return { ...history, present: snapshot };
  if (history.present.signature === snapshot.signature) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: snapshot, future: [] };
}

export function undo(history: HistoryState): HistoryState {
  if (!history.present || history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: HistoryState): HistoryState {
  if (!history.present || history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest };
}

// ── Clipboard (copy / paste / duplicate) ──

export interface ClipboardPayload {
  kind: 'orquestaflow/nodes';
  version: 1;
  nodes: Node[];
  edges: Edge[];
}

export function copySelection(nodes: Node[], edges: Edge[]): ClipboardPayload | null {
  const selected = nodes.filter(n => n.selected);
  if (selected.length === 0) return null;
  const ids = new Set(selected.map(n => n.id));
  return {
    kind: 'orquestaflow/nodes',
    version: 1,
    nodes: selected.map(cleanNode),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(cleanEdge),
  };
}

export function isClipboardPayload(value: unknown): value is ClipboardPayload {
  const v = value as ClipboardPayload;
  return !!v && v.kind === 'orquestaflow/nodes' && Array.isArray(v.nodes) && Array.isArray(v.edges);
}

// Free text that never holds a node reference (same rule as the backend's configReferencesNode)
const FREE_TEXT_KEYS = new Set(['label', 'description', 'notes']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrites references to copied nodes so the pasted group points at its own copies:
 * `{{old.campo}}` → `{{new.campo}}`, fields equal to an old id and object keys that are ids
 * (e.g. the sheets of a multi-sheet export).
 */
export function remapNodeReferences<T>(value: T, idMap: Map<string, string>): T {
  if (idMap.size === 0) return value;
  const ids = [...idMap.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const template = new RegExp(`(\\{\\{\\s*)(${ids.join('|')})(?=\\s*[.\\[}])`, 'g');

  const visit = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key !== undefined && FREE_TEXT_KEYS.has(key)) return v;
      if (idMap.has(v.trim())) return idMap.get(v.trim());
      return v.replace(template, (_m, open: string, id: string) => `${open}${idMap.get(id)}`);
    }
    if (Array.isArray(v)) return v.map(item => visit(item, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [idMap.get(k) ?? k, visit(val, k)]));
    }
    return v;
  };
  return visit(value) as T;
}

export interface PasteOptions {
  newId: () => string;
  /** Top-left corner for the pasted group (flow coordinates); defaults to the original position + offset */
  anchor?: { x: number; y: number } | null;
  offset?: number;
  /** Labels already on the canvas: pasted copies get a " (copia)" suffix when they collide */
  existingLabels?: Iterable<string>;
}

export function pasteClipboard(payload: ClipboardPayload, options: PasteOptions): { nodes: Node[]; edges: Edge[] } {
  const offset = options.offset ?? 40;
  const idMap = new Map(payload.nodes.map(n => [n.id, options.newId()]));
  const labels = new Set(options.existingLabels ?? []);

  const minX = Math.min(...payload.nodes.map(n => n.position.x));
  const minY = Math.min(...payload.nodes.map(n => n.position.y));
  const dx = options.anchor ? options.anchor.x - minX : offset;
  const dy = options.anchor ? options.anchor.y - minY : offset;

  const nodes = payload.nodes.map(n => {
    const data = remapNodeReferences({ ...(n.data || {}) }, idMap) as Record<string, unknown>;
    let label = typeof data.label === 'string' ? data.label : '';
    if (label && labels.has(label)) {
      const base = `${label} (copia)`;
      label = base;
      for (let i = 2; labels.has(label); i++) label = `${base} ${i}`;
      data.label = label;
    }
    if (label) labels.add(label);
    return {
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + dx, y: n.position.y + dy },
      data,
      selected: true,
    } as Node;
  });

  const edges = payload.edges.map(e => ({
    ...e,
    id: `e_${idMap.get(e.source)}_${idMap.get(e.target)}_${options.newId().slice(0, 8)}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  })) as Edge[];

  return { nodes, edges };
}
