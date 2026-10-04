import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb } from '../src/db/database';
import {
  startScriptRun, sendScriptInput, stopScriptRun, getLatestScriptRun, readScriptContent, stopAllScriptRuns,
} from '../src/engine/scriptRunner';
import { setupDb } from './helpers';

// Node scripts: the test machine is not guaranteed to have Python
let dir: string;
const script = (id: string, code: string) => {
  const file = join(dir, `${id}.js`);
  writeFileSync(file, code);
  getDb().prepare('INSERT INTO scripts (id, name, file_path, language) VALUES (?, ?, ?, ?)').run(id, id, file, 'javascript');
  return { id, file_path: file };
};
const text = (run: { output: Array<{ stream: string; text: string }> }, stream: string) =>
  run.output.filter(c => c.stream === stream).map(c => c.text).join('');

beforeAll(async () => {
  await setupDb();
  dir = mkdtempSync(join(tmpdir(), 'orquesta-scripts-'));
});
afterAll(() => {
  stopAllScriptRuns();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('scriptRunner', () => {
  it('passes arguments and records stdout, stderr and the execution log', async () => {
    const s = script('args', 'console.log(JSON.stringify(process.argv.slice(2))); console.error("aviso");');
    const run = await startScriptRun(s, { args: ['uno', 'dos tres'] }).done;
    expect(run.status).toBe('completed');
    expect(JSON.parse(text(run, 'stdout'))).toEqual(['uno', 'dos tres']);
    expect(text(run, 'stderr')).toContain('aviso');
    const log = getDb().prepare('SELECT * FROM execution_logs WHERE id = ?').get(run.logId) as any;
    expect(log.status).toBe('completed');
    expect(JSON.parse(log.result).stdout).toContain('dos tres');
  });

  it('answers a prompt through stdin in an interactive run', async () => {
    const s = script('prompt', `
      const rl = require('readline').createInterface({ input: process.stdin });
      process.stdout.write('¿Nombre? ');
      rl.once('line', name => { console.log('Hola ' + name); rl.close(); process.stdin.destroy(); });
    `);
    const run = startScriptRun(s, { interactive: true });
    await new Promise(r => setTimeout(r, 300));
    sendScriptInput(run.runId, 'Jose');
    const done = await run.done;
    expect(done.status).toBe('completed');
    expect(text(done, 'stdout')).toBe('¿Nombre? Hola Jose\n');
    expect(text(done, 'stdin')).toBe('Jose\n');
  });

  it('closes stdin for non-interactive runs so a prompt does not hang', async () => {
    const s = script('eof', `
      let data = '';
      process.stdin.on('data', d => data += d).on('end', () => console.log('fin:' + JSON.stringify(data)));
    `);
    const run = await startScriptRun(s).done;
    expect(text(run, 'stdout')).toBe('fin:""\n');
  });

  it('sends EOF on request, for scripts that read until the end of the input', async () => {
    const s = script('eof_manual', `
      let data = '';
      process.stdin.on('data', d => data += d).on('end', () => console.log(data.trim().split('\\n').length + ' lineas'));
    `);
    const run = startScriptRun(s, { interactive: true });
    sendScriptInput(run.runId, 'a');
    sendScriptInput(run.runId, 'b', true);
    expect(text(await run.done, 'stdout')).toBe('2 lineas\n');
  });

  it('reports a non-zero exit code as an error', async () => {
    const s = script('fail', 'console.error("roto"); process.exit(3);');
    const run = await startScriptRun(s).done;
    expect(run.status).toBe('error');
    expect(run.exitCode).toBe(3);
    const log = getDb().prepare('SELECT * FROM execution_logs WHERE id = ?').get(run.logId) as any;
    expect(log.error_message).toBe('El script terminó con código 3');
  });

  it('stops a running script and keeps the latest run for reattaching', async () => {
    const s = script('slow', 'setTimeout(() => {}, 60000); console.log("esperando");');
    const run = startScriptRun(s, { interactive: true });
    expect(getLatestScriptRun(s.id)?.runId).toBe(run.runId);
    await new Promise(r => setTimeout(r, 200));
    expect(stopScriptRun(run.runId)).toBe(true);
    const done = await run.done;
    expect(done.status).toBe('cancelled');
    expect(() => sendScriptInput(run.runId, 'x')).toThrow(/ya no se está ejecutando/);
  });

  it('reads the source code with the original file name and language', () => {
    const s = script('codigo', 'console.log(1);');
    const content = readScriptContent(s.file_path);
    expect(content).toMatchObject({ content: 'console.log(1);', language: 'javascript', truncated: false, fileName: 'codigo.js' });
  });
});
