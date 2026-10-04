import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { v4 as uuid } from 'uuid';
import { getIo } from '../socket.js';
import { runtimePaths, uvEnv, configuredPythonVersion, refreshEnvironment, type PythonEnvStatus } from './environment.js';
import { requirementName } from './pep723.js';

/**
 * Prepares the managed Python environment (uv → Python → shared venv → packages) and edits
 * python-requirements.txt. Every operation runs as a job whose output is streamed over Socket.IO
 * ('python-env-output' / 'python-env-exit') and buffered, like script runs.
 */

export const UV_VERSION = '0.12.23';

export type SetupStepId = 'download-uv' | 'install-python' | 'create-venv' | 'install-packages';
export interface SetupStep { id: SetupStepId; label: string }

/** Which steps are still needed, given what is installed (pure: no disk or network access) */
export function buildSetupSteps(
  status: Pick<PythonEnvStatus, 'uv' | 'venv'>,
  options: { pythonVersion: string; hasRequirements: boolean }
): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!status.uv) steps.push({ id: 'download-uv', label: `Descargar uv ${UV_VERSION}` });
  const venvMatches = !!status.venv && (status.venv.version === options.pythonVersion || status.venv.version.startsWith(`${options.pythonVersion}.`));
  if (!venvMatches) {
    steps.push({ id: 'install-python', label: `Instalar Python ${options.pythonVersion}` });
    steps.push({ id: 'create-venv', label: status.venv ? `Recrear el entorno compartido con Python ${options.pythonVersion}` : 'Crear el entorno compartido' });
  }
  if (options.hasRequirements) steps.push({ id: 'install-packages', label: 'Instalar los paquetes de python-requirements.txt' });
  return steps;
}

// ── uv download ──

export function uvAssetName(platform = process.platform, arch = process.arch): string {
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  if (!cpu) throw new Error(`Arquitectura no soportada para descargar uv: ${arch}`);
  if (platform === 'win32') return `uv-${cpu}-pc-windows-msvc.zip`;
  if (platform === 'darwin') return `uv-${cpu}-apple-darwin.tar.gz`;
  if (platform === 'linux') return `uv-${cpu}-unknown-linux-gnu.tar.gz`;
  throw new Error(`Sistema operativo no soportado para descargar uv: ${platform}`);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadUv(log: (text: string) => void): Promise<void> {
  const paths = runtimePaths();
  const asset = uvAssetName();
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;
  log(`Descargando ${base}\n`);
  const [archive, checksumFile] = await Promise.all([download(base), download(`${base}.sha256`)]);

  const expected = checksumFile.toString('utf-8').trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (expected !== actual) throw new Error(`La suma de verificación de ${asset} no coincide: el archivo descargado no es fiable.`);
  log(`Suma SHA-256 verificada (${actual.slice(0, 12)}…)\n`);

  fs.mkdirSync(path.dirname(paths.uv), { recursive: true });
  const exeName = path.basename(paths.uv);
  if (asset.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(archive);
    const entry = Object.values(zip.files).find(f => !f.dir && path.basename(f.name) === exeName);
    if (!entry) throw new Error(`${asset} no contiene ${exeName}`);
    fs.writeFileSync(paths.uv, await entry.async('nodebuffer'));
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orquesta-uv-'));
    try {
      const tarball = path.join(tmp, asset);
      fs.writeFileSync(tarball, archive);
      const code = await runStreaming('tar', ['-xzf', tarball, '-C', tmp], {}, () => {});
      if (code !== 0) throw new Error(`No se pudo descomprimir ${asset} (tar terminó con código ${code})`);
      fs.copyFileSync(path.join(tmp, asset.replace(/\.tar\.gz$/, ''), exeName), paths.uv);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  fs.chmodSync(paths.uv, 0o755);
  log(`uv instalado en ${paths.uv}\n`);
}

// ── requirements file ──

export interface RequirementEntry { name: string; spec: string; line: number }

export function readRequirements(file = runtimePaths().requirements): { text: string; entries: RequirementEntry[] } {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const entries: RequirementEntry[] = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const spec = raw.replace(/#.*$/, '').trim();
    // Options (-r, --index-url…) are kept in the file but are not packages
    if (spec && !spec.startsWith('-')) entries.push({ name: requirementName(spec), spec, line });
  });
  return { text, entries };
}

// A requirement, never a pip option: "--index-url evil" or "-r other.txt" are rejected
const SPEC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,\s-]+\])?\s*([<>=!~]=?\s*[A-Za-z0-9.*+!_-]+\s*(,\s*[<>=!~]=?\s*[A-Za-z0-9.*+!_-]+\s*)*)?$/;

export function validateRequirementSpec(spec: string): string {
  const clean = String(spec || '').trim();
  if (!SPEC_RE.test(clean)) throw new Error(`«${clean}» no es un paquete válido. Ejemplos: pandas, pandas==2.2.3, requests>=2.31`);
  return clean;
}

/** Returns the new file text with the package added (or its line replaced if already listed) */
export function withRequirement(text: string, spec: string): string {
  const name = requirementName(spec);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop(); // the final newline is added back below
  const idx = lines.findIndex(l => { const s = l.replace(/#.*$/, '').trim(); return s && !s.startsWith('-') && requirementName(s) === name; });
  if (idx >= 0) lines[idx] = spec;
  else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(spec);
  }
  return lines.join(eol) + eol;
}

export function withoutRequirement(text: string, name: string): string {
  const target = requirementName(name);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(/\r?\n/)
    .filter(l => { const s = l.replace(/#.*$/, '').trim(); return !s || s.startsWith('-') || requirementName(s) !== target; })
    .join(eol);
}

// ── jobs ──

export type EnvJobKind = 'setup' | 'add-package' | 'remove-package' | 'prepare-script';
export interface EnvJob {
  jobId: string;
  kind: EnvJobKind;
  status: 'running' | 'completed' | 'error';
  output: Array<{ stream: 'stdout' | 'stderr' | 'system'; text: string; ts: number }>;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Script being prepared (prepare-script jobs) */
  scriptId?: string;
}

const jobs = new Map<string, EnvJob>();
let activeJob: EnvJob | null = null;

export const getEnvJob = (jobId: string) => jobs.get(jobId);
export const getActiveEnvJob = () => activeJob;

function emit(event: string, payload: Record<string, unknown>) {
  try { getIo().emit(event, payload); } catch { /* CLI: no Socket.IO */ }
}

function runStreaming(command: string, args: string[], env: Record<string, string>, onOutput: (stream: 'stdout' | 'stderr', text: string) => void): Promise<number | null> {
  return new Promise(resolve => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true });
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (t: string) => onOutput('stdout', t));
    child.stderr.on('data', (t: string) => onOutput('stderr', t));
    child.on('error', err => { onOutput('stderr', `${err.message}\n`); resolve(null); });
    child.on('close', code => resolve(code));
  });
}

/**
 * Starts a job. Only one environment job runs at a time: a second setup returns the running one,
 * anything else is refused. `onOutput` lets the CLI print the output as well.
 */
export function startEnvJob(
  kind: EnvJobKind,
  work: (ctx: { log: (text: string) => void; run: (command: string, args: string[]) => Promise<void> }) => Promise<void>,
  onOutput?: (stream: string, text: string) => void,
  scriptId?: string
): EnvJob {
  if (activeJob) {
    if (kind === 'setup' && activeJob.kind === 'setup') return activeJob;
    throw new Error('Hay otra operación del entorno Python en curso. Espera a que termine.');
  }
  const job: EnvJob = { jobId: uuid(), kind, status: 'running', output: [], startedAt: Date.now(), finishedAt: null, error: null, ...(scriptId ? { scriptId } : {}) };
  jobs.set(job.jobId, job);
  activeJob = job;

  const push = (stream: EnvJob['output'][number]['stream'], text: string) => {
    if (!text) return;
    const chunk = { stream, text, ts: Date.now() };
    job.output.push(chunk);
    emit('python-env-output', { jobId: job.jobId, ...chunk });
    onOutput?.(stream, text);
  };
  const ctx = {
    log: (text: string) => push('system', text),
    run: async (command: string, args: string[]) => {
      push('system', `$ ${path.basename(command)} ${args.join(' ')}\n`);
      const code = await runStreaming(command, args, uvEnv(), push);
      if (code !== 0) throw new Error(`«${path.basename(command)} ${args[0]}» terminó con código ${code}`);
    },
  };

  void (async () => {
    try {
      await work(ctx);
      job.status = 'completed';
    } catch (err: any) {
      job.status = 'error';
      job.error = err?.message || String(err);
      push('system', `\nError: ${job.error}\n`);
    } finally {
      job.finishedAt = Date.now();
      activeJob = null;
      await refreshEnvironment().catch(() => {});
      emit('python-env-exit', { jobId: job.jobId, kind, status: job.status, error: job.error, scriptId });
      setTimeout(() => jobs.delete(job.jobId), 30 * 60 * 1000).unref();
    }
  })();
  return job;
}

/** Waits for a job to finish (used by the CLI) */
export function waitForJob(job: EnvJob): Promise<EnvJob> {
  return new Promise(resolve => {
    const tick = () => (job.status === 'running' ? setTimeout(tick, 200) : resolve(job));
    tick();
  });
}

export function runPythonSetup(onOutput?: (stream: string, text: string) => void): EnvJob {
  return startEnvJob('setup', async ({ log, run }) => {
    const paths = runtimePaths();
    const pythonVersion = configuredPythonVersion();
    let status = await refreshEnvironment();
    const steps = buildSetupSteps(status, { pythonVersion, hasRequirements: readRequirements().entries.length > 0 });
    if (steps.length === 0) {
      log('El entorno ya está al día.\n');
      return;
    }
    log(`Pasos: ${steps.map(s => s.label).join(' → ')}\n`);

    for (const step of steps) {
      log(`\n▸ ${step.label}\n`);
      if (step.id === 'download-uv') {
        await downloadUv(log);
        status = await refreshEnvironment();
        if (!status.uv) throw new Error('uv se descargó pero no responde a «uv --version».');
      } else if (step.id === 'install-python') {
        await run(status.uv!.path, ['python', 'install', pythonVersion]);
      } else if (step.id === 'create-venv') {
        await run(status.uv!.path, ['venv', paths.venv, '--python', pythonVersion, '--clear']);
      } else if (step.id === 'install-packages') {
        await run(status.uv!.path, ['pip', 'install', '-r', paths.requirements, '--python', paths.venvPython]);
      }
    }
    log('\nEntorno Python listo.\n');
  }, onOutput);
}

function requireReadyEnvironment(status: PythonEnvStatus | null): asserts status is PythonEnvStatus & { uv: NonNullable<PythonEnvStatus['uv']> } {
  if (!status?.uv || !status.venv) throw new Error('Primero prepara el entorno Python.');
}

export function addPackage(spec: string): EnvJob {
  const clean = validateRequirementSpec(spec);
  return startEnvJob('add-package', async ({ log, run }) => {
    const paths = runtimePaths();
    const status = await refreshEnvironment();
    requireReadyEnvironment(status);
    const previous = readRequirements(paths.requirements).text;
    await run(status.uv.path, ['pip', 'install', clean, '--python', paths.venvPython]);
    fs.writeFileSync(paths.requirements, withRequirement(previous, clean));
    log(`«${clean}» añadido a python-requirements.txt\n`);
  });
}

export function removePackage(name: string): EnvJob {
  const target = requirementName(name);
  return startEnvJob('remove-package', async ({ log, run }) => {
    const paths = runtimePaths();
    const status = await refreshEnvironment();
    requireReadyEnvironment(status);
    await run(status.uv.path, ['pip', 'uninstall', target, '--python', paths.venvPython]);
    const { text } = readRequirements(paths.requirements);
    fs.writeFileSync(paths.requirements, withoutRequirement(text, target));
    log(`«${target}» quitado de python-requirements.txt\n`);
  });
}
