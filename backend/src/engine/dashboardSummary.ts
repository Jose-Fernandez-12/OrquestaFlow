import { existsSync } from 'fs';
import { basename, join } from 'path';
import { getDb } from '../db/database.js';

export type DashboardRange = '24h' | '7d' | '30d';
export const DASHBOARD_RANGES: DashboardRange[] = ['24h', '7d', '30d'];

const HOUR = 3_600_000;
const DAY = 86_400_000;
const RECENT_LIMIT = 10;
const ATTENTION_LIMIT = 10;
const UPCOMING_LIMIT = 5;

/**
 * What counts as an execution on the dashboard. Left out: single-node tests ('node'), debug sessions,
 * and scripts launched by a flow node ('flow'), which are already part of that flow's run.
 */
const COUNTED = "target_type IN ('flow', 'script', 'query') AND COALESCE(trigger_type, 'manual') NOT IN ('debug', 'flow')";

const TARGET_NAME = `
  CASE l.target_type
    WHEN 'flow' THEN (SELECT name FROM flows WHERE id = l.target_id)
    WHEN 'script' THEN (SELECT name FROM scripts WHERE id = l.target_id)
    WHEN 'query' THEN (SELECT name FROM queries WHERE id = l.target_id)
  END`;

/** Epoch ms → the "YYYY-MM-DD HH:MM:SS" UTC text that datetime('now') stores */
const toDb = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** SQLite UTC text (or an ISO date) → ISO with zone, so the client never has to guess */
function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export interface RangeWindow {
  startMs: number;
  endMs: number;
  bucketMs: number;
  buckets: number;
}

/**
 * The period on screen, aligned to the user's clock: whole local days (or hours for 24 h), ending with the current one.
 * `tzOffsetMinutes` is local time minus UTC (-300 for UTC-5).
 */
export function rangeWindow(range: DashboardRange, now: number, tzOffsetMinutes: number): RangeWindow {
  const offset = tzOffsetMinutes * 60_000;
  const bucketMs = range === '24h' ? HOUR : DAY;
  const buckets = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const localEnd = Math.floor((now + offset) / bucketMs) * bucketMs + bucketMs;
  return { startMs: localEnd - buckets * bucketMs - offset, endMs: localEnd - offset, bucketMs, buckets };
}

export interface StatusTotals {
  total: number;
  completed: number;
  error: number;
  cancelled: number;
  running: number;
  /** completed / (completed + error); null when nothing has finished */
  successRate: number | null;
  avgDurationMs: number | null;
  records: number;
}

function totalsBetween(startMs: number, endMs: number): StatusTotals {
  const rows = getDb().prepare(`
    SELECT status, COUNT(*) AS count, SUM(duration_ms) AS duration, SUM(record_count) AS records
    FROM execution_logs
    WHERE ${COUNTED} AND started_at >= ? AND started_at < ?
    GROUP BY status
  `).all(toDb(startMs), toDb(endMs)) as Array<{ status: string; count: number; duration: number | null; records: number | null }>;

  const by = (status: string) => rows.find(r => r.status === status);
  const completed = by('completed')?.count ?? 0;
  const error = by('error')?.count ?? 0;
  const finished = completed + error;
  const duration = (by('completed')?.duration ?? 0) + (by('error')?.duration ?? 0);

  return {
    total: rows.reduce((acc, r) => acc + r.count, 0),
    completed,
    error,
    cancelled: by('cancelled')?.count ?? 0,
    running: by('running')?.count ?? 0,
    successRate: finished > 0 ? completed / finished : null,
    avgDurationMs: finished > 0 ? Math.round(duration / finished) : null,
    records: by('completed')?.records ?? 0,
  };
}

export interface SeriesBucket {
  start: string;
  completed: number;
  error: number;
  cancelled: number;
}

function seriesFor(window: RangeWindow, tzOffsetMinutes: number): SeriesBucket[] {
  const hourly = window.bucketMs === HOUR;
  const keyLength = hourly ? 13 : 10;
  const modifier = `${tzOffsetMinutes < 0 ? '-' : '+'}${Math.abs(tzOffsetMinutes)} minutes`;

  const rows = getDb().prepare(`
    SELECT strftime('${hourly ? '%Y-%m-%d %H' : '%Y-%m-%d'}', started_at, ?) AS bucket, status, COUNT(*) AS count
    FROM execution_logs
    WHERE ${COUNTED} AND started_at >= ? AND started_at < ?
    GROUP BY bucket, status
  `).all(modifier, toDb(window.startMs), toDb(window.endMs)) as Array<{ bucket: string; status: string; count: number }>;

  const offset = tzOffsetMinutes * 60_000;
  return Array.from({ length: window.buckets }, (_, i) => {
    const startMs = window.startMs + i * window.bucketMs;
    // Same local-clock key that strftime produced above
    const key = new Date(startMs + offset).toISOString().slice(0, keyLength).replace('T', ' ');
    const count = (status: string) => rows.find(r => r.bucket === key && r.status === status)?.count ?? 0;
    return { start: new Date(startMs).toISOString(), completed: count('completed'), error: count('error'), cancelled: count('cancelled') };
  });
}

export interface ExportedFile {
  fileName: string;
  downloadUrl: string;
  records: number | null;
}

/** Files written by a run that are still on disk. Manual runs store objects, scheduled runs only the names */
function exportedFiles(result: unknown): ExportedFile[] {
  let parsed: any;
  try {
    parsed = typeof result === 'string' ? JSON.parse(result) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.exportedFiles)) return [];

  const exportsDir = join(process.cwd(), 'data', 'exports');
  const files: ExportedFile[] = [];
  for (const entry of parsed.exportedFiles) {
    const raw = typeof entry === 'string' ? entry : entry?.fileName;
    if (typeof raw !== 'string' || !raw) continue;
    const fileName = basename(raw);
    if (!existsSync(join(exportsDir, fileName))) continue;
    files.push({ fileName, downloadUrl: `/api/files/${fileName}`, records: typeof entry?.records === 'number' ? entry.records : null });
  }
  return files;
}

/** Query runs keep their error inside `result` instead of error_message */
function errorOf(row: any): string | null {
  if (row.error_message) return String(row.error_message);
  if (row.target_type === 'query' && row.status === 'error' && typeof row.result === 'string') {
    try {
      const parsed = JSON.parse(row.result);
      if (parsed?.error) return String(parsed.error);
    } catch { /* not JSON */ }
  }
  return null;
}

/** Label of the node where a flow run stopped */
function failedNode(nodeTrace: unknown): string | null {
  try {
    const trace = typeof nodeTrace === 'string' ? JSON.parse(nodeTrace) : null;
    if (!Array.isArray(trace)) return null;
    const node = trace.find((n: any) => n?.status === 'error');
    return node?.label ? String(node.label) : null;
  } catch {
    return null;
  }
}

export interface RecentRun {
  id: string;
  targetType: 'flow' | 'script' | 'query';
  targetId: string;
  /** null when the flow, script or query was deleted afterwards */
  targetName: string | null;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  trigger: string;
  durationMs: number | null;
  recordCount: number | null;
  error: string | null;
  startedAt: string | null;
  files: ExportedFile[];
}

function recentRuns(onlyFailed: boolean): RecentRun[] {
  // `result` can hold every row of a query, so it is only read where it is small and needed
  const rows = getDb().prepare(`
    SELECT l.id, l.target_type, l.target_id, l.status, COALESCE(l.trigger_type, 'manual') AS trigger_type,
      l.duration_ms, l.record_count, l.error_message, l.started_at,
      CASE WHEN (l.target_type = 'flow' AND l.status = 'completed') OR (l.target_type = 'query' AND l.status = 'error') THEN l.result END AS result,
      ${TARGET_NAME} AS target_name
    FROM execution_logs l
    WHERE ${COUNTED}${onlyFailed ? " AND l.status = 'error'" : ''}
    ORDER BY l.started_at DESC, l.rowid DESC
    LIMIT ?
  `).all(RECENT_LIMIT) as any[];

  return rows.map(row => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name ?? null,
    status: row.status,
    trigger: row.trigger_type,
    durationMs: row.duration_ms ?? null,
    recordCount: row.record_count ?? null,
    error: errorOf(row),
    startedAt: toIso(row.started_at),
    files: row.target_type === 'flow' ? exportedFiles(row.result) : [],
  }));
}

export interface FailingTarget {
  logId: string;
  targetType: 'flow' | 'script';
  targetId: string;
  targetName: string;
  trigger: string;
  error: string | null;
  failedNode: string | null;
  failedAt: string | null;
  /** An active schedule will run it again on its own */
  scheduled: boolean;
}

/** Flows and scripts whose latest finished run failed. Stopped or skipped runs don't hide an earlier failure */
function failingTargets(scheduledTargets: Set<string>): FailingTarget[] {
  const operational = "COALESCE(trigger_type, 'manual') NOT IN ('debug', 'flow')";
  const rows = getDb().prepare(`
    SELECT l.id, l.target_type, l.target_id, COALESCE(l.trigger_type, 'manual') AS trigger_type,
      l.error_message, l.node_trace, l.started_at, ${TARGET_NAME} AS target_name
    FROM execution_logs l
    JOIN (
      SELECT MAX(rowid) AS last_rowid FROM execution_logs
      WHERE target_type IN ('flow', 'script') AND status IN ('completed', 'error') AND ${operational}
      GROUP BY target_type, target_id
    ) latest ON latest.last_rowid = l.rowid
    WHERE l.status = 'error'
    ORDER BY l.started_at DESC, l.rowid DESC
  `).all() as any[];

  return rows
    .filter(row => row.target_name)
    .slice(0, ATTENTION_LIMIT)
    .map(row => ({
      logId: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      targetName: row.target_name,
      trigger: row.trigger_type,
      error: row.error_message ? String(row.error_message) : null,
      failedNode: row.target_type === 'flow' ? failedNode(row.node_trace) : null,
      failedAt: toIso(row.started_at),
      scheduled: scheduledTargets.has(`${row.target_type}:${row.target_id}`),
    }));
}

export interface MissedRun {
  scheduleId: string;
  scheduleName: string;
  targetType: 'flow' | 'script' | 'query';
  targetId: string;
  targetName: string | null;
  missedAt: string | null;
  nextRunAt: string | null;
}

/** Scheduled runs that did not happen (server off) and that nothing has made up for since */
function missedRuns(): MissedRun[] {
  const rows = getDb().prepare(`
    SELECT l.id, l.name, l.target_type, l.target_id, l.last_missed_at, l.next_run_at, ${TARGET_NAME} AS target_name
    FROM schedules l
    WHERE l.is_active = 1 AND l.last_missed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM execution_logs e
        WHERE e.target_type = l.target_type AND e.target_id = l.target_id AND e.started_at > datetime(l.last_missed_at)
      )
    ORDER BY l.last_missed_at DESC
  `).all() as any[];

  return rows.map(row => ({
    scheduleId: row.id,
    scheduleName: row.name || row.target_name || 'Tarea programada',
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name ?? null,
    missedAt: toIso(row.last_missed_at),
    nextRunAt: toIso(row.next_run_at),
  }));
}

export interface UpcomingRun {
  scheduleId: string;
  scheduleName: string;
  targetType: 'flow' | 'script' | 'query';
  targetId: string;
  targetName: string | null;
  cronExpression: string;
  nextRunAt: string | null;
  /** Result of the target's latest finished run, whoever started it; null if it never ran */
  lastStatus: 'completed' | 'error' | null;
}

function upcomingRuns(): UpcomingRun[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT l.id, l.name, l.target_type, l.target_id, l.cron_expression, l.next_run_at, ${TARGET_NAME} AS target_name
    FROM schedules l
    WHERE l.is_active = 1 AND l.next_run_at IS NOT NULL
  `).all() as any[];

  // next_run_at is ISO text while log dates are SQLite text: compare as dates, not as strings
  return rows
    .map(row => ({ row, at: new Date(row.next_run_at).getTime() }))
    .filter(item => !isNaN(item.at))
    .sort((a, b) => a.at - b.at)
    .slice(0, UPCOMING_LIMIT)
    .map(({ row }) => {
      const last = db.prepare(`
        SELECT status FROM execution_logs
        WHERE target_type = ? AND target_id = ? AND status IN ('completed', 'error') AND COALESCE(trigger_type, 'manual') != 'debug'
        ORDER BY rowid DESC LIMIT 1
      `).get(row.target_type, row.target_id) as { status: 'completed' | 'error' } | undefined;
      return {
        scheduleId: row.id,
        scheduleName: row.name || row.target_name || 'Tarea programada',
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name ?? null,
        cronExpression: row.cron_expression,
        nextRunAt: toIso(row.next_run_at),
        lastStatus: last?.status ?? null,
      };
    });
}

export interface DashboardSummary {
  range: DashboardRange;
  generatedAt: string;
  totals: StatusTotals;
  /** Same length of time, right before the period on screen */
  previous: StatusTotals;
  failedByTrigger: Record<string, number>;
  series: SeriesBucket[];
  recent: RecentRun[];
  failing: FailingTarget[];
  missed: MissedRun[];
  upcoming: UpcomingRun[];
  schedules: { active: number; paused: number };
  /** "flow:<id>" / "script:<id>" of everything an active schedule runs */
  scheduledTargets: string[];
  connections: { total: number; active: number };
  inventory: { flows: number; scripts: number; queries: number; connections: number; schedules: number };
  /** False until some flow has finished a run: the dashboard shows the first steps instead of empty figures */
  hasFlowRuns: boolean;
}

export function buildDashboardSummary(options: { range: DashboardRange; tzOffsetMinutes: number; now?: number; onlyFailedRecent?: boolean }): DashboardSummary {
  const db = getDb();
  const now = options.now ?? Date.now();
  const window = rangeWindow(options.range, now, options.tzOffsetMinutes);
  const span = window.endMs - window.startMs;
  const count = (sql: string) => (db.prepare(sql).get() as { count: number } | undefined)?.count ?? 0;

  const failedByTrigger: Record<string, number> = {};
  const failed = db.prepare(`
    SELECT COALESCE(trigger_type, 'manual') AS trigger_type, COUNT(*) AS count
    FROM execution_logs
    WHERE ${COUNTED} AND status = 'error' AND started_at >= ? AND started_at < ?
    GROUP BY 1
  `).all(toDb(window.startMs), toDb(window.endMs)) as Array<{ trigger_type: string; count: number }>;
  for (const row of failed) failedByTrigger[row.trigger_type] = row.count;

  const activeSchedules = db.prepare('SELECT target_type, target_id FROM schedules WHERE is_active = 1').all() as Array<{ target_type: string; target_id: string }>;
  const scheduledTargets = new Set(activeSchedules.map(s => `${s.target_type}:${s.target_id}`));
  const totalSchedules = count('SELECT COUNT(*) AS count FROM schedules');
  const totalConnections = count('SELECT COUNT(*) AS count FROM connections');

  return {
    range: options.range,
    generatedAt: new Date(now).toISOString(),
    totals: totalsBetween(window.startMs, window.endMs),
    previous: totalsBetween(window.startMs - span, window.startMs),
    failedByTrigger,
    series: seriesFor(window, options.tzOffsetMinutes),
    recent: recentRuns(options.onlyFailedRecent === true),
    failing: failingTargets(scheduledTargets),
    missed: missedRuns(),
    upcoming: upcomingRuns(),
    schedules: { active: activeSchedules.length, paused: totalSchedules - activeSchedules.length },
    scheduledTargets: [...scheduledTargets],
    connections: { total: totalConnections, active: count('SELECT COUNT(*) AS count FROM connections WHERE is_active = 1') },
    inventory: {
      flows: count('SELECT COUNT(*) AS count FROM flows'),
      scripts: count('SELECT COUNT(*) AS count FROM scripts'),
      queries: count('SELECT COUNT(*) AS count FROM queries'),
      connections: totalConnections,
      schedules: totalSchedules,
    },
    hasFlowRuns: count("SELECT COUNT(*) AS count FROM execution_logs WHERE target_type = 'flow' AND status = 'completed'") > 0,
  };
}
