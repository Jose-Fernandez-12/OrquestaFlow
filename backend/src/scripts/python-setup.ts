/**
 * Prepares (or reports) the Python environment used by the scripts, inside backend/.runtime:
 *
 *   npm run python:setup     downloads uv, installs Python, creates the shared venv, installs python-requirements.txt
 *   npm run python:status    shows what is installed
 *
 * Nothing is installed on the system and no admin rights are needed.
 */
import { initDb } from '../db/database.js';
import { refreshEnvironment, configuredPythonVersion, runtimePaths } from '../engine/python/environment.js';
import { runPythonSetup, waitForJob, readRequirements } from '../engine/python/setup.js';

async function status() {
  const s = await refreshEnvironment();
  const line = (label: string, value: string) => console.log(`${label.padEnd(20)} ${value}`);
  line('Carpeta', runtimePaths().base);
  line('uv', s.uv ? `${s.uv.version} (${s.uv.managed ? 'gestionado' : 'del sistema'})` : 'no instalado');
  line('Entorno compartido', s.venv ? `Python ${s.venv.version}` : 'no creado');
  line('Python del sistema', s.system ? `${s.system.version} (${[s.system.command, ...s.system.args].join(' ')})` : 'no encontrado');
  line('Versión configurada', configuredPythonVersion());
  const reqs = readRequirements().entries;
  line('Requirements', reqs.length ? reqs.map(r => r.spec).join(', ') : '(vacío)');
  if (s.packages.length) line('Instalados', s.packages.map(p => `${p.name} ${p.version}`).join(', '));
}

async function main() {
  await initDb();
  if (process.argv.includes('--status')) return status();

  const job = runPythonSetup((_stream, text) => process.stdout.write(text));
  const result = await waitForJob(job);
  if (result.status !== 'completed') process.exit(1);
  console.log('');
  await status();
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
