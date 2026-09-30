import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  canvasSignature,
  commit,
  copySelection,
  emptyHistory,
  HISTORY_LIMIT,
  pasteClipboard,
  redo,
  remapNodeReferences,
  takeSnapshot,
  undo,
} from './canvasState';

const node = (id: string, x = 0, data: Record<string, unknown> = {}, extra: Partial<Node> = {}): Node =>
  ({ id, type: 'dataList', position: { x, y: 0 }, data: { label: id, ...data }, ...extra }) as Node;
const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

describe('canvasSignature', () => {
  it('ignores selection, dragging and measured sizes', () => {
    const a = canvasSignature([node('a')], []);
    const b = canvasSignature([node('a', 0, {}, { selected: true, dragging: true, measured: { width: 200, height: 60 } } as any)], []);
    expect(a).toBe(b);
  });

  it('changes when a node moves, its data changes or an edge is added', () => {
    const base = canvasSignature([node('a'), node('b')], []);
    expect(canvasSignature([node('a', 10), node('b')], [])).not.toBe(base);
    expect(canvasSignature([node('a', 0, { items: '[1]' }), node('b')], [])).not.toBe(base);
    expect(canvasSignature([node('a'), node('b')], [edge('a', 'b')])).not.toBe(base);
  });
});

describe('undo / redo history', () => {
  const s1 = takeSnapshot([node('a')], []);
  const s2 = takeSnapshot([node('a'), node('b')], []);
  const s3 = takeSnapshot([node('a'), node('b')], [edge('a', 'b')]);

  it('walks back and forth between recorded states', () => {
    let h = commit(commit(commit(emptyHistory(), s1), s2), s3);
    expect(h.present?.signature).toBe(s3.signature);
    h = undo(h);
    expect(h.present?.signature).toBe(s2.signature);
    h = undo(h);
    expect(h.present?.signature).toBe(s1.signature);
    expect(undo(h)).toBe(h); // nothing left to undo
    h = redo(h);
    expect(h.present?.signature).toBe(s2.signature);
  });

  it('drops the redo branch after a new change', () => {
    let h = undo(commit(commit(emptyHistory(), s1), s2));
    h = commit(h, s3);
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('ignores states identical to the current one', () => {
    const h = commit(emptyHistory(), s1);
    expect(commit(h, takeSnapshot([node('a', 0, {}, { selected: true })], []))).toBe(h);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = commit(h, takeSnapshot([node('a', i)], []));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('copy / paste', () => {
  const nodes = [
    node('fuente', 100, {}, { selected: true }),
    node('export', 300, { sourceNodeId: 'fuente', dataSource: '{{fuente}}', fileName: '{{fuente_2.nombre}}' }, { selected: true }),
    node('otro', 500),
  ];
  const edges = [edge('fuente', 'export'), edge('export', 'otro')];

  it('copies the selected nodes and only the edges between them', () => {
    const payload = copySelection(nodes, edges)!;
    expect(payload.nodes.map(n => n.id)).toEqual(['fuente', 'export']);
    expect(payload.edges.map(e => e.id)).toEqual(['fuente-export']);
    expect(payload.nodes.every(n => !('selected' in n))).toBe(true);
  });

  it('returns null when nothing is selected', () => {
    expect(copySelection([node('a')], [])).toBeNull();
  });

  it('pastes with new ids, remapped edges and references to the copied nodes', () => {
    let n = 0;
    const payload = copySelection(nodes, edges)!;
    const pasted = pasteClipboard(payload, { newId: () => `nuevo${++n}`, existingLabels: ['fuente', 'export', 'otro'] });

    expect(pasted.nodes.map(p => p.id)).toEqual(['nuevo1', 'nuevo2']);
    expect(pasted.nodes.map(p => p.position.x)).toEqual([140, 340]);
    expect(pasted.nodes.every(p => p.selected)).toBe(true);
    expect(pasted.edges[0]).toMatchObject({ source: 'nuevo1', target: 'nuevo2' });

    const exportData = pasted.nodes[1].data as Record<string, unknown>;
    expect(exportData.sourceNodeId).toBe('nuevo1');
    expect(exportData.dataSource).toBe('{{nuevo1}}');
    // References to other nodes (and ids that only share a prefix) are left alone
    expect(exportData.fileName).toBe('{{fuente_2.nombre}}');
  });

  it('renames pasted labels that already exist on the canvas', () => {
    let n = 0;
    const payload = copySelection([node('a', 0, {}, { selected: true })], [])!;
    const labels = ['a', 'a (copia)'];
    const pasted = pasteClipboard(payload, { newId: () => `x${++n}`, existingLabels: labels });
    expect(pasted.nodes[0].data.label).toBe('a (copia) 2');
  });

  it('places the group at the given anchor', () => {
    const payload = copySelection(nodes, edges)!;
    const pasted = pasteClipboard(payload, { newId: () => Math.random().toString(36), anchor: { x: 1000, y: 50 } });
    expect(pasted.nodes.map(p => p.position)).toEqual([{ x: 1000, y: 50 }, { x: 1200, y: 50 }]);
  });
});

describe('remapNodeReferences', () => {
  it('rewrites templates, whole-value ids and id keys', () => {
    const map = new Map([['n1', 'm1']]);
    expect(remapNodeReferences({ a: '{{ n1.campo }}', b: 'n1', c: { n1: 'Hoja' }, d: ['{{n1[0].x}}'] }, map)).toEqual({
      a: '{{ m1.campo }}',
      b: 'm1',
      c: { m1: 'Hoja' },
      d: ['{{m1[0].x}}'],
    });
  });

  it('does not touch ids that only contain the copied id', () => {
    const map = new Map([['n1', 'm1']]);
    expect(remapNodeReferences({ a: '{{n10.x}}', b: 'n1_backup' }, map)).toEqual({ a: '{{n10.x}}', b: 'n1_backup' });
  });
});
