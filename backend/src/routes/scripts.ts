import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import {
  startScriptRun, sendScriptInput, stopScriptRun, getScriptRun, getLatestScriptRun,
  serializeRun, readScriptContent, scriptLanguage, resolveScriptPath,
} from '../engine/scriptRunner.js';
import { getEnvironmentStatus, refreshEnvironment, isStdlibModule, type PythonEnvStatus } from '../engine/python/environment.js';
import { parseScriptMetadata, writeScriptMetadata, detectImports, moduleToPackage, normalizePackageName, requirementName } from '../engine/python/pep723.js';
import { summarizeScriptEnvironment, prepareScriptEnvironment, removeScriptEnvironment, scriptEnvPaths } from '../engine/python/scriptEnv.js';
import { validateRequirementSpec } from '../engine/python/setup.js';

// Environment summary of a Python script (null for .js or a missing file)
function envSummary(row: any, status: PythonEnvStatus | null) {
  const fullPath = resolveScriptPath(row.file_path);
  if (scriptLanguage(fullPath) !== 'python' || !existsSync(fullPath)) return null;
  return summarizeScriptEnvironment(row.id, row.env_state, readFileSync(fullPath, 'utf-8'), status);
}

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  // List all scripts, each with the environment it runs in
  app.get('/', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM scripts ORDER BY created_at DESC').all() as any[];
    const todayLogs = db.prepare(`
      SELECT COUNT(*) as count FROM execution_logs
      WHERE target_type = 'script' AND started_at >= date('now')
    `).get() as { count: number };
    const status = getEnvironmentStatus() ?? await refreshEnvironment();

    return {
      data: rows.map(({ env_state, ...row }) => ({ ...row, env: envSummary({ ...row, env_state }, status) })),
      meta: {
        activeCount: rows.length,
        executedToday: todayLogs.count
      }
    };
  });

  // Get single script
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    return { data: script };
  });

  // Source code of the script (read-only)
  app.get<{ Params: { id: string } }>('/:id/content', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    try {
      return { data: readScriptContent(script.file_path) };
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  });

  // Dependencies of a Python script, its environment and the imports it does not declare (null for .js)
  app.get<{ Params: { id: string } }>('/:id/requirements', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const fullPath = resolveScriptPath(script.file_path);
    if (scriptLanguage(fullPath) !== 'python') return { data: null };
    if (!existsSync(fullPath)) return reply.status(404).send({ error: `No se encontró el archivo del script: ${script.file_path}` });

    const code = readFileSync(fullPath, 'utf-8');
    const status = getEnvironmentStatus() ?? await refreshEnvironment();
    const summary = summarizeScriptEnvironment(script.id, script.env_state, code, status);
    const declared = new Set(summary.dependencies.map(requirementName));
    const shared = new Map(status.packages.map(p => [normalizePackageName(p.name), p.version]));
    const imports = detectImports(code)
      .filter(m => !isStdlibModule(m, status) && m !== 'orquesta')
      .map(module => {
        const pkg = moduleToPackage(module);
        const name = normalizePackageName(pkg);
        return { module, package: pkg, declared: declared.has(name), sharedVersion: shared.get(name) ?? null };
      });

    return {
      data: {
        ...summary,
        imports,
        sharedPythonVersion: status.venv?.version ?? null,
        ownEnvironmentPath: summary.state?.mode === 'propio' ? scriptEnvPaths(script.id).dir : null,
      },
    };
  });

  // Replace the dependencies of a Python script: they are written to its PEP 723 header
  app.put<{ Params: { id: string }; Body: { dependencies?: string[]; requiresPython?: string | null } }>('/:id/dependencies', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const fullPath = resolveScriptPath(script.file_path);
    if (scriptLanguage(fullPath) !== 'python') return reply.status(400).send({ error: 'Solo los scripts Python tienen dependencias.' });

    const code = readFileSync(fullPath, 'utf-8');
    const current = parseScriptMetadata(code);
    const existing = new Set(current.ok ? current.metadata?.dependencies || [] : []);
    const requiresPython = String(request.body?.requiresPython ?? '').trim();
    try {
      // Entries already in the header are kept as written (markers, URLs…); new ones must be plain requirements
      const dependencies = [...new Set((request.body?.dependencies || []).map(d => String(d).trim()).filter(Boolean))]
        .map(d => (existing.has(d) ? d : validateRequirementSpec(d)));
      if (requiresPython && !/^[\d.\s,<>=!~*]+$/.test(requiresPython)) {
        throw new Error(`«${requiresPython}» no es una versión de Python válida. Ejemplo: >=3.11`);
      }
      writeFileSync(fullPath, writeScriptMetadata(code, { dependencies, requiresPython: requiresPython || undefined }));
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
    const status = getEnvironmentStatus() ?? await refreshEnvironment();
    return { data: summarizeScriptEnvironment(script.id, script.env_state, readFileSync(fullPath, 'utf-8'), status) };
  });

  // Prepare the script's environment (shared or its own); output over Socket.IO like the base setup
  app.post<{ Params: { id: string } }>('/:id/environment', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const fullPath = resolveScriptPath(script.file_path);
    if (scriptLanguage(fullPath) !== 'python') return reply.status(400).send({ error: 'Solo los scripts Python tienen entorno.' });
    try {
      return { data: prepareScriptEnvironment(script, fullPath) };
    } catch (err: any) {
      return reply.status(409).send({ error: err.message });
    }
  });

  app.delete<{ Params: { id: string } }>('/:id/environment', async (request, reply) => {
    const script = getDb().prepare('SELECT id FROM scripts WHERE id = ?').get(request.params.id);
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    removeScriptEnvironment(request.params.id);
    return { data: { removed: true } };
  });

  // Recent runs of the script
  app.get<{ Params: { id: string } }>('/:id/logs', async (request) => {
    const logs = getDb().prepare(`
      SELECT id, status, trigger_type, schedule_id, duration_ms, error_message, result, started_at, completed_at
      FROM execution_logs WHERE target_type = 'script' AND target_id = ?
      ORDER BY started_at DESC, rowid DESC LIMIT 30
    `).all(request.params.id);
    return { data: logs };
  });

  // Upload script
  const handleUpload = async (request: any, reply: any) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const id = uuid();
    const uploadsDir = join(process.cwd(), 'uploads', 'scripts');
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

    const fileName = `${id}_${data.filename}`;
    const filePath = join(uploadsDir, fileName);
    const buffer = await data.toBuffer();
    writeFileSync(filePath, buffer);

    const name = data.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const db = getDb();

    db.prepare(`
      INSERT INTO scripts (id, name, description, file_path, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, '', `scripts/${fileName}`, scriptLanguage(fileName));

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
    return { data: script };
  };

  app.post('/', handleUpload);
  app.post('/upload', handleUpload);

  // Update script
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; schedule_cron?: string }
  }>('/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Script not found' });

    const { name, description, schedule_cron } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (schedule_cron !== undefined) { updates.push('schedule_cron = ?'); values.push(schedule_cron); }

    if (updates.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    values.push(request.params.id);
    db.prepare(`UPDATE scripts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id);
    return { data: script };
  });

  // Execute script and wait for it to finish (no input: stdin is closed right away)
  app.post<{
    Params: { id: string };
    Body: { args?: string[] }
  }>('/:id/execute', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });

    let run;
    try {
      run = await startScriptRun(script, { args: request.body?.args }).done;
    } catch (err: any) {
      // Missing file or no Python ready
      return reply.status(400).send({ error: err.message });
    }
    const stdout = run.output.filter(c => c.stream === 'stdout').map(c => c.text).join('');
    const stderr = run.output.filter(c => c.stream === 'stderr' || c.stream === 'system').map(c => c.text).join('');
    const duration = (run.finishedAt ?? Date.now()) - run.startedAt;

    if (run.status !== 'completed') {
      return reply.status(500).send({
        error: 'Script execution failed',
        message: run.status === 'timeout' ? 'Tiempo límite superado' : `El script terminó con código ${run.exitCode}`,
        stdout,
        stderr
      });
    }
    return { data: { logId: run.logId, status: 'completed', duration, stdout, stderr } };
  });

  // Start an interactive run: output arrives over Socket.IO ('script-output' / 'script-exit').
  // The client may choose the runId so it can listen before the first line is printed.
  app.post<{ Params: { id: string }; Body: { args?: string[]; runId?: string } }>('/:id/runs', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    try {
      const run = startScriptRun(script, { args: request.body?.args, runId: request.body?.runId, interactive: true });
      return { data: serializeRun(run) };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Latest run of the script still in memory, to reattach a console opened mid-run
  app.get<{ Params: { id: string } }>('/:id/runs/latest', async (request) => {
    const run = getLatestScriptRun(request.params.id);
    return { data: run ? serializeRun(run) : null };
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = getScriptRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'Ejecución no encontrada' });
    return { data: serializeRun(run) };
  });

  // Write a line to the script's stdin; eof closes it (like Ctrl+D in a terminal)
  app.post<{ Params: { runId: string }; Body: { text?: string; eof?: boolean } }>('/runs/:runId/input', async (request, reply) => {
    try {
      sendScriptInput(request.params.runId, String(request.body?.text ?? ''), Boolean(request.body?.eof));
      return { data: { ok: true } };
    } catch (err: any) {
      return reply.status(409).send({ error: err.message });
    }
  });

  app.post<{ Params: { runId: string } }>('/runs/:runId/stop', async (request) => {
    return { data: { stopped: stopScriptRun(request.params.runId) } };
  });
}
