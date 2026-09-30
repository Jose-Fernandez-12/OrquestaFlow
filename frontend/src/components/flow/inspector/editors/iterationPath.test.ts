import { describe, it, expect } from 'vitest';
import { toIterationPath } from './iterationPath';

describe('toIterationPath', () => {
  it('maps an element of the iterated list to _item', () => {
    expect(toIterationPath('FormatearDatos._data[0]')).toBe('_item');
  });

  it('maps fields of the element, keeping nested lists', () => {
    expect(toIterationPath('FormatearDatos._data[0].codigoEds')).toBe('_item.codigoEds');
    expect(toIterationPath('FormatearDatos._data[2].numeroDocumentos[1]')).toBe('_item.numeroDocumentos[1]');
    expect(toIterationPath('FormatearDatos._data[0].identificadoresTurno.13111122103419')).toBe('_item.identificadoresTurno.13111122103419');
  });

  it('maps the list itself to _item', () => {
    expect(toIterationPath('FormatearDatos._data', true)).toBe('_item');
  });

  it('keeps the last key when there is no list', () => {
    expect(toIterationPath('Login.token')).toBe('_item.token');
  });
});
