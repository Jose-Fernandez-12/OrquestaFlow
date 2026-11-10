import { describe, it, expect } from 'vitest';
import { buildAttention, headline } from './attention';
import type { DashboardSummary } from './dashboardApi';
import type { Flow } from '../../store/flowSlice';
import type { Script, ScriptEnvView } from '../../store/scriptSlice';

const NOW = Date.parse('2026-11-09T20:00:00Z');

const flow = (id: string, definition: string): Flow => ({
  id, name: `Flujo ${id}`, description: '', definition, status: 'saved',
  last_run_at: null, last_run_duration_ms: null, last_run_record_count: null, created_at: '', updated_at: '',
});
const BROKEN = '{not json';
const EMPTY = JSON.stringify({ nodes: [], edges: [] });

const script = (id: string, view: ScriptEnvView | null): Script => ({
  id, name: `script ${id}`, description: '', file_path: `scripts/${id}.py`, language: 'python', schedule_cron: null,
  last_run_at: null, last_run_status: null, created_at: '',
  env: view ? { view, dependencies: [], requiresPython: null, metadataError: null, stale: false, state: null } : null,
});

const summary = (partial: Partial<DashboardSummary>): DashboardSummary => ({ failing: [], missed: [], scheduledTargets: [], ...partial } as DashboardSummary);

describe('buildAttention', () => {
  it('has nothing to report when everything is healthy', () => {
    const items = buildAttention({ summary: summary({}), flows: [flow('a', EMPTY)], scripts: [script('s', 'compartido')], pythonReady: true, now: NOW });
    expect(items.filter(i => i.kind !== 'invalid-flow')).toEqual([]);
    expect(headline([])).toEqual({ tone: 'ok', text: 'Todo en orden' });
  });

  it('puts failures first, scheduled ones before manual ones, with the reason and the node', () => {
    const items = buildAttention({
      summary: summary({
        failing: [
          { logId: 'l1', targetType: 'script', targetId: 's1', targetName: 'Limpiar ventas', trigger: 'manual', error: 'El script terminó con código 1', failedNode: null, failedAt: '2026-11-09T19:00:00.000Z', scheduled: false },
          { logId: 'l2', targetType: 'flow', targetId: 'f1', targetName: 'Liquidación', trigger: 'schedule', error: 'Timeout', failedNode: 'Consulta ventas', failedAt: '2026-11-09T18:00:00.000Z', scheduled: true },
        ],
        missed: [{ scheduleId: 'sch', scheduleName: 'Semanal', targetType: 'flow', targetId: 'f2', targetName: 'Reporte', missedAt: '2026-11-09T13:00:00.000Z', nextRunAt: null }],
      }),
      flows: [], scripts: [], pythonReady: true, now: NOW,
    });

    expect(items.map(i => i.key)).toEqual(['failed:flow:f1', 'failed:script:s1', 'missed:sch']);
    expect(items[0]).toMatchObject({ severity: 'danger', title: 'Liquidación', detail: 'Falló hace 2 h · Programada · Timeout (nodo «Consulta ventas»)' });
    expect(items[2].title).toBe('Reporte');
    expect(items[2].detail).toMatch(/^No se ejecutó el .+: el servidor no estaba en marcha$/);
    expect(headline(items)).toEqual({ tone: 'danger', text: '2 ejecuciones fallidas y 1 pendiente por revisar' });
  });

  it('treats an invalid flow as urgent only when a schedule is about to run it', () => {
    const items = buildAttention({
      summary: summary({ scheduledTargets: ['flow:b'] }),
      flows: [flow('a', BROKEN), flow('b', BROKEN)], scripts: [], pythonReady: true, now: NOW,
    });
    expect(items.map(i => [i.targetId, i.severity])).toEqual([['b', 'danger'], ['a', 'warn']]);
    expect(items[0].detail).toBe('1 error de validación · está programado y fallará en su próxima ejecución');
    expect(headline(items).text).toBe('2 pendientes por revisar');
  });

  it('groups scripts blocked by the base environment into one row', () => {
    const scripts = [script('a', 'no-preparado'), script('b', 'no-preparado'), script('c', 'pendiente'), script('node', null)];
    const items = buildAttention({ summary: summary({}), flows: [], scripts, pythonReady: false, now: NOW });
    expect(items.map(i => i.key)).toEqual(['python-base', 'script-env:c']);
    expect(items[0].detail).toBe('Bloquea 2 scripts: script a, script b');
    expect(headline(items).tone).toBe('warn');
  });

  it('does not ask for Python when no script needs it', () => {
    expect(buildAttention({ summary: summary({}), flows: [], scripts: [script('node', null)], pythonReady: false, now: NOW })).toEqual([]);
  });
});
