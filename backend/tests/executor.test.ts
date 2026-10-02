import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setupDb, runFlow, edge, jsonResponse, createFlow } from './helpers';
import { executeFlowEngine } from '../src/engine/executor';
import ExcelJS from 'exceljs';
import fs from 'fs';

beforeAll(() => setupDb());
afterEach(() => vi.unstubAllGlobals());

const start = { id: 'start', type: 'start', data: { label: 'Inicio' } };
const list = (id: string, items: any[]) => ({ id, type: 'dataList', data: { label: id, items: JSON.stringify(items) } });
const transform = (id: string, expression: string, extra: Record<string, any> = {}) =>
  ({ id, type: 'jsonTransform', data: { label: id, transformType: 'javascript', expression, ...extra } });
const http = (id: string, extra: Record<string, any> = {}) =>
  ({ id, type: 'httpRequest', data: { label: id, method: 'GET', endpoint: 'https://api.test.local/items', retryDelayMs: 0, ...extra } });

describe('executeFlowEngine · basic DAG', () => {
  it('runs nodes in dependency order and passes data downstream', async () => {
    const { context } = await runFlow(
      [start, list('ventas', [{ total: 10 }, { total: 5 }]), transform('suma', 'return data.reduce((a, r) => a + r.total, 0);')],
      [edge('start', 'ventas'), edge('ventas', 'suma')]
    );
    expect(context.ventas).toHaveLength(2);
    expect(context.suma).toBe(15);
  });

  it('runs an edge drawn backwards in the right order', async () => {
    // "suma" reads from "ventas" but the edge was drawn suma -> ventas
    const { context } = await runFlow(
      [list('ventas', [{ total: 3 }]), transform('suma', 'return data.length;', { inputData: '{{ventas}}' })],
      [edge('suma', 'ventas')]
    );
    expect(context.suma).toBe(1);
  });

  it('keeps edges between ids that only share a prefix (node_1 / node_10)', async () => {
    const { events } = await runFlow(
      [
        list('node_10', [{ a: 1 }]),
        list('node_1', [{ b: 2 }]),
        transform('node_2', 'return data;', { inputData: '{{node_10}}' }),
      ],
      [edge('node_10', 'node_2'), edge('node_2', 'node_1')]
    );
    const order = events.filter(e => e.status === 'completed').map(e => e.nodeId);
    expect(order.indexOf('node_2')).toBeLessThan(order.indexOf('node_1'));
  });
});

describe('executeFlowEngine · notes', () => {
  it('ignores note nodes on the canvas', async () => {
    const { context, events } = await runFlow(
      [start, { id: 'nota', type: 'note', data: { label: 'Nota', text: 'Explica el flujo' } }, list('ventas', [{ total: 1 }])],
      [edge('start', 'ventas')]
    );
    expect(context.nota).toBeUndefined();
    expect(events.some(e => e.nodeId === 'nota')).toBe(false);
  });
});

describe('executeFlowEngine · conditional branch', () => {
  it('only runs the selected branch', async () => {
    const branch = {
      id: 'br',
      type: 'conditionalBranch',
      data: { label: 'br', mode: 'if_else', conditions: [{ id: 'r1', left: '{{ventas.total}}', operator: 'gt', right: '100' }] },
    };
    const { context, trace } = await runFlow(
      [list('ventas', [{ total: 250 }]), branch, transform('alta', 'return "alta";'), transform('baja', 'return "baja";')],
      [edge('ventas', 'br'), edge('br', 'alta', { sourceHandle: 'true' }), edge('br', 'baja', { sourceHandle: 'false' })]
    );
    expect(context.alta).toBe('alta');
    expect(context.baja).toBeUndefined();
    expect(trace.find(t => t.nodeId === 'baja')?.status).toBe('skipped');
  });
});

describe('executeFlowEngine · forEach loop', () => {
  it('runs the loop body once per item and collects the results', async () => {
    const { context, trace } = await runFlow(
      [
        list('items', [{ id: 1 }, { id: 2 }, { id: 3 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        transform('doble', 'return { doble: data.id * 2 };'),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'doble'), edge('doble', 'end')]
    );
    expect(context.end.map((r: any) => r.doble)).toEqual([2, 4, 6]);
    expect(trace.find(t => t.nodeId === 'doble')?.runs).toBe(3);
  });
});

describe('executeFlowEngine · nested forEach loops', () => {
  // Per station (EDS), one request per fleet of that station
  const estaciones = [
    { Eds: 'AMERICAS', IdEds: 2015, flotas: [{ id: 47092 }, { id: 47095 }] },
    { Eds: 'SUBA', IdEds: 2016, flotas: [{ id: 47096 }] },
  ];
  const nestedFlow = (afterInner: any[] = [], afterInnerEdges: any[] = []) => ({
    nodes: [
      list('estaciones', estaciones),
      { id: 'porEds', type: 'forEach', data: { label: 'porEds', iterateOver: '{{estaciones}}', itemAlias: 'eds' } },
      { id: 'porFlota', type: 'forEach', data: { label: 'porFlota', iterateOver: '{{_item.flotas}}' } },
      http('reporte', {
        method: 'POST',
        body: JSON.stringify({ idEds: '{{eds.IdEds}}', idFlota: '{{_item.id}}' }),
      }),
      { id: 'finFlota', type: 'forEachEnd', data: { label: 'finFlota' } },
      ...afterInner,
      { id: 'finEds', type: 'forEachEnd', data: { label: 'finEds' } },
    ],
    edges: [
      edge('estaciones', 'porEds'),
      edge('porEds', 'porFlota'),
      edge('porFlota', 'reporte'),
      edge('reporte', 'finFlota'),
      ...(afterInnerEdges.length ? afterInnerEdges : [edge('finFlota', 'finEds')]),
    ],
  });

  const mockReports = () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      return jsonResponse({ archivo: `reporte_${body.idEds}_${body.idFlota}.xlsx` });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('runs the inner loop for each element of the outer one', async () => {
    const fetchMock = mockReports();
    const { nodes, edges } = nestedFlow();
    const { context, trace } = await runFlow(nodes, edges);

    const sent = fetchMock.mock.calls.map(([, init]: any) => JSON.parse(init.body));
    expect(sent).toEqual([
      { idEds: 2015, idFlota: 47092 },
      { idEds: 2015, idFlota: 47095 },
      { idEds: 2016, idFlota: 47096 },
    ]);
    expect(trace.find(t => t.nodeId === 'reporte')?.runs).toBe(3);
    // The outer end collects every inner row, each with its station and fleet
    expect(context.finEds.map((r: any) => [r.Eds, r.id, r.archivo])).toEqual([
      ['AMERICAS', 47092, 'reporte_2015_47092.xlsx'],
      ['AMERICAS', 47095, 'reporte_2015_47095.xlsx'],
      ['SUBA', 47096, 'reporte_2016_47096.xlsx'],
    ]);
  });

  it('keeps the outer element available after the inner loop ends', async () => {
    mockReports();
    const { nodes, edges } = nestedFlow(
      [transform('resumen', 'return { eds: item.Eds, reportes: {{finFlota}}.length };')],
      [edge('finFlota', 'resumen'), edge('resumen', 'finEds')]
    );
    const { context } = await runFlow(nodes, edges);
    expect(context.finEds.map((r: any) => [r.eds, r.reportes])).toEqual([
      ['AMERICAS', 2],
      ['SUBA', 1],
    ]);
  });

  it('sends a mapped list or object as real JSON inside the body', async () => {
    const fetchMock = mockReports();
    await runFlow(
      [
        list('flotas', [{ id: 47092, nombreCompleto: 'CAPITALBUS' }]),
        http('reporte', {
          method: 'POST',
          body: JSON.stringify({ idEds: 1, idFlota: '{{flotas}}', nota: 'flota {{flotas.nombreCompleto}}' }),
        }),
      ],
      [edge('flotas', 'reporte')]
    );
    const [, init] = fetchMock.mock.calls[0] as any;
    expect(JSON.parse(init.body)).toEqual({
      idEds: 1,
      idFlota: [{ id: 47092, nombreCompleto: 'CAPITALBUS' }],
      nota: 'flota CAPITALBUS',
    });
  });

  it('runs an outer element whose inner list is empty', async () => {
    const fetchMock = mockReports();
    const { nodes, edges } = nestedFlow();
    nodes[0] = list('estaciones', [{ Eds: 'VACIA', IdEds: 1, flotas: [] }, estaciones[1]]);
    const { context } = await runFlow(nodes, edges);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(context.finEds.map((r: any) => r.Eds)).toEqual(['VACIA', 'SUBA']);
  });
});

describe('executeFlowEngine · retries', () => {
  it('retries an HTTP request that fails with 503 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValue(jsonResponse([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const { context, events, trace } = await runFlow([http('api', { retryCount: 3 })], []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(context.api).toEqual([{ id: 1 }]);
    expect(events.filter(e => e.status === 'progress' && e.result?.retry)).toHaveLength(2);
    expect(trace[0]).toMatchObject({ status: 'completed', retries: 2 });
  });

  it('does not retry a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'missing' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runFlow([http('api', { retryCount: 3 })], [])).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors and fails after the configured attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runFlow([http('api', { retryCount: 2 })], [])).rejects.toThrow(/ECONNREFUSED/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the global http_max_retries setting when the node has no retry count', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    vi.stubGlobal('fetch', fetchMock);

    // The seeded default is 1 retry
    await expect(runFlow([http('api')], [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('executeFlowEngine · continue on error', () => {
  it('lets downstream nodes run when a node fails with onError = continue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'missing' }, 404)));

    const { context, events, trace } = await runFlow(
      [http('api', { retryCount: 0, onError: 'continue' }), transform('despues', 'return data.failed ? "manejado" : "ok";')],
      [edge('api', 'despues')]
    );
    expect(context.api).toMatchObject({ failed: true });
    expect(context.despues).toBe('manejado');
    expect(events.find(e => e.nodeId === 'api' && e.status === 'error')?.result).toMatchObject({ continued: true });
    expect(trace.find(t => t.nodeId === 'api')?.status).toBe('continued');
  });

  it('stops the flow by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(
      runFlow([http('api', { retryCount: 0 }), transform('despues', 'return 1;')], [edge('api', 'despues')])
    ).rejects.toThrow(/400/);
  });

  it('continues inside a loop iteration', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const { context } = await runFlow(
      [
        list('items', [{ id: 1 }, { id: 2 }, { id: 3 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        http('api', { retryCount: 0, onError: 'continue', endpoint: 'https://api.test.local/items/{{_item.id}}' }),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'api'), edge('api', 'end')]
    );
    expect(context.end).toHaveLength(3);
    expect(context.end[1]).toMatchObject({ id: 2, failed: true });
  });
});

describe('executeFlowEngine · single-node test', () => {
  it('runs only the requested node with the upstream results provided', async () => {
    const flowId = createFlow(
      [start, list('ventas', [{ total: 1 }]), transform('suma', 'return data.reduce((a, r) => a + r.total, 0);'), transform('despues', 'return "no debe correr";')],
      [edge('start', 'ventas'), edge('ventas', 'suma'), edge('suma', 'despues')]
    );
    const events: Array<{ nodeId: string; status: string }> = [];
    const context = await executeFlowEngine(flowId, (nodeId, status) => events.push({ nodeId, status }), {
      initialContext: { ventas: [{ total: 10 }, { total: 32 }] },
      onlyNodeIds: ['suma'],
    });
    expect(context.suma).toBe(42);
    expect(context.despues).toBeUndefined();
    expect(new Set(events.map(e => e.nodeId))).toEqual(new Set(['suma']));
  });

  it('can test a node that lives inside a loop using the current item', async () => {
    const flowId = createFlow(
      [
        list('items', [{ id: 1 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        transform('doble', 'return { doble: data.id * 2 };'),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'doble'), edge('doble', 'end')]
    );
    const context = await executeFlowEngine(flowId, undefined, { initialContext: { _item: { id: 21 } }, onlyNodeIds: ['doble'] });
    expect(context.doble).toEqual({ doble: 42 });
  });
});

describe('executeFlowEngine · http iteration output', () => {
  it('returns a list even when the iterated list has a single element', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ data: { ventas: [] } })));
    const { context } = await runFlow(
      [
        list('peticiones', [{ codigoEds: '540' }]),
        http('buscar', { method: 'POST', body: '{{_item}}', iterateMode: true, iterateOver: '{{peticiones}}' }),
        transform('ventas', 'return data.flatMap(r => r.data.ventas);'),
      ],
      [edge('peticiones', 'buscar'), edge('buscar', 'ventas')]
    );
    expect(Array.isArray(context.buscar)).toBe(true);
    expect(context.buscar).toHaveLength(1);
    expect(context.ventas).toEqual([]);
  });

  it('returns an empty list and sends nothing when the iterated list is empty', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { context } = await runFlow(
      [list('peticiones', []), http('buscar', { method: 'POST', body: '{{_item}}', iterateMode: true, iterateOver: '{{peticiones}}' })],
      [edge('peticiones', 'buscar')]
    );
    expect(context.buscar).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the response itself when the node does not iterate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ token: 'abc' })));
    const { context } = await runFlow([http('login')], []);
    expect(context.login).toEqual({ token: 'abc' });
  });
});

describe('executeFlowEngine · http body', () => {
  const peticiones = list('peticiones', [{ codigoEds: '13', numeroDocumentos: ['1'] }, { codigoEds: '51', numeroDocumentos: ['2'] }]);

  it('sends each item as the body of its request', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await runFlow(
      [peticiones, http('buscar', { method: 'POST', body: '{{_item}}', iterateMode: true, iterateOver: '{{peticiones}}' })],
      [edge('peticiones', 'buscar')]
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ codigoEds: '51', numeroDocumentos: ['2'] });
  });

  it('fails instead of sending an empty body when the body path does not exist', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runFlow(
      [peticiones, http('buscar', { method: 'POST', body: '{{_item._data}}', iterateMode: true, iterateOver: '{{peticiones}}' })],
      [edge('peticiones', 'buscar')]
    )).rejects.toThrow(/no produjo datos.*codigoEds, numeroDocumentos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('executeFlowEngine · partial run', () => {
  it('runs the selected nodes in dependency order, reading earlier results for the rest', async () => {
    // A slow first step: if the selection ran in parallel, "texto" would read no "suma"
    const flowId = createFlow(
      [
        start,
        list('ventas', [{ total: 1 }]),
        transform('suma', 'const t0 = Date.now(); while (Date.now() - t0 < 30) {} return data.reduce((a, r) => a + r.total, 0);'),
        transform('texto', 'return `total ${data}`;'),
        transform('fin', 'return data.toUpperCase();'),
      ],
      [edge('start', 'ventas'), edge('ventas', 'suma'), edge('suma', 'texto'), edge('texto', 'fin')]
    );
    const events: Array<{ nodeId: string; status: string }> = [];
    const context = await executeFlowEngine(flowId, (nodeId, status) => events.push({ nodeId, status }), {
      initialContext: { ventas: [{ total: 40 }, { total: 2 }] },
      onlyNodeIds: ['suma', 'texto', 'fin'],
    });
    expect(context.fin).toBe('TOTAL 42');
    const done = events.filter(e => e.status === 'completed').map(e => e.nodeId);
    expect(done).toEqual(['suma', 'texto', 'fin']);
    expect(events.some(e => e.nodeId === 'ventas')).toBe(false);
  });

  it('skips the branch that is not selected inside the partial run', async () => {
    const branch = {
      id: 'br',
      type: 'conditionalBranch',
      data: { label: 'br', mode: 'if_else', conditions: [{ id: 'r1', left: '{{ventas.total}}', operator: 'gt', right: '100' }] },
    };
    const flowId = createFlow(
      [list('ventas', [{ total: 1 }]), branch, transform('alta', 'return "alta";'), transform('baja', 'return "baja";')],
      [edge('ventas', 'br'), edge('br', 'alta', { sourceHandle: 'true' }), edge('br', 'baja', { sourceHandle: 'false' })]
    );
    const context = await executeFlowEngine(flowId, undefined, {
      initialContext: { ventas: [{ total: 500 }] },
      onlyNodeIds: ['br', 'alta', 'baja'],
    });
    expect(context.alta).toBe('alta');
    expect(context.baja).toBeUndefined();
  });

  it('runs a whole loop when the loop and its body are selected', async () => {
    const flowId = createFlow(
      [
        list('items', [{ id: 1 }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        transform('doble', 'return { doble: data.id * 2 };'),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
        transform('total', 'return data.length;'),
      ],
      [edge('items', 'loop'), edge('loop', 'doble'), edge('doble', 'end'), edge('end', 'total')]
    );
    const context = await executeFlowEngine(flowId, undefined, {
      initialContext: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      onlyNodeIds: ['loop', 'doble', 'end', 'total'],
    });
    expect(context.end.map((r: any) => r.doble)).toEqual([2, 4, 6]);
    expect(context.total).toBe(3);
  });
});

describe('executeFlowEngine · transform errors', () => {
  it('reports JavaScript errors from the transform node', async () => {
    await expect(runFlow([transform('t', 'throw new Error("dato inválido");')], [])).rejects.toThrow(/dato inválido/);
  });
});

describe('executeFlowEngine · multi-sheet export', () => {
  const readSheets = async (filePath: string) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return workbook.worksheets.map(ws => ({ name: ws.name, rows: ws.rowCount, header: ws.getRow(1).values }));
  };

  it('exports one tab per connected node, named after the node when no name was typed', async () => {
    const { context } = await runFlow(
      [
        list('VentasNoencontradas', [{ ticket: 'A1' }, { ticket: 'A2' }]),
        transform('ventasEncontradas', 'return [{ ticket: "B1", total: 10 }];'),
        { id: 'xls', type: 'export', data: { label: 'xls', format: 'Excel', exportMode: 'multi', fileName: `test_multi_${Date.now()}` } },
      ],
      [edge('VentasNoencontradas', 'xls'), edge('ventasEncontradas', 'xls')]
    );
    const sheets = await readSheets(context.xls.filePath);
    fs.rmSync(context.xls.filePath, { force: true });
    expect(sheets.map(s => [s.name, s.rows])).toEqual([['VentasNoencontradas', 3], ['ventasEncontradas', 2]]);
  });

  it('uses typed names, keeps empty results as a tab and makes names valid for Excel', async () => {
    const { context } = await runFlow(
      [
        list('a', [{ x: 1 }]),
        list('b', []),
        list('c', [{ y: 2 }]),
        {
          id: 'xls',
          type: 'export',
          data: { label: 'xls', format: 'Excel', exportMode: 'multi', fileName: `test_multi_${Date.now()}`, multiSheetConfig: { a: 'Ventas/Faltantes', c: 'Ventas Faltantes' } },
        },
      ],
      [edge('a', 'xls'), edge('b', 'xls'), edge('c', 'xls')]
    );
    const sheets = await readSheets(context.xls.filePath);
    fs.rmSync(context.xls.filePath, { force: true });
    expect(sheets.map(s => s.name)).toEqual(['Ventas Faltantes', 'b', 'Ventas Faltantes (2)']);
    expect(sheets[1].rows).toBe(1);
  });
});
