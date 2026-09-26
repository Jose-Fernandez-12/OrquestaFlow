import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { commit, emptyHistory, redo as redoHistory, takeSnapshot, undo as undoHistory, type HistoryState } from './canvasState';

const COMMIT_DELAY_MS = 350;

interface UseCanvasHistoryOptions {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  /** Changing this key (e.g. the flow id) starts a fresh history */
  resetKey: unknown;
  /** Signature of the last saved version, to tell whether there are unsaved changes */
  savedSignature: string | null;
}

/**
 * Undo / redo for the canvas. Changes are grouped: a snapshot is recorded once the canvas has been
 * still for a moment and no node is being dragged, so typing in the inspector or moving a node
 * becomes a single step.
 */
export function useCanvasHistory({ nodes, edges, setNodes, setEdges, resetKey, savedSignature }: UseCanvasHistoryOptions) {
  const history = useRef<HistoryState>(emptyHistory());
  const latest = useRef({ nodes, edges });
  useEffect(() => {
    latest.current = { nodes, edges };
  }, [nodes, edges]);
  const [state, setState] = useState({ canUndo: false, canRedo: false, signature: null as string | null });

  const publish = useCallback(() => {
    const h = history.current;
    setState({ canUndo: h.past.length > 0, canRedo: h.future.length > 0, signature: h.present?.signature ?? null });
  }, []);

  useEffect(() => {
    history.current = emptyHistory();
    publish();
  }, [resetKey, publish]);

  const flush = useCallback(() => {
    history.current = commit(history.current, takeSnapshot(latest.current.nodes, latest.current.edges));
  }, []);

  useEffect(() => {
    if (nodes.some(n => n.dragging)) return;
    const timer = setTimeout(() => {
      flush();
      publish();
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [nodes, edges, flush, publish]);

  const apply = useCallback((next: HistoryState) => {
    if (next === history.current || !next.present) return false;
    history.current = next;
    // Keep the current selection so the inspector does not jump around
    const selected = new Set(latest.current.nodes.filter(n => n.selected).map(n => n.id));
    setNodes(next.present.nodes.map(n => ({ ...n, selected: selected.has(n.id) })));
    setEdges(next.present.edges);
    publish();
    return true;
  }, [setNodes, setEdges, publish]);

  const undo = useCallback(() => {
    flush();
    return apply(undoHistory(history.current));
  }, [flush, apply]);

  const redo = useCallback(() => {
    flush();
    return apply(redoHistory(history.current));
  }, [flush, apply]);

  return {
    undo,
    redo,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    /** Structural signature of the current canvas (updated after each grouped change) */
    signature: state.signature,
    isDirty: savedSignature !== null && state.signature !== null && state.signature !== savedSignature,
  };
}
