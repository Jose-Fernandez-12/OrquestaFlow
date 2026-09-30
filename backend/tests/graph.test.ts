import { describe, it, expect } from 'vitest';
import { configReferencesNode, normalizeEdges, findForEachEndNode, getForEachSubgraphNodes, isBranchHandle } from '../src/engine/graph';

describe('configReferencesNode', () => {
  it('detects templates that reference the node', () => {
    expect(configReferencesNode({ endpoint: 'https://x/{{node_5.id}}' }, 'node_5')).toBe(true);
    expect(configReferencesNode({ body: '{{ node_5 }}' }, 'node_5')).toBe(true);
    expect(configReferencesNode({ iterateOver: '{{node_5[0]}}' }, 'node_5')).toBe(true);
  });

  it('detects fields whose whole value is the node id', () => {
    expect(configReferencesNode({ sourceNodeId: 'node_5' }, 'node_5')).toBe(true);
    expect(configReferencesNode({ nested: { list: ['node_5'] } }, 'node_5')).toBe(true);
  });

  it('does not match ids that only contain the target id (regression: node_1 vs node_10)', () => {
    expect(configReferencesNode({ sourceNodeId: 'node_10' }, 'node_1')).toBe(false);
    expect(configReferencesNode({ endpoint: '{{node_10.id}}' }, 'node_1')).toBe(false);
    expect(configReferencesNode({ fileName: 'reporte_node_1_backup' }, 'node_1')).toBe(false);
    expect(configReferencesNode({ note: 'usa n1 y n10' }, 'n1')).toBe(false);
  });

  it('ignores free-text fields such as the label', () => {
    expect(configReferencesNode({ label: 'node_5' }, 'node_5')).toBe(false);
  });
});

describe('normalizeEdges', () => {
  const nodes = [
    { id: 'node_1', type: 'httpRequest', data: {} },
    { id: 'node_2', type: 'export', data: { sourceNodeId: 'node_12' } },
    { id: 'node_12', type: 'dataList', data: {} },
  ];

  it('keeps edges whose source only mentions a longer id', () => {
    const edges = [{ id: 'e', source: 'node_2', target: 'node_1' }];
    expect(normalizeEdges(nodes, edges)[0]).toMatchObject({ source: 'node_2', target: 'node_1' });
  });

  it('flips an edge drawn backwards (source reads from its target)', () => {
    const edges = [{ id: 'e', source: 'node_2', target: 'node_12' }];
    expect(normalizeEdges(nodes, edges)[0]).toMatchObject({ source: 'node_12', target: 'node_2' });
  });

  it('does not flip when both nodes reference each other', () => {
    const mutual = [
      { id: 'a', type: 'jsonTransform', data: { inputData: '{{b}}' } },
      { id: 'b', type: 'jsonTransform', data: { inputData: '{{a}}' } },
    ];
    expect(normalizeEdges(mutual, [{ id: 'e', source: 'a', target: 'b' }])[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('flips edges that end on a branch output handle', () => {
    const branchNodes = [
      { id: 'br', type: 'conditionalBranch', data: {} },
      { id: 'x', type: 'dataList', data: {} },
    ];
    const edges = [{ id: 'e', source: 'x', target: 'br', targetHandle: 'true' }];
    expect(normalizeEdges(branchNodes, edges)[0]).toMatchObject({ source: 'br', target: 'x', sourceHandle: 'true' });
  });

  it('keeps branch output edges even if the target is referenced', () => {
    const branchNodes = [
      { id: 'br', type: 'conditionalBranch', data: { switchField: '{{x.estado}}' } },
      { id: 'x', type: 'dataList', data: {} },
    ];
    const edges = [{ id: 'e', source: 'br', target: 'x', sourceHandle: 'case_1' }];
    expect(normalizeEdges(branchNodes, edges)[0]).toMatchObject({ source: 'br', target: 'x' });
  });
});

describe('forEach helpers', () => {
  const nodes = [
    { id: 'fe', type: 'forEach' },
    { id: 'a', type: 'httpRequest' },
    { id: 'b', type: 'delay' },
    { id: 'end', type: 'forEachEnd' },
    { id: 'after', type: 'export' },
  ];
  const adj = { fe: ['a'], a: ['b'], b: ['end'], end: ['after'], after: [] };

  it('finds the paired end node', () => {
    expect(findForEachEndNode('fe', adj, nodes)).toBe('end');
  });

  it('returns the nodes strictly inside the loop', () => {
    expect(getForEachSubgraphNodes('fe', 'end', adj, nodes)).toEqual(['a', 'b']);
  });
});

describe('isBranchHandle', () => {
  it('recognises branch outputs', () => {
    expect(isBranchHandle('true')).toBe(true);
    expect(isBranchHandle('case_abc')).toBe(true);
    expect(isBranchHandle('default')).toBe(true);
    expect(isBranchHandle(null)).toBe(false);
    expect(isBranchHandle('out')).toBe(false);
  });
});
