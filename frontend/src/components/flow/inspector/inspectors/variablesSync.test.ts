import { describe, it, expect } from 'vitest';
import { variablesFromJson, variablesToJson, type FlowVariable } from './variablesSync';

describe('variablesFromJson', () => {
  it('turns every key of the JSON editor into a variable', () => {
    const vars = variablesFromJson('{ "FechaInicio": "20260926", "FechaFin": "20260928", "dias": 3, "activo": true }');
    expect(vars?.map(v => [v.key, v.type, v.value])).toEqual([
      ['FechaInicio', 'string', '20260926'],
      ['FechaFin', 'string', '20260928'],
      ['dias', 'number', 3],
      ['activo', 'boolean', true],
    ]);
  });

  it('keeps the type and description of keys that already existed', () => {
    const previous: FlowVariable[] = [{ key: 'FechaInicio', type: 'date', value: '20260921', description: 'Inicio' }];
    const vars = variablesFromJson('{ "FechaInicio": "$month_start", "FechaFin": "$today_ymd" }', previous);
    expect(vars?.[0]).toEqual({ key: 'FechaInicio', type: 'date', value: '$month_start', description: 'Inicio' });
    expect(vars?.[1]).toMatchObject({ key: 'FechaFin', type: 'string' });
  });

  it('keeps objects as json variables', () => {
    expect(variablesFromJson('{ "filtro": { "estado": "A" } }')?.[0]).toMatchObject({ type: 'json', value: '{"estado":"A"}' });
  });

  it('returns null while the text is not a JSON object', () => {
    expect(variablesFromJson('{ "FechaInicio": ')).toBeNull();
    expect(variablesFromJson('[1, 2]')).toBeNull();
    expect(variablesFromJson('')).toEqual([]);
  });
});

describe('variablesToJson', () => {
  it('writes the table as the JSON editor text', () => {
    const text = variablesToJson([
      { key: 'FechaInicio', type: 'date', value: '$month_start' },
      { key: 'filtro', type: 'json', value: '{"estado":"A"}' },
      { key: '', type: 'string', value: 'sin nombre' },
    ]);
    expect(JSON.parse(text)).toEqual({ FechaInicio: '$month_start', filtro: { estado: 'A' } });
  });

  it('round-trips through the JSON editor', () => {
    const vars: FlowVariable[] = [{ key: 'a', type: 'number', value: 1, description: '' }, { key: 'b', type: 'date', value: '$today_iso', description: '' }];
    expect(variablesFromJson(variablesToJson(vars), vars)).toEqual(vars);
  });
});
