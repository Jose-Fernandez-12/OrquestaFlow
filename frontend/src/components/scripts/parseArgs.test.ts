import { describe, it, expect } from 'vitest';
import { parseArgs } from './parseArgs';

describe('parseArgs', () => {
  it('splits on whitespace', () => {
    expect(parseArgs('  uno   dos\ttres ')).toEqual(['uno', 'dos', 'tres']);
    expect(parseArgs('')).toEqual([]);
  });

  it('groups quoted words and keeps empty quoted arguments', () => {
    expect(parseArgs(`--nombre "Jose Fernandez" 'a b' ""`)).toEqual(['--nombre', 'Jose Fernandez', 'a b', '']);
    expect(parseArgs('--ruta="C:/mis datos"')).toEqual(['--ruta=C:/mis datos']);
  });

  it('honours backslash escapes for quotes and spaces only', () => {
    expect(parseArgs('a\\ b "c\\"d"')).toEqual(['a b', 'c"d']);
    expect(parseArgs("'c:\\temp'")).toEqual(['c:\\temp']);
  });

  it('keeps Windows paths as typed', () => {
    expect(parseArgs('C:\\datos\\entrada.csv "C:\\Mis datos\\salida.csv"')).toEqual(['C:\\datos\\entrada.csv', 'C:\\Mis datos\\salida.csv']);
  });
});
