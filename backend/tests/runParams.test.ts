import { describe, it, expect, vi, beforeAll } from 'vitest';
import { executeFlowEngine } from '../src/engine/executor';
import { createFlow, edge, jsonResponse, setupDb } from './helpers';

beforeAll(setupDb);

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const nodes = [
  { id: 's', type: 'start', data: { label: 'Inicio' } },
  { id: 'v', type: 'variables', data: { label: 'Variables', variables: [
    { key: 'fecha', type: 'date', value: '$today_ymd', promptOnRun: true },
    { key: 'umbral', type: 'number', value: '7', promptOnRun: true },
  ] } },
  { id: 'h', type: 'httpRequest', data: {
    label: 'API', method: 'POST',
    endpoint: 'https://api.example.test/x?f={{fecha}}',
    body: '{"u": "{{umbral}}", "f": "{{Variables.fecha}}", "extra": "{{region}}"}',
  } },
];

async function sent(params?: Record<string, any>) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
  try {
    const flowId = createFlow(nodes, [edge('s', 'v'), edge('v', 'h')]);
    const context = await executeFlowEngine(flowId, undefined, { params });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, body: JSON.parse(String(init.body)), context };
  } finally {
    fetchMock.mockRestore();
  }
}

describe('run parameters', () => {
  it('reach {{nombre}} converted, exactly as without parameters', async () => {
    // What the run dialog sends: the values as typed, dynamic dates included
    const withDialog = await sent({ fecha: '$today_ymd', umbral: '7' });
    const today = ymd(new Date());
    expect(withDialog.url).toBe(`https://api.example.test/x?f=${today}`);
    expect(withDialog.body.u).toBe(7);
    expect(withDialog.body.f).toBe(today);

    const changed = await sent({ fecha: '20260101', umbral: '12' });
    expect(changed.url).toBe('https://api.example.test/x?f=20260101');
    expect(changed.body.u).toBe(12);
  });

  it('keeps a parameter that no Variables node declares reachable, after node outputs', async () => {
    const { body, context } = await sent({ region: 'norte' });
    expect(body.extra).toBe('norte');
    // Not spread into the context, where it would shadow node outputs
    expect(context.region).toBeUndefined();
    expect(context.s).toEqual({ msg: 'Flow started', params: { region: 'norte' } });
  });
});
