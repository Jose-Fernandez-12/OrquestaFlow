import { FastifyInstance } from 'fastify';
import { getEnvironmentStatus, refreshEnvironment, configuredPythonVersion, runtimePaths } from '../engine/python/environment.js';
import { runPythonSetup, addPackage, removePackage, getEnvJob, getActiveEnvJob, readRequirements, buildSetupSteps, UV_VERSION } from '../engine/python/setup.js';
import { normalizePackageName } from '../engine/python/pep723.js';
import { readEnvState, invalidateScriptsUsing } from '../engine/python/scriptEnv.js';
import { getDb } from '../db/database.js';

export async function pythonEnvRoutes(app: FastifyInstance): Promise<void> {
  // State of the managed environment and of python-requirements.txt
  app.get<{ Querystring: { refresh?: string } }>('/', async (request) => {
    const status = request.query.refresh || !getEnvironmentStatus() ? await refreshEnvironment() : getEnvironmentStatus()!;
    const pythonVersion = configuredPythonVersion();
    const requirements = readRequirements();
    const installed = new Map(status.packages.map(p => [normalizePackageName(p.name), p.version]));

    // Which scripts rely on each shared package, and how many have their own environment
    const usage: Record<string, string[]> = {};
    let ownEnvironments = 0;
    for (const row of getDb().prepare('SELECT name, env_state FROM scripts').all() as Array<{ name: string; env_state?: string }>) {
      const state = readEnvState(row.env_state);
      if (state?.mode === 'propio') ownEnvironments++;
      if (state?.mode === 'compartido') for (const pkg of Object.keys(state.resolved)) (usage[pkg] ||= []).push(row.name);
    }
    return {
      data: {
        uv: status.uv,
        venv: status.venv,
        system: status.system,
        pythonVersion,
        uvVersion: UV_VERSION,
        runtimeDir: runtimePaths().base,
        pendingSteps: buildSetupSteps(status, { pythonVersion, hasRequirements: requirements.entries.length > 0 })
          .filter(s => s.id !== 'install-packages'),
        requirements: requirements.entries.map(e => ({ name: e.name, spec: e.spec, installed: installed.get(e.name) ?? null })),
        packages: status.packages.map(p => ({ ...p, usedBy: usage[normalizePackageName(p.name)] || [] })),
        ownEnvironments,
        activeJob: getActiveEnvJob(),
        checkedAt: status.checkedAt,
      },
    };
  });

  app.post('/setup', async () => ({ data: runPythonSetup() }));

  app.post<{ Body: { spec?: string } }>('/packages', async (request, reply) => {
    try {
      return { data: addPackage(String(request.body?.spec ?? '')) };
    } catch (err: any) {
      return reply.status(/en curso/.test(err.message) ? 409 : 400).send({ error: err.message });
    }
  });

  app.delete<{ Params: { name: string } }>('/packages/:name', async (request, reply) => {
    try {
      const job = removePackage(request.params.name);
      // Scripts that used it in the shared environment must be prepared again
      invalidateScriptsUsing(request.params.name);
      return { data: job };
    } catch (err: any) {
      return reply.status(409).send({ error: err.message });
    }
  });

  app.get('/jobs/active', async () => ({ data: getActiveEnvJob() }));

  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const job = getEnvJob(request.params.id);
    if (!job) return reply.status(404).send({ error: 'Operación no encontrada' });
    return { data: job };
  });
}
