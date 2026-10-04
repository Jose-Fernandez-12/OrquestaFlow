import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { getSystemSettingsFromDb } from '../routes/settings.js';
import { getIo } from './socket.js';

/**
 * Runs uploaded scripts as child processes with their stdin open, so a script that asks for input
 * (Python input(), Node readline) can be answered from the UI. Output is pushed live over Socket.IO
 * ('script-output' / 'script-exit') and buffered, so a console opened mid-run can catch up.
 */

export type ScriptStream = 'stdout' | 'stderr' | 'stdin' | 'system';
export type ScriptRunStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'timeout';

export interface ScriptOutputChunk { stream: ScriptStream; text: string; ts: number }

export interface ScriptRun {
  runId: string;
  scriptId: string;
  logId: string | null;
  args: string[];
  status: ScriptRunStatus;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  output: ScriptOutputChunk[];
  done: Promise<ScriptRun>;
}

interface ActiveRun extends ScriptRun {
  child: ChildProcessWithoutNullStreams;
  timer: NodeJS.Timeout | null;
  timeoutMs: number;
  outputBytes: number;
}

const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_LOGGED_CHARS = 200_000;
const FINISHED_RUN_TTL_MS = 10 * 60 * 1000;
const MAX_CONTENT_BYTES = 1024 * 1024;

const runs = new Map<string, ActiveRun>();

/** Script files live in uploads/; older ones may sit in the server root or scripts/ */
export function resolveScriptPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.join(process.cwd(), 'uploads', filePath),
    path.join(process.cwd(), filePath),
    path.join(process.cwd(), 'scripts', filePath),
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

export const scriptLanguage = (filePath: string) => (/\.(c|m)?js$/i.test(filePath) ? 'javascript' : 'python');

export function readScriptContent(filePath: string): { content: string; truncated: boolean; fileName: string; language: string } {
  const fullPath = resolveScriptPath(filePath);
  if (!fs.existsSync(fullPath)) throw new Error(`No se encontró el archivo del script: ${filePath}`);
  const buffer = fs.readFileSync(fullPath);
  const truncated = buffer.length > MAX_CONTENT_BYTES;
  return {
    content: buffer.subarray(0, MAX_CONTENT_BYTES).toString('utf-8'),
    truncated,
    fileName: path.basename(fullPath).replace(/^[0-9a-f-]{36}_/, ''),
    language: scriptLanguage(fullPath),
  };
}

// Python buffers stdout when it is not a terminal: -u makes prompts show up before input() blocks
function commandFor(fullPath: string): { command: string; args: string[] } {
  if (scriptLanguage(fullPath) === 'javascript') return { command: process.execPath, args: [fullPath] };
  return { command: process.env.PYTHON_PATH || 'python', args: ['-u', fullPath] };
}

function emit(event: string, payload: Record<string, unknown>) {
  try {
    getIo().emit(event, payload);
  } catch {
    // Socket.IO not initialised (tests, scripts): the run still completes and is buffered
  }
}

function push(run: ActiveRun, stream: ScriptStream, text: string) {
  if (!text) return;
  const chunk = { stream, text, ts: Date.now() };
  if (run.outputBytes < MAX_BUFFERED_BYTES) {
    run.output.push(chunk);
    run.outputBytes += text.length;
    if (run.outputBytes >= MAX_BUFFERED_BYTES) {
      run.output.push({ stream: 'system', text: '\n[Salida truncada en el historial: supera 1 MB]\n', ts: Date.now() });
    }
  }
  emit('script-output', { runId: run.runId, scriptId: run.scriptId, ...chunk });
}

function armTimeout(run: ActiveRun) {
  if (run.timer) clearTimeout(run.timer);
  run.timer = setTimeout(() => {
    if (run.status !== 'running') return;
    run.status = 'timeout';
    push(run, 'system', `\n[Detenido: sin terminar tras ${Math.round(run.timeoutMs / 1000)} s sin actividad]\n`);
    run.child.kill();
  }, run.timeoutMs);
}

const joinStream = (run: ScriptRun, stream: ScriptStream) =>
  run.output.filter(c => c.stream === stream).map(c => c.text).join('').slice(-MAX_LOGGED_CHARS);

export function startScriptRun(
  script: { id: string; file_path: string },
  options: { args?: string[]; runId?: string; interactive?: boolean; log?: boolean } = {}
): ScriptRun {
  const fullPath = resolveScriptPath(script.file_path);
  if (!fs.existsSync(fullPath)) throw new Error(`No se encontró el archivo del script: ${script.file_path}`);

  const runId = options.runId && !runs.has(options.runId) ? options.runId : uuid();
  const args = (options.args || []).map(String);
  const { command, args: baseArgs } = commandFor(fullPath);
  const db = getDb();

  let logId: string | null = null;
  if (options.log !== false) {
    logId = uuid();
    db.prepare(`INSERT INTO execution_logs (id, target_type, target_id, status, trigger_type) VALUES (?, 'script', ?, 'running', ?)`)
      .run(logId, script.id, options.interactive ? 'manual' : 'api');
  }

  const child = spawn(command, [...baseArgs, ...args], {
    cwd: path.dirname(fullPath),
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });

  let resolveDone!: (run: ScriptRun) => void;
  const run: ActiveRun = {
    runId,
    scriptId: script.id,
    logId,
    args,
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    finishedAt: null,
    output: [],
    done: new Promise(resolve => { resolveDone = resolve; }),
    child,
    timer: null,
    timeoutMs: Math.max(1, Number(getSystemSettingsFromDb().script_timeout_seconds) || 60) * 1000,
    outputBytes: 0,
  };
  runs.set(runId, run);

  // Non-interactive runs (scheduler, API) get EOF right away, so input() fails instead of hanging
  if (!options.interactive) child.stdin.end();
  child.stdin.on('error', () => { /* process exited while writing */ });

  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (text: string) => { push(run, 'stdout', text); armTimeout(run); });
  child.stderr.on('data', (text: string) => { push(run, 'stderr', text); armTimeout(run); });
  armTimeout(run);

  let finished = false;
  const finish = (code: number | null, spawnError?: Error) => {
    if (finished) return;
    finished = true;
    if (run.timer) clearTimeout(run.timer);
    run.exitCode = code;
    run.finishedAt = Date.now();
    if (spawnError) {
      run.status = 'error';
      push(run, 'system', `No se pudo iniciar el intérprete (${spawnError.message}). Configura PYTHON_PATH en el servidor.\n`);
    } else if (run.status === 'running') {
      run.status = code === 0 ? 'completed' : 'error';
    }
    // 9009: Windows could not find the interpreter (often the Microsoft Store "python" alias)
    if (code === 9009 && process.platform === 'win32') {
      push(run, 'system', '\nPython no está instalado o no está en el PATH del servidor. Instálalo o configura PYTHON_PATH con la ruta a python.exe.\n');
    }
    const durationMs = run.finishedAt - run.startedAt;

    if (logId) {
      const logStatus = run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'error';
      const errorMessage = run.status === 'completed' ? null
        : run.status === 'cancelled' ? 'Detenido por el usuario'
        : run.status === 'timeout' ? `Superó el tiempo límite de ${run.timeoutMs / 1000} s sin actividad`
        : spawnError ? spawnError.message
        : `El script terminó con código ${code}`;
      db.prepare(`
        UPDATE execution_logs
        SET status = ?, duration_ms = ?, completed_at = datetime('now'), result = ?, error_message = ?
        WHERE id = ?
      `).run(logStatus, durationMs, JSON.stringify({ stdout: joinStream(run, 'stdout'), stderr: joinStream(run, 'stderr'), exitCode: code, args }), errorMessage, logId);
      db.prepare("UPDATE scripts SET last_run_at = datetime('now'), last_run_status = ? WHERE id = ?").run(logStatus, script.id);
    }

    emit('script-exit', { runId, scriptId: script.id, status: run.status, exitCode: code, durationMs });
    setTimeout(() => runs.delete(runId), FINISHED_RUN_TTL_MS).unref();
    resolveDone(run);
  };

  child.on('error', err => finish(null, err));
  child.on('close', code => finish(code));

  return run;
}

/** Sends one line to the script's stdin (the line is echoed in the console as 'stdin') */
export function sendScriptInput(runId: string, text: string, eof = false): void {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') throw new Error('El script ya no se está ejecutando.');
  if (run.child.stdin.writableEnded) throw new Error('La entrada del script ya se cerró.');
  if (text !== '' || !eof) {
    run.child.stdin.write(`${text}\n`);
    push(run, 'stdin', `${text}\n`);
  }
  if (eof) {
    run.child.stdin.end();
    push(run, 'system', '[Fin de la entrada]\n');
  }
  armTimeout(run);
}

export function stopScriptRun(runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return false;
  run.status = 'cancelled';
  push(run, 'system', '\n[Detenido por el usuario]\n');
  run.child.kill();
  return true;
}

export function getScriptRun(runId: string): ScriptRun | undefined {
  return runs.get(runId);
}

/** The most recent run of a script still in memory (running or recently finished) */
export function getLatestScriptRun(scriptId: string): ScriptRun | undefined {
  let latest: ScriptRun | undefined;
  for (const run of runs.values()) {
    if (run.scriptId === scriptId && (!latest || run.startedAt > latest.startedAt)) latest = run;
  }
  return latest;
}

export function serializeRun(run: ScriptRun) {
  const { runId, scriptId, logId, args, status, exitCode, startedAt, finishedAt, output } = run;
  return { runId, scriptId, logId, args, status, exitCode, startedAt, finishedAt, output };
}

export function stopAllScriptRuns(): void {
  for (const run of runs.values()) {
    if (run.status === 'running') {
      run.status = 'cancelled';
      run.child.kill();
    }
  }
}
