import { getDb } from '../db/database.js';

const DAY_MS = 86_400_000;
const INTERVAL_MS = 6 * 3_600_000;
// Below this many deleted rows the file is not worth compacting
const VACUUM_THRESHOLD = 200;

/** Epoch ms → the "YYYY-MM-DD HH:MM:SS" UTC text that datetime('now') stores */
const toDb = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function retentionDays(): number {
  const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'execution_log_retention_days'").get() as { value: string } | undefined;
  const days = Number(row?.value ?? DEFAULT_RETENTION_DAYS);
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_RETENTION_DAYS;
}

// Nothing is deleted until the user chooses a period in Configuración → General (90 days is suggested)
export const DEFAULT_RETENTION_DAYS = 0;

/**
 * Deletes the execution history older than `days` (0 keeps everything). The latest run of each flow,
 * script and query is always kept, so their last result and error stay visible however old they are.
 * Returns how many runs were deleted.
 */
export function pruneExecutionLogs(days: number = retentionDays(), now: number = Date.now()): number {
  if (days <= 0) return 0;
  const db = getDb();
  const where = `
    status != 'running'
    AND started_at < ?
    AND rowid NOT IN (SELECT MAX(rowid) FROM execution_logs GROUP BY target_type, target_id)
  `;
  const cutoff = toDb(now - days * DAY_MS);
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM execution_logs WHERE ${where}`).get(cutoff) as { count: number };
  if (count === 0) return 0;

  db.prepare(`DELETE FROM execution_logs WHERE ${where}`).run(cutoff);
  if (count >= VACUUM_THRESHOLD) db.exec('VACUUM');
  return count;
}

let timer: NodeJS.Timeout | null = null;

function runSafely() {
  try {
    const deleted = pruneExecutionLogs();
    if (deleted > 0) console.log(`[Retention] Removed ${deleted} run(s) older than ${retentionDays()} days from the history`);
  } catch (err: any) {
    console.error('[Retention] Could not clean the execution history:', err?.message || err);
  }
}

/** Cleans the history now and every few hours while the server runs */
export function startRetention(): void {
  runSafely();
  if (timer) clearInterval(timer);
  timer = setInterval(runSafely, INTERVAL_MS);
  timer.unref();
}

/** After the setting changes, so a shorter period applies at once */
export function applyRetentionNow(): void {
  runSafely();
}
