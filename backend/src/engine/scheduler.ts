import cron from 'node-cron';
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

function startCronJob(schedule: any) {
  if (activeJobs[schedule.id]) {
    activeJobs[schedule.id].stop();
    delete activeJobs[schedule.id];
  }

  const task = cron.schedule(schedule.cron_expression, async () => {
    console.log(`[Scheduler] Triggered job: ${schedule.name} (${schedule.target_type})`);
    
    try {
      if (schedule.target_type === 'flow') {
        await executeFlowEngine(schedule.target_id);
      } else if (schedule.target_type === 'script') {
        await runScriptById(schedule.target_id);
      }
      
      // Update database status
      const db = getDb();
      db.prepare("UPDATE schedules SET next_run_at = datetime('now', '+1 day') WHERE id = ?").run(schedule.id);
    } catch (err: any) {
      console.error(`[Scheduler] Error running job ${schedule.id}:`, err.message);
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
