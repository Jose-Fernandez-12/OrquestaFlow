import { describe, it, expect } from 'vitest';
import { instrumentTransformCode } from '../src/engine/transformDebug';
import { runTransformScript } from '../src/engine/executor';

const run = (code: string, data: any, breakpoints?: number[]) =>
  runTransformScript(code, data, {}, breakpoints ? { breakpoints } : undefined);

describe('instrumentTransformCode', () => {
  it('keeps every line where it was', () => {
    const code = 'const a = 1;\nconst b = a + 1;\nconsole.log(b);\nreturn b;';
    const out = instrumentTransformCode(code, [2]).code;
    expect(out.split('\n')).toHaveLength(4);
    expect(out.split('\n')[1]).toContain('__bp(2,');
    expect(out.split('\n')[2]).toContain('__vars(3,');
  });

  it('moves a breakpoint to the next line with a statement', () => {
    const code = 'const rows = data.filter(r =>\n  r.activo\n);\n\nreturn rows;';
    expect(instrumentTransformCode(code, [2]).breakpoints).toEqual([{ requested: 2, resolved: 5 }]);
  });

  it('adds braces around single statement bodies', () => {
    const code = 'let n = 0;\nfor (const r of data)\n  n += r;\nreturn n;';
    const out = instrumentTransformCode(code, [3]).code;
    expect(out).toContain('{__bp(3,');
    expect(run(code, [1, 2, 3], [3]).result).toBe(6);
  });

  it('leaves code that does not parse untouched', () => {
    const out = instrumentTransformCode('return (;', [1]);
    expect(out.code).toBe('return (;');
    expect(out.breakpoints[0].resolved).toBeNull();
  });
});

describe('runTransformScript · debug trace', () => {
  it('records each breakpoint hit with the variables in scope at that moment', () => {
    const code = [
      'let total = 0;',
      'for (const row of data) {',
      '  total += row.precio;',
      '}',
      'return total;',
    ].join('\n');
    const { result, trace } = run(code, [{ precio: 10 }, { precio: 5 }], [3]);
    expect(result).toBe(15);
    expect(trace!.stops.map(s => [s.kind, s.line, s.hit, s.vars?.total])).toEqual([
      ['breakpoint', 3, 1, 0],
      ['breakpoint', 3, 2, 10],
    ]);
    expect(trace!.stops[1].vars?.row).toEqual({ precio: 5 });
  });

  it('turns console calls into stops with their line and variables', () => {
    const code = 'const activos = data.filter(r => r.ok);\nconsole.log("activos", activos.length);\nreturn activos;';
    const { trace, _logs } = run(code, [{ ok: true }, { ok: false }], []);
    expect(_logs[0].line).toBe(2);
    expect(trace!.stops).toHaveLength(1);
    expect(trace!.stops[0]).toMatchObject({ kind: 'console', level: 'log', line: 2, args: ['activos', '1'] });
    expect(trace!.stops[0].vars?.activos).toEqual([{ ok: true }]);
  });

  it('copies values when they are recorded, not when the script ends', () => {
    const code = 'const lista = [];\nlista.push(1);\nlista.push(2);\nreturn lista;';
    const { trace } = run(code, null, [3]);
    expect(trace!.stops[0].vars?.lista).toEqual([1]);
  });

  it('reports the line of a runtime error together with the stops before it', () => {
    const code = 'console.log("antes");\nconst x = null;\nreturn x.campo;';
    try {
      run(code, null, []);
      throw new Error('should have failed');
    } catch (e: any) {
      expect(e._trace.errorLine).toBe(3);
      expect(e._trace.stops).toHaveLength(1);
    }
  });

  it('does not instrument outside of debug sessions', () => {
    const { trace, _logs } = run('console.log(1);\nreturn 2;', null);
    expect(trace).toBeUndefined();
    expect(_logs).toHaveLength(1);
  });
});
