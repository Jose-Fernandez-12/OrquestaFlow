import { describe, it, expect, beforeAll } from 'vitest';
import { setupDb, createFlow, edge } from './helpers';
import { executeFlowEngine } from '../src/engine/executor';

beforeAll(() => setupDb());

const start = { id: 'start', type: 'start', data: { label: 'Inicio' } };

describe('executeFlowEngine · runtime parameters & subflows (runFlow)', () => {
  it('overrides variables node values with runtime params and coerces types', async () => {
    const flowId = createFlow(
      [
        start,
        {
          id: 'vars',
          type: 'variables',
          data: {
            label: 'Parámetros',
            variables: [
              { key: 'ambiente', type: 'string', value: 'dev', promptOnRun: true },
              { key: 'limite', type: 'number', value: '5', promptOnRun: true },
              { key: 'activo', type: 'boolean', value: false, promptOnRun: true },
            ],
          },
        },
        {
          id: 'calc',
          type: 'jsonTransform',
          data: {
            label: 'calc',
            transformType: 'javascript',
            expression: 'return { env: data.ambiente, doble: data.limite * 2, activo: data.activo };',
          },
        },
      ],
      [edge('start', 'vars'), edge('vars', 'calc')]
    );

    const context = await executeFlowEngine(flowId, undefined, {
      params: { ambiente: 'produccion', limite: '25', activo: 'true' },
    });

    expect(context.vars).toEqual({
      ambiente: 'produccion',
      limite: 25,
      activo: true,
    });
    expect(context.calc).toEqual({
      env: 'produccion',
      doble: 50,
      activo: true,
    });
  });

  it('executes a subflow via runFlow node with mapped parameters and returns its terminal output', async () => {
    const subflowId = createFlow(
      [
        start,
        {
          id: 'subVars',
          type: 'variables',
          data: {
            label: 'VariablesSub',
            variables: [
              { key: 'factor', type: 'number', value: 2 },
              { key: 'prefijo', type: 'string', value: 'ITEM' },
            ],
          },
        },
        {
          id: 'subCalc',
          type: 'jsonTransform',
          data: {
            label: 'ResultadoSub',
            transformType: 'javascript',
            expression: 'return { codigo: `${data.prefijo}-${data.factor * 10}`, total: data.factor * 10 };',
          },
        },
      ],
      [edge('start', 'subVars'), edge('subVars', 'subCalc')]
    );

    const parentFlowId = createFlow(
      [
        start,
        {
          id: 'parentVars',
          type: 'variables',
          data: {
            label: 'Config',
            variables: [{ key: 'miFactor', type: 'number', value: 7 }],
          },
        },
        {
          id: 'callSub',
          type: 'runFlow',
          data: {
            label: 'InvocarSubflujo',
            targetFlowId: subflowId,
            flowParams: [
              { key: 'factor', value: '{{Config.miFactor}}' },
              { key: 'prefijo', value: 'ORD' },
            ],
          },
        },
        {
          id: 'final',
          type: 'jsonTransform',
          data: {
            label: 'Final',
            transformType: 'javascript',
            expression: 'return { codigoRecibido: data.data.codigo, totalRecibido: data.data.total };',
          },
        },
      ],
      [edge('start', 'parentVars'), edge('parentVars', 'callSub'), edge('callSub', 'final')]
    );

    const context = await executeFlowEngine(parentFlowId);
    expect(context.callSub.data).toEqual({ codigo: 'ORD-70', total: 70 });
    expect(context.callSub.outputs.ResultadoSub).toEqual({ codigo: 'ORD-70', total: 70 });
    expect(context.final).toEqual({ codigoRecibido: 'ORD-70', totalRecibido: 70 });
  });

  it('detects direct and indirect recursive subflow cycles', async () => {
    const flowA = createFlow(
      [
        start,
        {
          id: 'callB',
          type: 'runFlow',
          data: { label: 'Llamar B', targetFlowId: 'placeholder' },
        },
      ],
      [edge('start', 'callB')]
    );

    const flowB = createFlow(
      [
        start,
        {
          id: 'callA',
          type: 'runFlow',
          data: { label: 'Llamar A', targetFlowId: flowA },
        },
      ],
      [edge('start', 'callA')]
    );

    // Update flowA so it calls flowB (creating cycle flowA -> flowB -> flowA)
    const { getDb } = await import('../src/db/database');
    getDb()
      .prepare('UPDATE flows SET definition = ? WHERE id = ?')
      .run(
        JSON.stringify({
          nodes: [
            start,
            {
              id: 'callB',
              type: 'runFlow',
              data: { label: 'Llamar B', targetFlowId: flowB },
            },
          ],
          edges: [edge('start', 'callB')],
        }),
        flowA
      );

    await expect(executeFlowEngine(flowA)).rejects.toThrow(/llamada recursiva circular/i);
  });
});

