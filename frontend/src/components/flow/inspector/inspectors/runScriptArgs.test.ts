import { describe, it, expect } from 'vitest';
import { argRowsOf, legacyArgsToRows, mergeDetectedArgs, type DetectedArg } from './runScriptArgs';

const detected: DetectedArg[] = [
  { flag: '--tickets', name: 'tickets', aliases: ['--tickets', '-t'], help: 'Lista de tickets', required: false, kind: 'value', list: true },
  { flag: '--fecha-inicial', name: 'fecha_inicial', aliases: ['--fecha-inicial', '-f'], help: 'Fecha de control', required: false, kind: 'value', list: false },
  { flag: '--espera', name: 'espera', aliases: ['--espera'], help: '', required: false, kind: 'value', list: false, defaultValue: '3' },
  { flag: '--dry-run', name: 'dry_run', aliases: ['--dry-run'], help: 'No reenvía', required: false, kind: 'switch', list: false },
  { flag: '', name: 'destino', aliases: [], help: '', required: true, kind: 'value', list: false },
];

describe('runScriptArgs', () => {
  it('turns the old command-line text into rows', () => {
    expect(legacyArgsToRows('--tickets {{t[*].id}} -f "2026-10-16 08:00" --verbose --modo=rapido salida.txt')).toEqual([
      { flag: '--tickets', value: '{{t[*].id}}' },
      { flag: '-f', value: '2026-10-16 08:00' },
      { flag: '--verbose', value: '', kind: 'switch' },
      { flag: '--modo=', value: 'rapido' },
      { flag: '', value: 'salida.txt' },
    ]);
    expect(argRowsOf({ args: '-t x', argList: [{ flag: '--a', value: '1' }] })).toEqual([{ flag: '--a', value: '1' }]);
  });

  it('adds the detected arguments and keeps the values already typed', () => {
    const rows = mergeDetectedArgs([{ flag: '-t', value: '{{lista[*].ticket}}' }], detected);
    expect(rows).toEqual([
      { flag: '--tickets', value: '{{lista[*].ticket}}', hint: 'Lista de tickets', required: false, kind: 'value', defaultValue: undefined },
      { flag: '--fecha-inicial', value: '', kind: 'value', hint: 'Fecha de control', required: false },
      { flag: '--espera', value: '', kind: 'value', hint: 'espera', required: false, defaultValue: '3' },
      { flag: '--dry-run', value: '', kind: 'switch', hint: 'No reenvía', required: false },
      { flag: '', value: '', kind: 'value', hint: 'destino', required: true, name: 'destino' },
    ]);
    // Detecting again adds nothing new
    expect(mergeDetectedArgs(rows, detected)).toHaveLength(rows.length);
  });

  it('sends a detected nargs="*" argument as one value per element', () => {
    const rows = mergeDetectedArgs([], detected);
    expect(rows[0].list).toBe('separate');
    expect(rows[1].list).toBeUndefined();
  });
});
