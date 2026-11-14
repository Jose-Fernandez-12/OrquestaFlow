import { describe, expect, it } from 'vitest';
import { readApiResponse } from '../lib/api';
import connectionReducer, {
  createConnection,
  deleteConnection,
  fetchConnections,
  setDestinations,
  testConnection,
} from './connectionSlice';
import flowReducer, {
  deleteFlow,
  duplicateFlow,
  fetchFlow,
  fetchFlows,
  resumeDebugNode,
  saveFlow,
} from './flowSlice';
import queryReducer, {
  cancelQuery,
  executeQuery,
  fetchQueries,
} from './querySlice';
import scheduleReducer, {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  updateSchedule,
} from './scheduleSlice';
import scriptReducer, { fetchScripts } from './scriptSlice';

describe('readApiResponse', () => {
  it('returns parsed JSON when response.ok is true', async () => {
    const res = new Response(JSON.stringify({ data: [1, 2] }), { status: 200 });
    await expect(readApiResponse<{ data: number[] }>(res, 'Fallback')).resolves.toEqual({ data: [1, 2] });
  });

  it('throws server message/error or fallback message with status when !res.ok', async () => {
    const withMsg = new Response(JSON.stringify({ message: 'Permiso denegado' }), { status: 403 });
    await expect(readApiResponse(withMsg, 'Error base')).rejects.toThrow('Permiso denegado');

    const withErr = new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });
    await expect(readApiResponse(withErr, 'Error base')).rejects.toThrow('No encontrado');

    const invalidJson = new Response('Bad Gateway', { status: 502 });
    await expect(readApiResponse(invalidJson, 'Error base')).rejects.toThrow('Error base (502)');
  });
});

describe('Redux slice error and cleanup handling', () => {
  it('resets loading and records error on scriptSlice rejection', () => {
    const pendingState = scriptReducer(undefined, fetchScripts.pending('req1'));
    expect(pendingState.loading).toBe(true);
    expect(pendingState.error).toBeNull();

    const rejectedState = scriptReducer(
      pendingState,
      fetchScripts.rejected(new Error('API caída'), 'req1')
    );
    expect(rejectedState.loading).toBe(false);
    expect(rejectedState.error).toBe('API caída');
  });

  it('resets loading and records error on scheduleSlice rejections', () => {
    let state = scheduleReducer(undefined, fetchSchedules.pending('r1'));
    expect(state.loading).toBe(true);

    state = scheduleReducer(state, fetchSchedules.rejected(new Error('Sin red'), 'r1'));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Sin red');

    state = scheduleReducer(
      { ...state, loading: true },
      createSchedule.rejected(new Error('Cron inválido'), 'r2', {
        target_type: 'query',
        target_id: 'q1',
        cron_expression: 'bad',
      })
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Cron inválido');

    state = scheduleReducer(
      { ...state, loading: true },
      updateSchedule.rejected(new Error('No existe'), 'r3', { id: 's1' })
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('No existe');

    state = scheduleReducer(
      { ...state, loading: true },
      deleteSchedule.rejected(new Error('Bloqueado'), 'r4', 's1')
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Bloqueado');
  });

  it('resets loading/executing and records error on querySlice rejections', () => {
    let state = queryReducer(undefined, fetchQueries.pending('r1'));
    state = queryReducer(state, fetchQueries.rejected(new Error('DB offline'), 'r1'));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('DB offline');

    state = queryReducer(
      state,
      executeQuery.pending('r2', { id: 'q1', connection_ids: ['c1'], logId: 'log-1' })
    );
    expect(state.executing).toBe(true);
    expect(state.activeExecutionLogId).toBe('log-1');

    state = queryReducer(
      state,
      executeQuery.rejected(new Error('Syntax error'), 'r2', { id: 'q1', connection_ids: ['c1'] })
    );
    expect(state.executing).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.activeExecutionLogId).toBeNull();
    expect(state.error).toBe('Syntax error');

    state = queryReducer(
      { ...state, executing: true, activeExecutionLogId: 'log-2' },
      cancelQuery.rejected(new Error('Cancel failed'), 'r3', { id: 'q1', logId: 'log-2' })
    );
    expect(state.executing).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.activeExecutionLogId).toBeNull();
    expect(state.error).toBe('Cancel failed');
  });

  it('resets loading and preserves debug-lost behavior on flowSlice rejections', () => {
    const sampleFlow = {
      id: 'f1',
      name: 'Flujo',
      description: '',
      definition: '{}',
      status: 'draft',
      last_run_at: null,
      last_run_duration_ms: null,
      last_run_record_count: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    let state = flowReducer(undefined, fetchFlows.pending('r1'));
    state = flowReducer(state, fetchFlows.rejected(new Error('Fallo flujos'), 'r1'));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Fallo flujos');

    state = flowReducer({ ...state, loading: true }, fetchFlow.rejected(new Error('404 flujo'), 'r2', 'f1'));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('404 flujo');

    state = flowReducer(
      { ...state, loading: true },
      saveFlow.rejected(new Error('Conflicto'), 'r3', { id: 'f1', name: 'Flujo' })
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Conflicto');

    state = flowReducer({ ...state, loading: true }, deleteFlow.rejected(new Error('En uso'), 'r4', 'f1'));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('En uso');

    state = flowReducer(
      { ...state, loading: true },
      duplicateFlow.rejected(new Error('Cuota'), 'r5', sampleFlow)
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Cuota');

    state = flowReducer(
      {
        ...state,
        executingNodeIds: ['n1'],
        pausedNodeIds: ['n1'],
        isDebugModalOpen: true,
      },
      resumeDebugNode.rejected(
        new Error('No running'),
        'r6',
        { id: 'f1', nodeId: 'n1', action: 'continue' },
        'not_running'
      )
    );
    expect(state.executingNodeIds).toEqual([]);
    expect(state.pausedNodeIds).toEqual([]);
    expect(state.isDebugModalOpen).toBe(false);
    expect(state.debugSessionLostAt).not.toBeNull();
  });

  it('removes deleted connection id from selectedDestinations and resets loading on rejection', () => {
    const conn = {
      id: 'c1',
      name: 'Prod DB',
      group_name: 'Core',
      region: 'us-east',
      city: null,
      host: 'localhost',
      database_name: 'app',
      port: 5432,
      driver: 'postgres',
      env_credential_key: null,
      is_active: 1,
      last_tested_at: null,
      created_at: '2026-01-01',
    };

    let state = connectionReducer(
      undefined,
      fetchConnections.fulfilled(
        { data: [conn], grouped: { Core: { 'us-east': [conn] } } },
        'r1'
      )
    );
    state = connectionReducer(state, setDestinations(['c1', 'c2']));
    state = connectionReducer(state, deleteConnection.fulfilled('c1', 'r2', 'c1'));

    expect(state.connections).toEqual([]);
    expect(state.selectedDestinations).toEqual(['c2']);

    state = connectionReducer(
      { ...state, loading: true },
      createConnection.rejected(new Error('Host inválido'), 'r3', {})
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Host inválido');

    state = connectionReducer(
      { ...state, loading: true },
      testConnection.rejected(new Error('Timeout'), 'r4', 'c2')
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Timeout');
  });
});
