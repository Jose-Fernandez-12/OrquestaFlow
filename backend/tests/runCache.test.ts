import { describe, it, expect } from 'vitest';
import { findMissingInputs, withoutIterationKeys } from '../src/engine/runCache';
import { edge } from './helpers';

const node = (id: string, type = 'jsonTransform') => ({ id, type, data: { label: id } });

describe('findMissingInputs', () => {
  const nodes = [node('start', 'start'), node('login', 'httpRequest'), node('espera', 'timer'), node('datos', 'httpRequest'), node('fmt')];
  const edges = [edge('start', 'login'), edge('login', 'espera'), edge('espera', 'datos'), edge('datos', 'fmt')];

  it('reports the inputs from outside the run that have no result', () => {
    expect(findMissingInputs(['fmt'], nodes, edges, {}).map(n => n.id)).toEqual(['datos']);
    expect(findMissingInputs(['fmt'], nodes, edges, { datos: [] })).toEqual([]);
  });

  it('ignores inputs produced inside the run and the start node', () => {
    expect(findMissingInputs(['login', 'espera', 'datos', 'fmt'], nodes, edges, {})).toEqual([]);
  });

  it('looks through pass-through nodes such as timers', () => {
    expect(findMissingInputs(['datos'], nodes, edges, {}).map(n => n.id)).toEqual(['login']);
    expect(findMissingInputs(['datos'], nodes, edges, { login: { token: 'x' } })).toEqual([]);
  });

  it('accepts inputs skipped by a conditional branch in the last run', () => {
    expect(findMissingInputs(['fmt'], nodes, edges, {}, ['datos'])).toEqual([]);
  });
});

describe('withoutIterationKeys', () => {
  it('drops the variables of a loop iteration and keeps node results', () => {
    expect(withoutIterationKeys({ _item: { x: 1 }, _index: 0, _total: 3, _loops: [{ id: 'fe', current: 1, total: 3 }], datos: [1, 2, 3] })).toEqual({ datos: [1, 2, 3] });
  });
});
