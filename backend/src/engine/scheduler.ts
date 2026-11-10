import cron from 'node-cron';
import cronParser from 'cron-parser';
import { getDb } from '../db/database.js';
import { executeFlowEngine, activeFlowExecutions } from './executor.js';
import { ExecutionTracer, startExecutionLog, finishExecutionLog, isCancellationError } from './executionLog.js';
import { startScriptRun } from './scriptRunner.js';

const activeJobs: Record<string, cron.ScheduledTask> = {};
const runningJobIds = new Set<string>();

export const SKIPPED_OVERLAP_MESSAGE = 'Omitida: la ejecución anterior seguía en curso';

export function stopAllSchedulerJobs(): void {
  for (const id of Object.keys(activeJobs)) {
    try {
      activeJobs[id].stop();
    } catch {}
    delete activeJobs[id];
  }
  runningJobIds.clear();
  console.log('[Scheduler] All active jobs stopped.');
}

export async function initScheduler() {
  const db = getDb();
  const schedules = db.prepare('SELECT * FROM schedules WHERE is_active = 1').all() as any[];

  console.log(`[Scheduler] Initializing with ${schedules.length} active schedules...`);

  // Must run before the jobs start: starting a job overwrites next_run_at
  const missed = detectMissedRuns();
  if (missed.length > 0) console.warn(`[Scheduler] ${missed.length} schedule(s) missed a run while the server was off`);

  schedules.forEach(schedule => {
    try {
      startCronJob(schedule);
    } catch (e: any) {
      console.error(`[Scheduler] Failed to start schedule ${schedule.id}:`, e.message);
    }
  });
}

const MISSED_GRACE_MS = 60_000;

/**
 * A stored next_run_at in the past means the server was not running at that time.
 * Remembers it in last_missed_at so the dashboard can say so; returns the ids of the affected schedules.
 */
export function detectMissedRuns(now: number = Date.now()): string[] {
  const db = getDb();
  const schedules = db.prepare('SELECT id, next_run_at FROM schedules WHERE is_active = 1 AND next_run_at IS NOT NULL').all() as Array<{ id: string; next_run_at: string }>;
  const missed: string[] = [];

  for (const schedule of schedules) {
    const due = new Date(schedule.next_run_at).getTime();
    if (isNaN(due) || due > now - MISSED_GRACE_MS) continue;

    // A run that did happen around that time means next_run_at was simply left stale
    const ran = db.prepare(`
      SELECT 1 AS found FROM execution_logs
      WHERE schedule_id = ? AND started_at >= datetime(?, '-1 minute') LIMIT 1
    `).get(schedule.id, schedule.next_run_at);
    if (ran) continue;

    db.prepare('UPDATE schedules SET last_missed_at = ? WHERE id = ?').run(schedule.next_run_at, schedule.id);
    missed.push(schedule.id);
  }
  return missed;
}

function getNextRunAt(cronExpression: string): string | null {
  try {
    const parser = require('cron-parser');
    const interval = parser.CronExpressionParser.parse(cronExpression);
    return interval.next().toISOString();
  } catch (err: any) {
    console.error('Failed to parse cron:', err.message);
    return null;
  }
}

function startCronJob(schedule: any) {
  if (activeJobs[schedule.id]) {
    activeJobs[schedule.id].stop();
    delete activeJobs[schedule.id];
  }

  // Update initial next_run_at when starting the job
  const nextRun = getNextRunAt(schedule.cron_expression);
  if (nextRun) {
    getDb().prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(nextRun, schedule.id);
  }

  const task = cron.schedule(schedule.cron_expression, async () => {
    if (runningJobIds.has(schedule.id)) {
      console.warn(`[Scheduler] Skipping schedule ${schedule.id} (${schedule.name}): previous execution is still running`);
      getDb().prepare(`
        INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status, trigger_type, error_message, duration_ms, completed_at)
        VALUES (?, ?, ?, ?, 'cancelled', 'schedule', ?, 0, datetime('now'))
      `).run(require('uuid').v4(), schedule.target_type, schedule.target_id, schedule.id, SKIPPED_OVERLAP_MESSAGE);
      return;
    }

    runningJobIds.add(schedule.id);
    console.log(`[Scheduler] Triggered job: ${schedule.name} (${schedule.target_type})`);
    const { v4: uuid } = require('uuid');
    const db = getDb();
    const tracer = new ExecutionTracer();
    let logId: string;
    if (schedule.target_type === 'flow') {
      logId = startExecutionLog(schedule.target_id, 'schedule', schedule.id);
    } else {
      logId = uuid();
      db.prepare(`
        INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status, trigger_type)
        VALUES (?, ?, ?, ?, 'running', 'schedule')
      `).run(logId, schedule.target_type, schedule.target_id, schedule.id);
    }

    const startTime = Date.now();
    try {
      let recordCount = 0;
      let exportedFiles: string[] = [];

      if (schedule.target_type === 'flow') {
        const context = await executeFlowEngine(schedule.target_id, undefined, { tracer });
        
        const exportResults = Object.values(context).filter((v: any) => v?.filePath && v?.success);
        exportResults.forEach((exportResult: any) => {
          const fileName = exportResult.filePath.split(/[/\\]/).pop();
          exportedFiles.push(fileName);
          recordCount += (exportResult.records || 0);

          try {
            const { getIo } = require('./socket.js');
            const io = getIo();
            io.emit('flow-export-ready', {
              flowId: schedule.target_id,
              source: 'scheduler',
              fileName,
              downloadUrl: `/api/files/${fileName}`,
              records: exportResult.records,
              format: exportResult.format,
              filePath: exportResult.filePath
            });
          } catch (e) {}
        });
      } else if (schedule.target_type === 'script') {
        await runScriptById(schedule.target_id);
      }
      
      const duration = Date.now() - startTime;
      const resultJson = exportedFiles.length > 0 ? JSON.stringify({ exportedFiles }) : null;

      finishExecutionLog(logId, {
        status: 'completed',
        durationMs: duration,
        recordCount,
        result: resultJson ? JSON.parse(resultJson) : null,
        trace: schedule.target_type === 'flow' ? tracer.toJSON('completed') : undefined
      });
    } catch (err: any) {
      console.error(`[Scheduler] Error running job ${schedule.id}:`, err.message);
      const duration = Date.now() - startTime;
      const status = schedule.target_type === 'flow' && isCancellationError(err, activeFlowExecutions.get(schedule.target_id)?.status) ? 'cancelled' : 'error';
      finishExecutionLog(logId, {
        status,
        durationMs: duration,
        errorMessage: err.message,
        trace: schedule.target_type === 'flow' ? tracer.toJSON(status) : undefined
      });
    } finally {
      runningJobIds.delete(schedule.id);
      // Also after a failed run; otherwise the schedule keeps showing a next run in the past
      const nextNextRun = getNextRunAt(schedule.cron_expression);
      if (nextNextRun) {
        db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(nextNextRun, schedule.id);
      }
    }
  });

  activeJobs[schedule.id] = task;
  task.start();
}

async function runScriptById(scriptId: string) {
  const db = getDb();
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!script) throw new Error('Script not found');

  // The schedule writes its own execution log; the run is still visible live in the Scripts console
  const run = await startScriptRun(script, { log: false }).done;
  if (run.status !== 'completed') {
    const stderr = run.output.filter(c => c.stream === 'stderr' || c.stream === 'system').map(c => c.text).join('').trim();
    throw new Error(`El script terminó con código ${run.exitCode}${stderr ? `: ${stderr.slice(-500)}` : ''}`);
  }
}

// Reschedules or stops a job dynamically
export function updateJobSchedule(scheduleId: string) {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;

  if (activeJobs[scheduleId]) {
    activeJobs[scheduleId].stop();
    delete activeJobs[scheduleId];
  }

  if (schedule && schedule.is_active === 1) {
    startCronJob(schedule);
  }
}
