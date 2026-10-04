import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import {
  startScriptRun, sendScriptInput, stopScriptRun, getScriptRun, getLatestScriptRun,
  serializeRun, readScriptContent, scriptLanguage, resolveScriptPath,
} from '../engine/scriptRunner.js';
import { getEnvironmentStatus, refreshEnvironment, resolveInterpreter, isStdlibModule } from '../engine/python/environment.js';
import { parseScriptMetadata, detectImports, moduleToPackage, normalizePackageName, requirementName } from '../engine/python/pep723.js';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  // List all scripts
  app.get('/', async () => {
    const db = getDb();
    const scripts = db.prepare('SELECT * FROM scripts ORDER BY created_at DESC').all();
    const todayLogs = db.prepare(`
      SELECT COUNT(*) as count FROM execution_logs
      WHERE target_type = 'script' AND started_at >= date('now')
    `).get() as { count: number };

    return {
      data: scripts,
      meta: {
        activeCount: scripts.length,
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

  // How a Python script would run and which of its imports are covered (null for .js scripts)
  app.get<{ Params: { id: string } }>('/:id/requirements', async (request, reply) => {
    const script = getDb().prepare('SELECT * FROM scripts WHERE id = ?').get(request.params.id) as any;
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const fullPath = resolveScriptPath(script.file_path);
    if (scriptLanguage(fullPath) !== 'python') return { data: null };
    if (!existsSync(fullPath)) return reply.status(404).send({ error: `No se encontró el archivo del script: ${script.file_path}` });

    const code = readFileSync(fullPath, 'utf-8');
    const status = getEnvironmentStatus() ?? await refreshEnvironment();
    const parsed = parseScriptMetadata(code);
    let mode: string;
    try {
      mode = resolveInterpreter(fullPath, code, { status }).mode;
    } catch {
      mode = parsed.ok ? 'no-preparado' : 'invalido';
    }

    const metadata = parsed.ok ? parsed.metadata : null;
    const declared = new Set((metadata?.dependencies || []).map(requirementName));
    const installed = new Set(status.packages.map(p => normalizePackageName(p.name)));
    const imports = detectImports(code)
      .filter(m => !isStdlibModule(m, status) && m !== 'orquesta')
      .map(module => {
        const pkg = moduleToPackage(module);
        const name = normalizePackageName(pkg);
        // Isolated scripts get only what they declare; the others use the shared venv (unknown for the system Python)
        const covered = mode === 'aislado' ? declared.has(name) : mode === 'compartido' ? installed.has(name) : null;
        return { module, package: pkg, covered };
      });

    return {
      data: {
        mode,
        metadata,
        metadataError: parsed.ok ? null : parsed.error,
        imports,
        environmentReady: Boolean(status.venv),
      },
    };
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
