import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_QUERY_EXPORT_HEADER_COLOR,
  QUERY_EXPORT_COLOR_PRESETS,
  QUERY_EXPORT_HEADER_COLOR_KEY,
  buildExportColumns,
  defaultQueryExportFileName,
  loadQueryExportHeaderColor,
  sanitizeFileName,
  saveQueryExportHeaderColor,
  selectExportRows,
} from './queryExport';
import { normalizeHexColor } from './exportUtils';

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeFileName', () => {
  it('removes characters that are not valid in file names and turns spaces into dashes', () => {
    expect(sanitizeFileName('Ventas: mensuales/2026?')).toBe('Ventas-mensuales2026');
    expect(sanitizeFileName('a\\b*c"d<e>f|g')).toBe('abcdefg');
  });

  it('trims leading and trailing dots and dashes and returns empty when nothing is left', () => {
    expect(sanitizeFileName('  ..  ')).toBe('');
    expect(sanitizeFileName('.-consulta-.')).toBe('consulta');
  });

  it('limits the length to 120 characters', () => {
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(120);
  });
});

describe('defaultQueryExportFileName', () => {
  it('combines the sanitized query name with the local date as yyyymmdd', () => {
    expect(defaultQueryExportFileName('Ventas mensuales', new Date(2026, 10, 11))).toBe('consulta-Ventas-mensuales-20261111');
  });

  it('uses a generic name when the query has no name', () => {
    expect(defaultQueryExportFileName(undefined, new Date(2026, 0, 5))).toBe('consulta-resultados-20260105');
    expect(defaultQueryExportFileName('  ', new Date(2026, 0, 5))).toBe('consulta-resultados-20260105');
  });
});

describe('selectExportRows', () => {
  const all = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
  const page = all.slice(50, 100);

  it('exports every row when the scope is all rows', () => {
    expect(selectExportRows('all', all, page)).toHaveLength(120);
  });

  it('exports only the current page when the scope is page', () => {
    const rows = selectExportRows('page', all, page);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({ id: 51 });
  });
});

describe('buildExportColumns', () => {
  it('keeps the column order and uses each name as its own key', () => {
    expect(buildExportColumns(['cliente.id', 'total'])).toEqual([
      { header: 'cliente.id', key: 'cliente.id' },
      { header: 'total', key: 'total' },
    ]);
  });
});

describe('header color preferences', () => {
  it('has only valid presets, with the default among them', () => {
    for (const preset of QUERY_EXPORT_COLOR_PRESETS) {
      expect(normalizeHexColor(preset.hex)).toBe(preset.hex);
    }
    expect(QUERY_EXPORT_COLOR_PRESETS.map(p => p.hex)).toContain(DEFAULT_QUERY_EXPORT_HEADER_COLOR);
  });

  it('loads the saved color and falls back to the default when none or an invalid value is stored', () => {
    stubLocalStorage({ [QUERY_EXPORT_HEADER_COLOR_KEY]: '#166534' });
    expect(loadQueryExportHeaderColor()).toBe('#166534');

    stubLocalStorage({ [QUERY_EXPORT_HEADER_COLOR_KEY]: 'basura' });
    expect(loadQueryExportHeaderColor()).toBe(DEFAULT_QUERY_EXPORT_HEADER_COLOR);

    stubLocalStorage({});
    expect(loadQueryExportHeaderColor()).toBe(DEFAULT_QUERY_EXPORT_HEADER_COLOR);
  });

  it('persists the chosen color under the export key', () => {
    const store = stubLocalStorage({});
    saveQueryExportHeaderColor('#5B21B6');
    expect(store.get(QUERY_EXPORT_HEADER_COLOR_KEY)).toBe('#5B21B6');
  });

  it('falls back to the default when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadQueryExportHeaderColor()).toBe(DEFAULT_QUERY_EXPORT_HEADER_COLOR);
    expect(() => saveQueryExportHeaderColor('#5B21B6')).not.toThrow();
  });
});
