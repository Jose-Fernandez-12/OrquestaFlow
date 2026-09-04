import cron from 'node-cron';
import cronParser from 'cron-parser';
import { getDb } from '../db/database.js';
import { executeFlowEngine } from './executor.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const activeJobs: Record<string, cron.ScheduledTask> = {};

export async function initScheduler() {
  const db = getDb();
  const schedules = db.prepare('SELECT * FROM schedules WHERE is_active = 1').all() as any[];

  console.log(`[Scheduler] Initializing with ${schedules.length} active schedules...`);

  schedules.forEach(schedule => {
    try {
      startCronJob(schedule);
    } catch (e: any) {
      console.error(`[Scheduler] Failed to start schedule ${schedule.id}:`, e.message);
    }
  });
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
    console.log(`[Scheduler] Triggered job: ${schedule.name} (${schedule.target_type})`);
    const { v4: uuid } = require('uuid');
    const logId = uuid();
    const db = getDb();
    
    db.prepare(`
      INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(logId, schedule.target_type, schedule.target_id, schedule.id);

    const startTime = Date.now();
    try {
      let recordCount = 0;
      let exportedFiles: string[] = [];

      if (schedule.target_type === 'flow') {
        const context = await executeFlowEngine(schedule.target_id);
        
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

      db.prepare(`
        UPDATE execution_logs
        SET status = 'completed', duration_ms = ?, record_count = ?, result = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(duration, recordCount, resultJson, logId);
      
      // Update database status for the next run
      const nextNextRun = getNextRunAt(schedule.cron_expression);
      if (nextNextRun) {
        db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(nextNextRun, schedule.id);
      }
    } catch (err: any) {
      console.error(`[Scheduler] Error running job ${schedule.id}:`, err.message);
      const duration = Date.now() - startTime;
      db.prepare(`
        UPDATE execution_logs
        SET status = 'error', error_message = ?, duration_ms = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(err.message, duration, logId);
    }
  });

  activeJobs[schedule.id] = task;
  task.start();
}

async function runScriptById(scriptId: string) {
  const db = getDb();
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as any;
  if (!script) throw new Error('Script not found');

  const scriptPath = path.join(process.cwd(), 'scripts', script.file_path);
  if (!fs.existsSync(scriptPath)) throw new Error('Script file not found');

  return new Promise<void>((resolve, reject) => {
    const py = spawn('python', [scriptPath]);
    py.on('close', code => {
      if (code !== 0) reject(new Error(`Script exited with code ${code}`));
      else resolve();
    });
  });
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
