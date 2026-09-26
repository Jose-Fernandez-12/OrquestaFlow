import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { validateFlow } from './flowValidation';

const n = (id: string, type: string, data: Record<string, unknown> = {}): Node =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as Node;
const e = (source: string, target: string, sourceHandle?: string): Edge => ({ id: `${source}-${target}`, source, target, sourceHandle });

const messagesFor = (issues: ReturnType<typeof validateFlow>, nodeId: string) =>
  issues.filter(i => i.nodeId === nodeId).map(i => `${i.level}: ${i.message}`);

describe('validateFlow', () => {
  it('accepts a well configured flow', () => {
    const nodes = [
      n('start', 'start'),
      n('api', 'httpRequest', { endpoint: 'https://api.test/x' }),
      n('t', 'jsonTransform', { expression: 'return data;' }),
    ];
    expect(validateFlow(nodes, [e('start', 'api'), e('api', 't')])).toEqual([]);
  });

  it('flags missing required configuration as errors', () => {
    const nodes = [
      n('start', 'start'),
      n('api', 'httpRequest', { endpoint: '' }),
      n('sql', 'query'),
      n('file', 'dataSource'),
      n('list', 'dataList', { items: '[{"a":1}' }),
      n('ia', 'aiChatCompletion', { userPrompt: '' }),
    ];
    const edges = [e('start', 'api'), e('api', 'sql'), e('sql', 'file'), e('file', 'list'), e('list', 'ia')];
    const issues = validateFlow(nodes, edges);
    expect(messagesFor(issues, 'api')).toEqual(['error: Falta la URL del endpoint.']);
    expect(messagesFor(issues, 'sql')[0]).toMatch(/^error: No hay una consulta/);
    expect(messagesFor(issues, 'file')[0]).toMatch(/^error: No hay un archivo/);
    expect(messagesFor(issues, 'list')[0]).toMatch(/^error: El JSON de la lista/);
    expect(messagesFor(issues, 'ia')[0]).toMatch(/^error: El prompt/);
  });

  it('warns about an empty JavaScript transform and disconnected nodes', () => {
    const nodes = [n('start', 'start'), n('t', 'jsonTransform', { expression: '' }), n('suelto', 'dataList', { items: '[]' })];
    const issues = validateFlow(nodes, [e('start', 't')]);
    expect(messagesFor(issues, 't')).toEqual(['warning: No hay código JavaScript: los datos pasarán sin cambios.']);
    expect(messagesFor(issues, 'suelto')).toContain('warning: El nodo no está conectado a ningún otro.');
  });

  it('checks bifurcations: missing field and unconnected outputs', () => {
    const nodes = [
      n('start', 'start'),
      n('sw', 'conditionalBranch', { mode: 'switch', cases: [{ id: '1', value: 'A' }, { id: '2', value: 'B' }] }),
      n('a', 'dataList', { items: '[]' }),
    ];
    const issues = validateFlow(nodes, [e('start', 'sw'), e('sw', 'a', 'case_1')]);
    const msgs = messagesFor(issues, 'sw');
    expect(msgs[0]).toMatch(/^error: Falta el "Valor a evaluar"/);
    expect(msgs).toContain('warning: Salidas sin conectar: B.');
  });

  it('requires a loop to reach its end node', () => {
    const nodes = [n('start', 'start'), n('loop', 'forEach', { iterateOver: '{{lista}}' }), n('x', 'dataList', { items: '[]' })];
    expect(messagesFor(validateFlow(nodes, [e('start', 'loop'), e('loop', 'x')]), 'loop')).toContain(
      'error: El bucle no llega a un nodo "Fin de bucle".'
    );
  });

  it('detects references to nodes that no longer exist', () => {
    const nodes = [
      n('start', 'start'),
      n('node_http_1', 'httpRequest', { endpoint: 'https://x/{{node_http_9.id}}/{{Datos Borrados.campo}}' }),
    ];
    const msgs = messagesFor(validateFlow(nodes, [e('start', 'node_http_1')]), 'node_http_1');
    expect(msgs.some(m => m.includes('{{node_http_9…}}'))).toBe(true);
    expect(msgs.some(m => m.includes('{{Datos Borrados…}}'))).toBe(true);
  });

  it('accepts ids, labels, variables, loop aliases and plain field names in templates', () => {
    const nodes = [
      n('start', 'start'),
      n('vars', 'variables', { label: 'Parámetros', variables: [{ key: 'fecha', value: '$today' }] }),
      n('node_list', 'dataList', { label: 'Lista de sucursales', items: '[]' }),
      n('loop', 'forEach', { iterateOver: '{{node_list}}', itemAlias: 'sucursal' }),
      n('api', 'httpRequest', {
        endpoint: 'https://x/{{sucursal.id}}/{{fecha}}/{{Parámetros.fecha}}/{{Lista de sucursales.length}}/{{_item.id}}/{{departamentoId}}',
      }),
      n('end', 'forEachEnd'),
    ];
    const edges = [e('start', 'vars'), e('vars', 'node_list'), e('node_list', 'loop'), e('loop', 'api'), e('api', 'end')];
    expect(messagesFor(validateFlow(nodes, edges), 'api')).toEqual([]);
  });
});
