import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '../../db/database.js';
import { runtimePaths, uvEnv, runCommand, refreshEnvironment, configuredPythonVersion, type PythonEnvStatus } from './environment.js';
import { parseScriptMetadata, pythonSatisfies, requirementName, normalizePackageName, type ScriptMetadata } from './pep723.js';
import { startEnvJob, type EnvJob } from './setup.js';

/**
 * Environment of each Python script. Its dependencies live in the script's PEP 723 header; when it is
 * prepared, uv is asked what installing them in the shared environment would do:
 *   - nothing, or only adding packages      → the script uses the shared environment (packages added there)
 *   - changing a version already installed  → the script gets its own venv in .runtime/envs/<script id>,
 *     so the other scripts keep the versions they rely on
 * A Python version the shared environment does not satisfy (requires-python) also means its own venv.
 * uv hard-links packages from its cache, so an own environment does not duplicate the downloads.
 */

export type ScriptEnvMode = 'compartido' | 'propio';

export interface ScriptEnvState {
  mode: ScriptEnvMode;
  /** Dependencies (and requires-python) the environment was prepared for */
  hash: string;
  resolved: Record<string, string>;
  reason: string | null;
  pythonVersion: string;
  preparedAt: number;
}

export function readEnvState(raw: unknown): ScriptEnvState | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const s = JSON.parse(raw);
    return s && (s.mode === 'compartido' || s.mode === 'propio') ? s : null;
  } catch {
    return null;
  }
}

export function depsHash(metadata: ScriptMetadata | null): string {
  const deps = [...(metadata?.dependencies || [])].map(d => d.replace(/\s+/g, '')).sort();
  return crypto.createHash('sha1').update(JSON.stringify([deps, metadata?.requiresPython || ''])).digest('hex').slice(0, 16);
}

export function scriptEnvPaths(scriptId: string, paths = runtimePaths()) {
  const dir = path.join(paths.base, 'envs', scriptId.replace(/[^\w-]/g, '_'));
  return { dir, python: process.platform === 'win32' ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python') };
}

// ── decision ──

export interface DryRunResult { ok: boolean; installs: string[]; removals: string[]; error?: string }

/** Reads `uv pip install --dry-run` output: " + name==1.0" would be installed, " - name==0.9" removed */
export function parseDryRun(output: string, exitCode: number | null): DryRunResult {
  const installs: string[] = [];
  const removals: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s*([+-])\s+(\S+)/);
    if (m) (m[1] === '+' ? installs : removals).push(m[2]);
  }
  if (exitCode !== 0) {
    const error = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-3).join(' ');
    return { ok: false, installs, removals, error: error || `uv terminó con código ${exitCode}` };
  }
  return { ok: true, installs, removals };
}

const pkgName = (pin: string) => normalizePackageName(pin.split('==')[0]);
const pkgVersion = (pin: string) => pin.split('==')[1] || '?';

export interface EnvDecision { mode: ScriptEnvMode; reason: string | null; install: string[] }

export function decideEnvironment(metadata: ScriptMetadata, sharedVersion: string, dryRun: DryRunResult | null): EnvDecision {
  if (metadata.requiresPython && !pythonSatisfies(sharedVersion, metadata.requiresPython)) {
    return { mode: 'propio', reason: `Pide Python ${metadata.requiresPython} y el entorno compartido tiene ${sharedVersion}.`, install: [] };
  }
  if (!dryRun) return { mode: 'compartido', reason: null, install: [] };
  if (!dryRun.ok) {
    return { mode: 'propio', reason: `Sus dependencias no se pueden resolver junto a las del entorno compartido (${dryRun.error}).`, install: [] };
  }
  if (dryRun.removals.length > 0) {
    const changes = dryRun.removals.map(old => {
      const next = dryRun.installs.find(i => pkgName(i) === pkgName(old));
      return next ? `${pkgName(old)} ${pkgVersion(old)} → ${pkgVersion(next)}` : `quitar ${pkgName(old)} ${pkgVersion(old)}`;
    });
    return {
      mode: 'propio',
      reason: `En el entorno compartido cambiaría versiones que usan otros scripts (${changes.join(', ')}), así que tiene su propio entorno.`,
      install: [],
    };
  }
  return { mode: 'compartido', reason: null, install: dryRun.installs };
}

// ── state shown in the UI ──

export type ScriptEnvView = 'sin-dependencias' | 'compartido' | 'propio' | 'pendiente' | 'no-preparado' | 'invalido';

export interface ScriptEnvSummary {
  view: ScriptEnvView;
  dependencies: string[];
  requiresPython: string | null;
  metadataError: string | null;
  /** The dependencies changed since the environment was prepared */
  stale: boolean;
  state: ScriptEnvState | null;
}

export function summarizeScriptEnvironment(scriptId: string, envStateRaw: unknown, code: string, status: PythonEnvStatus | null): ScriptEnvSummary {
  const parsed = parseScriptMetadata(code);
  const metadata = parsed.ok ? parsed.metadata : null;
  const state = readEnvState(envStateRaw);
  const base = {
    dependencies: metadata?.dependencies || [],
    requiresPython: metadata?.requiresPython || null,
    metadataError: parsed.ok ? null : parsed.error,
    state,
  };
  if (!parsed.ok) return { view: 'invalido', stale: false, ...base };

  const hasDeps = base.dependencies.length > 0 || !!base.requiresPython;
  const stale = hasDeps && (!state || state.hash !== depsHash(metadata));
  if (!status?.venv || !status.uv) return { view: hasDeps || !status?.system ? 'no-preparado' : 'sin-dependencias', stale, ...base };
  if (!hasDeps) return { view: 'sin-dependencias', stale: false, ...base };
  if (stale) return { view: 'pendiente', stale, ...base };
  if (state!.mode === 'propio' && !fs.existsSync(scriptEnvPaths(scriptId).python)) return { view: 'pendiente', stale: true, ...base };
  return { view: state!.mode, stale: false, ...base };
}

/** For resolveInterpreter: the script's own venv if it has one, and whether it must be prepared again */
export function scriptInterpreterEnv(scriptId: string | undefined, code: string): { python?: string; pending: boolean } | null {
  if (!scriptId) return null;
  try {
    const row = getDb().prepare('SELECT env_state FROM scripts WHERE id = ?').get(scriptId) as { env_state?: string } | undefined;
    if (!row) return null;
    const parsed = parseScriptMetadata(code);
    const metadata = parsed.ok ? parsed.metadata : null;
    const hasDeps = !!metadata && (metadata.dependencies.length > 0 || !!metadata.requiresPython);
    const state = readEnvState(row.env_state);
    const pending = hasDeps && (!state || state.hash !== depsHash(metadata));
    const own = scriptEnvPaths(scriptId).python;
    return { python: state?.mode === 'propio' && fs.existsSync(own) ? own : undefined, pending };
  } catch {
    return null;
  }
}

// ── preparing ──

function saveState(scriptId: string, state: ScriptEnvState | null) {
  getDb().prepare('UPDATE scripts SET env_state = ? WHERE id = ?').run(state ? JSON.stringify(state) : null, scriptId);
}

async function installedVersions(uv: string, python: string, names: string[]): Promise<Record<string, string>> {
  const r = await runCommand(uv, ['pip', 'list', '--format', 'json', '--python', python], uvEnv());
  const wanted = new Set(names);
  const out: Record<string, string> = {};
  try {
    for (const p of JSON.parse(r.stdout)) {
      const name = normalizePackageName(String(p.name));
      if (wanted.has(name)) out[name] = String(p.version);
    }
  } catch { /* empty */ }
  return out;
}

export function prepareScriptEnvironment(script: { id: string; name?: string; file_path: string }, fullPath: string): EnvJob {
  return startEnvJob('prepare-script', async ({ log, run }) => {
    const code = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseScriptMetadata(code);
    if (!parsed.ok) throw new Error(parsed.error);
    const metadata = parsed.metadata || { dependencies: [] };
    const bad = metadata.dependencies.find(d => d.startsWith('-'));
    if (bad) throw new Error(`«${bad}» no es un paquete: las opciones de pip no se admiten en las dependencias.`);

    const status = await refreshEnvironment();
    if (!status.uv || !status.venv) throw new Error('Primero prepara el entorno base (botón «Preparar» arriba en Scripts).');
    const uv = status.uv.path;
    const paths = runtimePaths();
    const own = scriptEnvPaths(script.id, paths);
    const hash = depsHash(metadata);
    const names = metadata.dependencies.map(requirementName);

    if (metadata.dependencies.length === 0 && !metadata.requiresPython) {
      log('El script no declara dependencias: usa el entorno compartido tal cual.\n');
      fs.rmSync(own.dir, { recursive: true, force: true });
      saveState(script.id, { mode: 'compartido', hash, resolved: {}, reason: null, pythonVersion: status.venv.version, preparedAt: Date.now() });
      return;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orquesta-deps-'));
    const reqFile = path.join(tmp, 'requirements.txt');
    fs.writeFileSync(reqFile, metadata.dependencies.join('\n') + '\n');
    try {
      log(`Dependencias: ${metadata.dependencies.join(', ') || '(ninguna)'}${metadata.requiresPython ? ` · Python ${metadata.requiresPython}` : ''}\n`);

      let dryRun: DryRunResult | null = null;
      if (!metadata.requiresPython || pythonSatisfies(status.venv.version, metadata.requiresPython)) {
        log('Comprobando si encajan en el entorno compartido…\n');
        const r = await runCommand(uv, ['pip', 'install', '--dry-run', '-r', reqFile, '--python', paths.venvPython], uvEnv(), 120000);
        dryRun = parseDryRun(r.stdout + r.stderr, r.code);
      }
      const decision = decideEnvironment(metadata, status.venv.version, dryRun);

      if (decision.mode === 'compartido') {
        if (decision.install.length) {
          log(`Encajan: se añaden al entorno compartido (${decision.install.join(', ')}).\n`);
          await run(uv, ['pip', 'install', '-r', reqFile, '--python', paths.venvPython]);
        } else {
          log('Ya están instaladas en el entorno compartido: no hace falta instalar nada.\n');
        }
        if (fs.existsSync(own.dir)) {
          log('El script vuelve al entorno compartido: se elimina su entorno propio.\n');
          fs.rmSync(own.dir, { recursive: true, force: true });
        }
        const resolved = await installedVersions(uv, paths.venvPython, names);
        saveState(script.id, { mode: 'compartido', hash, resolved, reason: null, pythonVersion: status.venv.version, preparedAt: Date.now() });
        log('\nListo: el script usa el entorno compartido.\n');
        return;
      }

      log(`${decision.reason}\nCreando su entorno propio…\n`);
      const python = metadata.requiresPython || configuredPythonVersion();
      await run(uv, ['venv', own.dir, '--python', python, '--clear']);
      await run(uv, ['pip', 'install', '-r', reqFile, '--python', own.python]);
      const v = await runCommand(own.python, ['--version']);
      const resolved = await installedVersions(uv, own.python, names);
      saveState(script.id, {
        mode: 'propio', hash, resolved, reason: decision.reason,
        pythonVersion: (v.stdout + v.stderr).match(/(\d+\.\d+\.\d+)/)?.[1] || python,
        preparedAt: Date.now(),
      });
      log('\nListo: el script usa su propio entorno.\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, undefined, script.id);
}

export function removeScriptEnvironment(scriptId: string): void {
  fs.rmSync(scriptEnvPaths(scriptId).dir, { recursive: true, force: true });
  saveState(scriptId, null);
}

/** After a shared package is removed, the scripts that relied on it must be prepared again */
export function invalidateScriptsUsing(packageName: string): string[] {
  const target = normalizePackageName(packageName);
  const affected: string[] = [];
  for (const row of getDb().prepare('SELECT id, env_state FROM scripts').all() as Array<{ id: string; env_state?: string }>) {
    const state = readEnvState(row.env_state);
    if (state?.mode === 'compartido' && target in state.resolved) {
      saveState(row.id, null);
      affected.push(row.id);
    }
  }
  return affected;
}
