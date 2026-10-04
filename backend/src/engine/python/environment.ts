import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getSystemSettingsFromDb } from '../../routes/settings.js';
import { parseScriptMetadata, FALLBACK_STDLIB, type ScriptMetadata } from './pep723.js';

/**
 * Python environment managed by OrquestaFlow, entirely inside backend/.runtime (ignored by git):
 *
 *   bin/uv(.exe)  uv, downloaded by the setup unless one is already on the PATH
 *   python/       Python installations made by uv (UV_PYTHON_INSTALL_DIR)
 *   venv/         shared environment built from python-requirements.txt
 *   uv-cache/     package cache and the isolated environments of PEP 723 scripts
 *
 * Only Python scripts go through here; .js scripts keep running with Node.
 */

const isWindows = process.platform === 'win32';

export function runtimePaths(baseDir = process.env.ORQUESTA_RUNTIME_DIR || path.join(process.cwd(), '.runtime')) {
  const venv = path.join(baseDir, 'venv');
  return {
    base: baseDir,
    uv: path.join(baseDir, 'bin', isWindows ? 'uv.exe' : 'uv'),
    pythonInstalls: path.join(baseDir, 'python'),
    venv,
    venvPython: isWindows ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python'),
    cache: path.join(baseDir, 'uv-cache'),
    requirements: process.env.ORQUESTA_PYTHON_REQUIREMENTS || path.join(process.cwd(), 'python-requirements.txt'),
  };
}

/** Variables passed to every uv call and every Python process */
export function uvEnv(paths = runtimePaths()): Record<string, string> {
  return {
    UV_CACHE_DIR: paths.cache,
    UV_PYTHON_INSTALL_DIR: paths.pythonInstalls,
    UV_PYTHON_PREFERENCE: 'managed',
    UV_NO_PROGRESS: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

export function configuredPythonVersion(): string {
  const version = String(getSystemSettingsFromDb().python_version || '').trim();
  return /^3\.\d{1,2}$/.test(version) ? version : '3.12';
}

export interface PythonEnvStatus {
  uv: { path: string; version: string; managed: boolean } | null;
  venv: { python: string; version: string } | null;
  system: { command: string; args: string[]; version: string } | null;
  packages: Array<{ name: string; version: string }>;
  stdlib: string[] | null;
  checkedAt: number;
}

interface CommandResult { code: number | null; stdout: string; stderr: string }

export function runCommand(command: string, args: string[], env: Record<string, string> = {}, timeoutMs = 20000): Promise<CommandResult> {
  return new Promise(resolve => {
    execFile(command, args, { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err: any, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
  });
}

const versionOf = (r: CommandResult) => (r.stdout + r.stderr).match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] || '';

// "python --version" from the Microsoft Store alias exits with 9009 and a localized message
async function findSystemPython(): Promise<PythonEnvStatus['system']> {
  const candidates: Array<[string, string[]]> = isWindows
    ? [['python', []], ['py', ['-3']]]
    : [['python3', []], ['python', []]];
  for (const [command, args] of candidates) {
    const r = await runCommand(command, [...args, '--version'], {}, 10000);
    if (r.code === 0 && /Python 3\./.test(r.stdout + r.stderr)) return { command, args, version: versionOf(r) };
  }
  return null;
}

async function findUv(paths: ReturnType<typeof runtimePaths>): Promise<PythonEnvStatus['uv']> {
  if (fs.existsSync(paths.uv)) {
    const r = await runCommand(paths.uv, ['--version']);
    if (r.code === 0) return { path: paths.uv, version: versionOf(r), managed: true };
  }
  const r = await runCommand('uv', ['--version']);
  return r.code === 0 ? { path: 'uv', version: versionOf(r), managed: false } : null;
}

let cached: PythonEnvStatus | null = null;
let refreshing: Promise<PythonEnvStatus> | null = null;

export function getEnvironmentStatus(): PythonEnvStatus | null {
  return cached;
}

/** Inspects uv, the shared venv and the system Python; the result is cached for resolveInterpreter */
export function refreshEnvironment(): Promise<PythonEnvStatus> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const paths = runtimePaths();
    const [uv, system] = await Promise.all([findUv(paths), findSystemPython()]);

    let venv: PythonEnvStatus['venv'] = null;
    let packages: PythonEnvStatus['packages'] = [];
    let stdlib: string[] | null = null;
    if (fs.existsSync(paths.venvPython)) {
      const v = await runCommand(paths.venvPython, ['--version']);
      if (v.code === 0) {
        venv = { python: paths.venvPython, version: versionOf(v) };
        const s = await runCommand(paths.venvPython, ['-c', 'import sys, json; print(json.dumps(sorted(sys.stdlib_module_names)))']);
        try { stdlib = JSON.parse(s.stdout); } catch { /* older Python without stdlib_module_names */ }
        if (uv) {
          const list = await runCommand(uv.path, ['pip', 'list', '--format', 'json', '--python', paths.venvPython], uvEnv(paths));
          try { packages = JSON.parse(list.stdout).map((p: any) => ({ name: String(p.name), version: String(p.version) })); } catch { /* empty */ }
        }
      }
    }
    cached = { uv, venv, system, packages, stdlib, checkedAt: Date.now() };
    return cached;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function isStdlibModule(name: string, status = cached): boolean {
  return status?.stdlib ? status.stdlib.includes(name) : FALLBACK_STDLIB.has(name);
}

export class PythonNotReadyError extends Error {
  constructor() {
    super('Python no está preparado. Ve a Configuración → Entorno Python o ejecuta «npm run python:setup».');
    this.name = 'PythonNotReadyError';
  }
}

export type InterpreterMode = 'aislado' | 'manual' | 'compartido' | 'sistema';

export interface ResolvedInterpreter {
  command: string;
  args: string[];
  env: Record<string, string>;
  mode: InterpreterMode;
  metadata: ScriptMetadata | null;
  /** Something the user should know about the choice, shown in the console before the output */
  notice?: string;
}

/** Before the first refresh only the files on disk are known; the system Python is assumed as before */
function statusFromDisk(paths: ReturnType<typeof runtimePaths>): PythonEnvStatus {
  return {
    uv: fs.existsSync(paths.uv) ? { path: paths.uv, version: '', managed: true } : null,
    venv: fs.existsSync(paths.venvPython) ? { python: paths.venvPython, version: '' } : null,
    system: { command: isWindows ? 'python' : 'python3', args: [], version: '' },
    packages: [],
    stdlib: null,
    checkedAt: 0,
  };
}

/**
 * Picks how to run a Python script:
 *   1. it declares dependencies (PEP 723) and uv is available → uv run --script (isolated)
 *   2. PYTHON_PATH is set → that interpreter
 *   3. the shared venv exists → its python
 *   4. a system Python 3 → that one
 * and otherwise throws PythonNotReadyError.
 */
export function resolveInterpreter(
  scriptPath: string,
  code: string,
  options: { status?: PythonEnvStatus | null; env?: NodeJS.ProcessEnv; pythonVersion?: string; paths?: ReturnType<typeof runtimePaths> } = {}
): ResolvedInterpreter {
  const paths = options.paths || runtimePaths();
  const status = options.status ?? cached ?? statusFromDisk(paths);
  const pythonPath = (options.env ?? process.env).PYTHON_PATH?.trim();
  const env = uvEnv(paths);

  const parsed = parseScriptMetadata(code);
  if (!parsed.ok) throw new Error(parsed.error);
  const metadata = parsed.metadata;

  if (metadata && status.uv) {
    // requires-python in the script wins over the configured version
    const python = pythonPath || (metadata.requiresPython ? null : options.pythonVersion || configuredPythonVersion());
    return {
      command: status.uv.path,
      args: ['run', '--script', '--quiet', ...(python ? ['--python', python] : []), scriptPath],
      env,
      mode: 'aislado',
      metadata,
      notice: 'Preparando las dependencias del script (la primera vez puede tardar)…',
    };
  }
  const notice = metadata ? 'El script declara dependencias pero uv no está disponible: se ejecuta sin instalarlas. Prepara el entorno en Configuración → Entorno Python.' : undefined;

  if (pythonPath) return { command: pythonPath, args: ['-u', scriptPath], env, mode: 'manual', metadata, notice };
  if (status.venv) return { command: status.venv.python, args: ['-u', scriptPath], env, mode: 'compartido', metadata, notice };
  if (status.system) return { command: status.system.command, args: [...status.system.args, '-u', scriptPath], env, mode: 'sistema', metadata, notice };
  throw new PythonNotReadyError();
}
