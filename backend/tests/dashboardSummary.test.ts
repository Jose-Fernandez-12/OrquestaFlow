import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '../src/db/database';
import { buildDashboardSummary, rangeWindow } from '../src/engine/dashboardSummary';
import { detectMissedRuns } from '../src/engine/scheduler';
import { setupDb } from './helpers';

// Monday 9 Nov 2026, 20:30 in UTC-5 (already Tuesday 01:30 UTC)
const NOW = Date.parse('2026-11-10T01:30:00Z');
const TZ = -300;

let seq = 0;
function log(fields: Record<string, unknown>) {
  const row = { id: `log_${++seq}`, target_type: 'flow', target_id: 'f1', schedule_id: null, status: 'completed', trigger_type: 'manual', duration_ms: 1000, record_count: null, error_message: null, node_trace: null, result: null, started_at: '2026-11-09 15:00:00', ...fields };
  getDb().prepare(`
    INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status, trigger_type, duration_ms, record_count, error_message, node_trace, result, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.target_type, row.target_id, row.schedule_id, row.status, row.trigger_type, row.duration_ms, row.record_count, row.error_message, row.node_trace, row.result, row.started_at);
}

function schedule(id: string, fields: Record<string, unknown> = {}) {
  const row = { target_type: 'flow', target_id: 'f1', name: `Programación ${id}`, cron_expression: '0 8 * * 1', next_run_at: null, is_active: 1, ...fields };
  getDb().prepare('INSERT INTO schedules (id, target_type, target_id, name, cron_expression, next_run_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, row.target_type, row.target_id, row.name, row.cron_expression, row.next_run_at, row.is_active);
}

const summary = (range: '24h' | '7d' | '30d' = '7d') => buildDashboardSummary({ range, tzOffsetMinutes: TZ, now: NOW });

beforeAll(setupDb);

beforeEach(() => {
  const db = getDb();
  for (const table of ['execution_logs', 'schedules', 'flows', 'scripts', 'queries']) db.exec(`DELETE FROM ${table}`);
  db.prepare("INSERT INTO flows (id, name) VALUES ('f1', 'Liquidación mensual'), ('f2', 'Reporte semanal')").run();
  db.prepare("INSERT INTO scripts (id, name, file_path) VALUES ('s1', 'Limpiar ventas', 'scripts/limpiar.py')").run();
});

describe('rangeWindow', () => {
  it('ends with the current local day, not the UTC one', () => {
    const w = rangeWindow('7d', NOW, TZ);
    // Local Monday 9 ends at 05:00 UTC on Tuesday; seven local days back is Tuesday 3 at 05:00 UTC
    expect(new Date(w.endMs).toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(new Date(w.startMs).toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(w.buckets).toBe(7);
  });

  it('uses 24 hourly buckets ending with the current hour', () => {
    const w = rangeWindow('24h', NOW, TZ);
    expect(new Date(w.endMs).toISOString()).toBe('2026-11-10T02:00:00.000Z');
    expect(w.buckets).toBe(24);
  });
});

describe('buildDashboardSummary', () => {
  it('counts by status and leaves out debug runs, node tests and scripts launched by a flow', () => {
    log({ status: 'completed', duration_ms: 2000, record_count: 40 });
    log({ status: 'error', duration_ms: 4000, trigger_type: 'schedule' });
    log({ status: 'cancelled' });
    log({ target_type: 'script', target_id: 's1', trigger_type: null });
    log({ status: 'error', trigger_type: 'debug' });
    log({ target_type: 'script', target_id: 's1', trigger_type: 'flow' });
    log({ target_type: 'node', target_id: 'n1' });

    const { totals, failedByTrigger } = summary();
    expect(totals).toMatchObject({ total: 4, completed: 2, error: 1, cancelled: 1, records: 40 });
    expect(totals.successRate).toBeCloseTo(2 / 3);
    expect(totals.avgDurationMs).toBe(Math.round((2000 + 1000 + 4000) / 3));
    expect(failedByTrigger).toEqual({ schedule: 1 });
  });

  it('puts each run in the bucket of the local day it started', () => {
    log({ started_at: '2026-11-10 01:00:00' });               // Monday 20:00 local → today
    log({ started_at: '2026-11-09 04:30:00', status: 'error' }); // Sunday 23:30 local → yesterday
    log({ started_at: '2026-11-03 04:59:59' });               // before the window → previous period

    const { series, totals, previous } = summary();
    expect(series).toHaveLength(7);
    expect(series[6]).toMatchObject({ start: '2026-11-09T05:00:00.000Z', completed: 1, error: 0 });
    expect(series[5]).toMatchObject({ completed: 0, error: 1 });
    expect(totals.total).toBe(2);
    expect(previous.total).toBe(1);
  });

  it('reports a target as failing only while its latest finished run is an error', () => {
    const trace = JSON.stringify([{ nodeId: 'a', label: 'Inicio', status: 'completed' }, { nodeId: 'b', label: 'Consulta ventas', status: 'error' }]);
    log({ target_id: 'f1', status: 'error', trigger_type: 'schedule', error_message: 'Timeout', node_trace: trace, started_at: '2026-11-09 13:00:00' });
    // A stopped run afterwards does not hide the failure
    log({ target_id: 'f1', status: 'cancelled', started_at: '2026-11-09 14:00:00' });
    // f2 failed and then succeeded: no longer failing
    log({ target_id: 'f2', status: 'error', started_at: '2026-11-09 13:00:00' });
    log({ target_id: 'f2', status: 'completed', started_at: '2026-11-09 13:05:00' });
    // Failures of deleted targets and debug sessions are ignored
    log({ target_id: 'deleted', status: 'error' });
    log({ target_type: 'script', target_id: 's1', status: 'error', trigger_type: 'debug' });
    schedule('sch1', { target_id: 'f1', next_run_at: '2026-11-16T13:00:00.000Z' });

    const { failing } = summary();
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ targetId: 'f1', targetName: 'Liquidación mensual', trigger: 'schedule', error: 'Timeout', failedNode: 'Consulta ventas', scheduled: true, failedAt: '2026-11-09T13:00:00.000Z' });
  });

  it('lists the latest runs with their target name and the error of failed queries', () => {
    getDb().prepare("INSERT INTO queries (id, name, sql_text) VALUES ('q1', 'Ventas por región', 'SELECT 1')").run();
    log({ target_type: 'query', target_id: 'q1', trigger_type: null, status: 'error', result: JSON.stringify({ error: 'Login failed' }), started_at: '2026-11-09 16:00:00' });
    log({ target_id: 'f2', status: 'running', duration_ms: null, started_at: '2026-11-09 17:00:00' });

    const { recent, totals } = summary();
    expect(buildDashboardSummary({ range: '7d', tzOffsetMinutes: TZ, now: NOW, onlyFailedRecent: true }).recent.map(r => r.targetName)).toEqual(['Ventas por región']);
    expect(recent.map(r => r.targetName)).toEqual(['Reporte semanal', 'Ventas por región']);
    expect(recent[0]).toMatchObject({ status: 'running', startedAt: '2026-11-09T17:00:00.000Z' });
    expect(recent[1]).toMatchObject({ targetType: 'query', trigger: 'manual', error: 'Login failed' });
    expect(totals.running).toBe(1);
  });

  it('orders upcoming schedules by date and attaches the last result of each target', () => {
    schedule('later', { target_id: 'f1', next_run_at: '2026-11-16T13:00:00.000Z' });
    schedule('sooner', { target_id: 'f2', next_run_at: '2026-11-10T11:00:00.000Z' });
    schedule('paused', { target_id: 'f2', next_run_at: '2026-11-10T09:00:00.000Z', is_active: 0 });
    log({ target_id: 'f1', status: 'error' });

    const { upcoming, schedules } = summary();
    expect(upcoming.map(u => u.scheduleId)).toEqual(['sooner', 'later']);
    expect(upcoming[0].lastStatus).toBeNull();
    expect(upcoming[1]).toMatchObject({ lastStatus: 'error', targetName: 'Liquidación mensual' });
    expect(schedules).toEqual({ active: 2, paused: 1 });
    expect(summary().scheduledTargets.sort()).toEqual(['flow:f1', 'flow:f2']);
  });

  it('knows whether any flow has ever finished a run', () => {
    expect(summary().hasFlowRuns).toBe(false);
    log({ target_type: 'script', target_id: 's1' });
    expect(summary().hasFlowRuns).toBe(false);
    log({ target_id: 'f1' });
    expect(summary().hasFlowRuns).toBe(true);
  });
});

describe('missed scheduled runs', () => {
  it('flags a schedule whose run time passed while the server was off, until the target runs again', () => {
    schedule('sch1', { target_id: 'f1', next_run_at: '2026-11-09T13:00:00.000Z' });
    schedule('future', { target_id: 'f2', next_run_at: '2026-11-16T13:00:00.000Z' });

    expect(detectMissedRuns(NOW)).toEqual(['sch1']);
    const { missed } = summary();
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ scheduleId: 'sch1', targetName: 'Liquidación mensual', missedAt: '2026-11-09T13:00:00.000Z' });

    // Running the flow by hand makes up for it
    log({ target_id: 'f1', started_at: '2026-11-09 23:00:00' });
    expect(summary().missed).toEqual([]);
  });

  it('does not flag a schedule that did run but was left with a stale next_run_at', () => {
    schedule('sch1', { target_id: 'f1', next_run_at: '2026-11-09T13:00:00.000Z' });
    log({ target_id: 'f1', schedule_id: 'sch1', status: 'error', trigger_type: 'schedule', started_at: '2026-11-09 13:00:00' });

    expect(detectMissedRuns(NOW)).toEqual([]);
    expect(summary().missed).toEqual([]);
  });
});
