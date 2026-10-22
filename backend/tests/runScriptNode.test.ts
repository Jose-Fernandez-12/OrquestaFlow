import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb } from '../src/db/database';
import { stopAllScriptRuns, getScriptRun } from '../src/engine/scriptRunner';
import { executeFlowEngine, resumeNodeExecution } from '../src/engine/executor';
import {
  buildArgsFromRows, buildScriptArgs, detectScriptArguments, parseScriptResult, scriptNodeArgs, serializeScriptInput, splitArgs,
} from '../src/engine/scriptNode';
import { createFlow, edge, runFlow, setupDb } from './helpers';

// Node scripts: the test machine is not guaranteed to have Python
let dir: string;
const script = (id: string, code: string) => {
  const file = join(dir, `${id}.js`);
  writeFileSync(file, code);
  getDb().prepare('INSERT INTO scripts (id, name, file_path, language) VALUES (?, ?, ?, ?)').run(id, id, file, 'javascript');
  return id;
};
const list = (id: string, items: any[]) => ({ id, type: 'dataList', data: { label: id, items: JSON.stringify(items) } });
const runScript = (id: string, data: Record<string, any>) => ({ id, type: 'runScript', data: { label: id, ...data } });

beforeAll(async () => {
  await setupDb();
  dir = mkdtempSync(join(tmpdir(), 'orquesta-runscript-'));
});
afterAll(() => {
  stopAllScriptRuns();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('scriptNode helpers', () => {
  const ctx: Record<string, any> = {
    fecha: '2026-10-16 08:00:00',
    tickets: ['A1', 'B2'],
    filtro: { eds: 3 },
    vacio: null,
  };
  const resolve = (p: string) => ctx[p];

  it('splits like a command line and resolves each argument after splitting', () => {
    expect(splitArgs('--a "dos tres" C:\\datos\\x.csv')).toEqual(['--a', 'dos tres', 'C:\\datos\\x.csv']);
    // A value with spaces stays one argument; a list goes as a,b; objects as JSON; null as ''
    expect(buildScriptArgs('-f {{fecha}} -t {{tickets}} --json {{filtro}} --x {{vacio}} --id=T{{tickets}}', resolve))
      .toEqual(['-f', '2026-10-16 08:00:00', '-t', 'A1,B2', '--json', '{"eds":3}', '--x', '', '--id=TA1,B2']);
  });

  it('writes the input as JSON rows or one value per line', () => {
    const rows = { rows: [{ ticket: 'A1', eds: 1 }, { ticket: 'B2', eds: 2 }] };
    expect(JSON.parse(serializeScriptInput(rows, 'json'))).toEqual(rows.rows);
    expect(serializeScriptInput(rows, 'lines', 'eds')).toBe('1\n2');
    // Without a field: the first column of each row
    expect(serializeScriptInput(rows, 'lines')).toBe('A1\nB2');
    expect(serializeScriptInput(['x', 'y'], 'lines')).toBe('x\ny');
  });

  it('reads the result from the output file, all of stdout or its last JSON line', () => {
    expect(parseScriptResult('log\n', '{"ok":true}')).toEqual({ ok: true });
    expect(parseScriptResult('[1,2]\n')).toEqual([1, 2]);
    expect(parseScriptResult('[INFO] procesando\n{"subidas":3}\n')).toEqual({ subidas: 3 });
    expect(parseScriptResult('solo texto\n')).toBeUndefined();
    expect(() => parseScriptResult('', 'no es json')).toThrow(/ORQUESTA_OUTPUT_FILE/);
  });
});

describe('scriptNode · arguments by row', () => {
  const ctx: Record<string, any> = { tickets: ['A1', 'B2'], fecha: '2026-10-16 08:00', vacio: '', si: 'true', no: 'false' };
  const resolve = (p: string) => ctx[p];

  it('sends one row per option, values with spaces as one argument and skips empty rows', () => {
    expect(buildArgsFromRows([
      { flag: '--tickets', value: '{{tickets}}' },
      { flag: '--fecha-inicial', value: '{{fecha}}' },
      { flag: '--opcional', value: '{{vacio}}' },
      { flag: '--sin-valor', value: '' },
      { flag: '', value: 'posicional con espacios' },
      { flag: '--modo=', value: 'rapido' },
    ], resolve)).toEqual(['--tickets', 'A1,B2', '--fecha-inicial', '2026-10-16 08:00', 'posicional con espacios', '--modo=rapido']);
  });

  it('sends a list as one argument per element for nargs="*" options', () => {
    expect(buildArgsFromRows([{ flag: '--tickets', value: '{{tickets}}', list: 'separate' }], resolve))
      .toEqual(['--tickets', 'A1', 'B2']);
    expect(buildArgsFromRows([{ flag: '--tickets', value: '{{nada}}', list: 'separate' }], resolve)).toEqual([]);
  });

  it('sends switches when empty or true', () => {
    expect(buildArgsFromRows([
      { flag: '--verbose', kind: 'switch' },
      { flag: '--dry-run', kind: 'switch', value: '{{si}}' },
      { flag: '--json', kind: 'switch', value: '{{no}}' },
    ], resolve)).toEqual(['--verbose', '--dry-run']);
  });

  it('keeps reading the command-line text of older nodes', () => {
    expect(scriptNodeArgs({ args: '-t {{tickets}}' }, resolve)).toEqual(['-t', 'A1,B2']);
    expect(scriptNodeArgs({ args: 'ignorado', argList: [{ flag: '-t', value: '{{tickets}}' }] }, resolve)).toEqual(['-t', 'A1,B2']);
  });

  it('detects the argparse arguments of a Python script', () => {
    const code = `
import argparse
p = argparse.ArgumentParser()
p.add_argument("--tickets", "-t", nargs="*", help="Lista de tickets, separados por comas.")
p.add_argument('-f', '--fecha-inicial', default=None,
               help=("Fecha de control "
                     "(AAAA-MM-DD)."))  # comentario (con paréntesis
p.add_argument("--espera", type=int, default=3)
p.add_argument("--dry-run", action="store_true", help="No reenvía nada")
p.add_argument("--pais", required=True, dest="country")
p.add_argument("entradas", nargs="*")
p.add_argument("destino")
`;
    expect(detectScriptArguments(code)).toEqual([
      { flag: '--tickets', name: 'tickets', aliases: ['--tickets', '-t'], help: 'Lista de tickets, separados por comas.', required: false, kind: 'value', list: true, defaultValue: undefined },
      { flag: '--fecha-inicial', name: 'fecha_inicial', aliases: ['-f', '--fecha-inicial'], help: 'Fecha de control (AAAA-MM-DD).', required: false, kind: 'value', list: false, defaultValue: undefined },
      { flag: '--espera', name: 'espera', aliases: ['--espera'], help: '', required: false, kind: 'value', list: false, defaultValue: '3' },
      { flag: '--dry-run', name: 'dry_run', aliases: ['--dry-run'], help: 'No reenvía nada', required: false, kind: 'switch', list: false, defaultValue: undefined },
      { flag: '--pais', name: 'country', aliases: ['--pais'], help: '', required: true, kind: 'value', list: false, defaultValue: undefined },
      { flag: '', name: 'entradas', aliases: [], help: '', required: false, kind: 'value', list: true, defaultValue: undefined },
      { flag: '', name: 'destino', aliases: [], help: '', required: true, kind: 'value', list: false, defaultValue: undefined },
    ]);
  });
});

describe('executeFlowEngine · Ejecutar script', () => {
  it('builds the arguments from rows with the list of a previous node and a date', async () => {
    const id = script('rows', 'console.log(JSON.stringify(process.argv.slice(2)));');
    const { context } = await runFlow(
      [
        list('tickets', [{ ticket: 'A1' }, { ticket: 'B2' }]),
        { id: 'vars', type: 'variables', data: { label: 'vars', variables: [{ key: 'fecha', type: 'string', value: '2026-10-16 08:00' }, { key: 'nada', type: 'string', value: '' }] } },
        runScript('rep', {
          script: id,
          argList: [
            { flag: '--tickets', value: '{{tickets[*].ticket}}', list: 'separate' },
            { flag: '--fecha-inicial', value: '{{vars.fecha}}' },
            { flag: '--opcional', value: '{{vars.nada}}' },
          ],
        }),
      ],
      [edge('tickets', 'vars'), edge('vars', 'rep')]
    );
    expect(context.rep.data).toEqual(['--tickets', 'A1', 'B2', '--fecha-inicial', '2026-10-16 08:00']);
  });

  it('refuses a command line too long for Windows and points to the input file', async () => {
    const id = script('long', 'console.log("no deberia correr");');
    const many = Array.from({ length: 3000 }, (_, i) => ({ ticket: `4001043221${String(i).padStart(5, '0')}` }));
    await expect(runFlow(
      [list('muchos', many), runScript('largo', { script: id, argList: [{ flag: '--tickets', value: '{{muchos[*].ticket}}' }] })],
      [edge('muchos', 'largo')]
    )).rejects.toThrow(/Archivo temporal/);
  });

  it('passes arguments built from previous nodes and the input rows in a file', async () => {
    const id = script('tickets_file', `
      const fs = require('fs');
      const args = process.argv.slice(2);
      const file = args[args.indexOf('--archivo') + 1];
      console.log('[INFO] leyendo ' + file);
      console.log(JSON.stringify({
        args,
        sameFile: file === process.env.ORQUESTA_INPUT_FILE,
        lines: fs.readFileSync(file, 'utf-8').split('\\n'),
      }));
    `);
    const { context } = await runFlow(
      [
        list('tickets', [{ ticket: 'A1', eds: 1 }, { ticket: 'B2', eds: 2 }]),
        runScript('reproceso', {
          script: id,
          args: '--archivo {{_inputFile}} -f "2026-10-16 08:00" --eds {{tickets[*].eds}}',
          inputMode: 'file',
          inputFormat: 'lines',
          inputField: 'ticket',
        }),
      ],
      [edge('tickets', 'reproceso')]
    );
    const out = context.reproceso;
    expect(out.exitCode).toBe(0);
    expect(out.data.sameFile).toBe(true);
    expect(out.data.lines).toEqual(['A1', 'B2']);
    expect(out.data.args.slice(2)).toEqual(['-f', '2026-10-16 08:00', '--eds', '1,2']);
    expect(out.stdout).toContain('[INFO] leyendo');
  });

  it('sends the input as JSON on stdin and takes the result from ORQUESTA_OUTPUT_FILE', async () => {
    const id = script('stdin_json', `
      let raw = '';
      process.stdin.on('data', d => raw += d).on('end', () => {
        const rows = JSON.parse(raw);
        console.log('procesadas ' + rows.length);
        require('fs').writeFileSync(process.env.ORQUESTA_OUTPUT_FILE, JSON.stringify(rows.map(r => ({ ...r, ok: true }))));
      });
    `);
    const { context } = await runFlow(
      [list('filas', [{ id: 1 }, { id: 2 }]), runScript('marcar', { script: id, inputMode: 'stdin' })],
      [edge('filas', 'marcar')]
    );
    expect(context.marcar.data).toEqual([{ id: 1, ok: true }, { id: 2, ok: true }]);
    expect(context.marcar.stdout).toBe('procesadas 2\n');
  });

  it('runs once per loop item with {{_item}} in the arguments', async () => {
    const id = script('per_item', 'console.log(JSON.stringify({ ticket: process.argv[2] }));');
    const { context } = await runFlow(
      [
        list('items', [{ t: 'A1' }, { t: 'B2' }]),
        { id: 'loop', type: 'forEach', data: { label: 'loop', iterateOver: '{{items}}' } },
        runScript('uno', { script: id, args: '{{_item.t}}' }),
        { id: 'end', type: 'forEachEnd', data: { label: 'end' } },
      ],
      [edge('items', 'loop'), edge('loop', 'uno'), edge('uno', 'end')]
    );
    expect(JSON.stringify(context.end)).toContain('"ticket":"A1"');
    expect(JSON.stringify(context.end)).toContain('"ticket":"B2"');
  });

  it('keeps plain text output under data.output', async () => {
    const id = script('plain', 'console.log("listo");');
    const { context } = await runFlow([runScript('texto', { script: id })], []);
    expect(context.texto.data).toEqual({ output: 'listo' });
  });

  it('fails the node with the exit code and the end of stderr', async () => {
    const id = script('broken', 'console.error("Fecha de control no valida"); process.exit(2);');
    await expect(runFlow([runScript('roto', { script: id })], [])).rejects.toThrow(/código 2[\s\S]*Fecha de control no valida/);
  });

  it('continues with { error, failed } when the node is set to continue on error', async () => {
    const id = script('broken_continue', 'process.exit(1);');
    const { context } = await runFlow([runScript('tolerante', { script: id, onError: 'continue' })], []);
    expect(context.tolerante.failed).toBe(true);
  });

  it('explains a missing script', async () => {
    await expect(runFlow([runScript('sin', { script: 'no-existe' })], [])).rejects.toThrow(/no se encontró el script "no-existe"/);
  });
});

describe('Ejecutar script · debug', () => {
  it('previews the resolved command before running and reports the run to follow its console', async () => {
    const id = script('debug_preview', 'console.log("hola " + process.argv.slice(2).join("|"));');
    const flowId = createFlow(
      [
        list('tickets', [{ ticket: 'A1' }, { ticket: 'B2' }]),
        runScript('rep', {
          script: id,
          inputMode: 'file',
          inputFormat: 'lines',
          argList: [
            { flag: '--tickets', value: '{{tickets[*].ticket}}', list: 'separate' },
            { flag: '--fecha', value: '{{tickets.nada}}' },
            { flag: '--archivo', value: '{{_inputFile}}' },
          ],
        }),
      ],
      [edge('tickets', 'rep')]
    );
    const events: Array<{ nodeId: string; status: string; result?: any }> = [];
    await executeFlowEngine(flowId, (nodeId, status, result) => {
      events.push({ nodeId, status, result });
      if (status === 'paused') setTimeout(() => resumeNodeExecution(flowId, nodeId, 'step_over'), 0);
    }, { mode: 'debug' });

    const preview = events.find(e => e.nodeId === 'rep' && e.status === 'paused')?.result?.nodePreview;
    expect(preview.kind).toBe('script');
    expect(preview.script.name).toBe(id);
    expect(preview.argv).toEqual(['--tickets', 'A1', 'B2', '--archivo', '<archivo temporal>']);
    expect(preview.rows.find((r: any) => r.flag === '--fecha').argv).toEqual([]);
    expect(preview.input).toMatchObject({ mode: 'file', format: 'lines', lines: 2, text: ['A1', 'B2'].join('\n') });

    const started = events.find(e => e.nodeId === 'rep' && e.status === 'progress' && e.result?.scriptRun)?.result.scriptRun;
    expect(started.scriptId).toBe(id);
    const run = getScriptRun(started.runId)!;
    expect(run.output.map(c => c.text).join('')).toContain('hola --tickets|A1|B2|--archivo|');
    const done = events.find(e => e.nodeId === 'rep' && e.status === 'completed');
    expect(done?.result.stdout).toContain('hola');
  });
});
