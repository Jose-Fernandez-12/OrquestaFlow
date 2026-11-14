import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HEADER_COLOR,
  buildExcelExportBody,
  buildExportRows,
  fileNameFromDisposition,
  headerTextColorFor,
  loadHeaderColor,
  normalizeHexColor,
} from './queryExcelExport';

describe('normalizeHexColor', () => {
  it('normaliza hex con o sin almohadilla y de 3 dígitos a #RRGGBB en mayúsculas', () => {
    expect(normalizeHexColor('#1e293b')).toBe('#1E293B');
    expect(normalizeHexColor('1E293B')).toBe('#1E293B');
    expect(normalizeHexColor(' #abc ')).toBe('#AABBCC');
  });

  it('devuelve null para valores que no son un color hexadecimal', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('rojo')).toBeNull();
  });
});

describe('headerTextColorFor', () => {
  it('usa texto claro sobre fondos oscuros y oscuro sobre fondos claros', () => {
    expect(headerTextColorFor('#1E293B')).toBe('#FFFFFF');
    expect(headerTextColorFor('#2563EB')).toBe('#FFFFFF');
    expect(headerTextColorFor('#E8F0FE')).toBe('#0F172A');
  });
});

describe('loadHeaderColor', () => {
  it('usa el color por defecto cuando no hay localStorage disponible', () => {
    expect(loadHeaderColor()).toBe(DEFAULT_HEADER_COLOR);
  });
});

describe('buildExportRows', () => {
  it('conserva solo las columnas visibles y convierte valores no escalares', () => {
    const rows = [{ id: 1, nombre: 'Ana', extra: 'oculta', meta: { a: 1 }, vacio: undefined }];
    expect(buildExportRows(['id', 'nombre', 'meta', 'vacio'], rows)).toEqual([
      { id: 1, nombre: 'Ana', meta: '{"a":1}', vacio: null },
    ]);
  });
});

describe('buildExcelExportBody', () => {
  it('construye el cuerpo de la petición con el color elegido', () => {
    const body = buildExcelExportBody(['id'], [{ id: 7 }], 'Ventas', '#059669');
    expect(body).toEqual({ columns: ['id'], rows: [{ id: 7 }], fileName: 'Ventas', headerColor: '#059669' });
  });

  it('usa consulta_resultados cuando el nombre está vacío', () => {
    expect(buildExcelExportBody(['id'], [], '   ', '#059669').fileName).toBe('consulta_resultados');
  });
});

describe('fileNameFromDisposition', () => {
  it('lee el nombre de archivo que envía el servidor', () => {
    expect(fileNameFromDisposition('attachment; filename="Ventas_mensuales.xlsx"')).toBe('Ventas_mensuales.xlsx');
  });

  it('usa un nombre por defecto si la cabecera no está o no tiene nombre', () => {
    expect(fileNameFromDisposition(null)).toBe('consulta_resultados.xlsx');
    expect(fileNameFromDisposition('attachment')).toBe('consulta_resultados.xlsx');
  });
});
