import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { exportRoutes, toArgbColor, autoHeaderTextColor, safeFileName } from '../src/routes/export';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(exportRoutes, { prefix: '/api/export' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function exportExcel(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/export/excel', payload });
}

async function readWorkbook(body: Buffer) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as any);
  return workbook.getWorksheet('Resultados')!;
}

describe('toArgbColor', () => {
  it('convierte hex de 6 dígitos con o sin almohadilla a ARGB', () => {
    expect(toArgbColor('#1E293B')).toBe('FF1E293B');
    expect(toArgbColor('1e293b')).toBe('FF1E293B');
  });

  it('expande los colores de 3 dígitos', () => {
    expect(toArgbColor('#abc')).toBe('FFAABBCC');
  });

  it('rechaza valores inválidos', () => {
    expect(toArgbColor('zzz')).toBeNull();
    expect(toArgbColor('#12345')).toBeNull();
    expect(toArgbColor('#GGGGGG')).toBeNull();
    expect(toArgbColor(undefined)).toBeNull();
    expect(toArgbColor(123)).toBeNull();
  });
});

describe('autoHeaderTextColor', () => {
  it('usa texto blanco en fondos oscuros y oscuro en fondos claros', () => {
    expect(autoHeaderTextColor('FF1E293B')).toBe('FFFFFFFF');
    expect(autoHeaderTextColor('FFE8F0FE')).toBe('FF0F172A');
  });
});

describe('safeFileName', () => {
  it('elimina caracteres peligrosos y acentos', () => {
    expect(safeFileName('Ventas mensuales')).toBe('Ventas_mensuales');
    expect(safeFileName('Año "2026"/../x')).toBe('Ano_2026_x');
    expect(safeFileName('a\r\nb: c*')).toBe('a_b_c');
  });

  it('usa un nombre por defecto si queda vacío', () => {
    expect(safeFileName('')).toBe('export');
    expect(safeFileName(undefined)).toBe('export');
    expect(safeFileName('///')).toBe('export');
  });
});

describe('POST /api/export/excel', () => {
  const columns = ['id', 'cliente'];
  const rows = [
    { id: 1, cliente: 'Ana' },
    { id: 2, cliente: 'Luis Fernández con un nombre bastante largo' },
  ];

  it('aplica el color de cabecera elegido a la fila 1 con texto automático', async () => {
    const res = await exportExcel({ columns, rows, fileName: 'consulta', headerColor: '#2563EB' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="consulta.xlsx"');

    const sheet = await readWorkbook(res.rawPayload);
    const headerRow = sheet.getRow(1);
    expect(headerRow.height).toBe(24);
    expect(sheet.getCell('A1').value).toBe('Id');
    expect(sheet.getCell('B1').value).toBe('Cliente');
    for (const ref of ['A1', 'B1']) {
      const cell = sheet.getCell(ref);
      expect((cell.fill as any).fgColor.argb).toBe('FF2563EB');
      expect(cell.font?.bold).toBe(true);
      expect((cell.font?.color as any).argb).toBe('FFFFFFFF');
      expect(cell.alignment?.vertical).toBe('middle');
    }
    expect(sheet.getCell('A2').value).toBe(1);
    expect(sheet.getCell('B3').value).toBe('Luis Fernández con un nombre bastante largo');
  });

  it('usa texto oscuro cuando el fondo es claro', async () => {
    const res = await exportExcel({ columns, rows, headerColor: 'E8F0FE' });
    const sheet = await readWorkbook(res.rawPayload);
    expect((sheet.getCell('A1').font?.color as any).argb).toBe('FF0F172A');
  });

  it('respeta headerTextColor cuando se envía explícitamente', async () => {
    const res = await exportExcel({ columns, rows, headerColor: '#1E293B', headerTextColor: '#FACC15' });
    const sheet = await readWorkbook(res.rawPayload);
    expect((sheet.getCell('A1').font?.color as any).argb).toBe('FFFACC15');
  });

  it('usa el color por defecto si el color es inválido o no se envía', async () => {
    const invalid = await readWorkbook((await exportExcel({ columns, rows, headerColor: 'no-es-color' })).rawPayload);
    expect((invalid.getCell('A1').fill as any).fgColor.argb).toBe('FF1E293B');

    const missing = await readWorkbook((await exportExcel({ columns, rows })).rawPayload);
    expect((missing.getCell('A1').fill as any).fgColor.argb).toBe('FF1E293B');
    expect((missing.getCell('A1').font?.color as any).argb).toBe('FFFFFFFF');
  });

  it('ajusta el ancho de columna al contenido, con un máximo', async () => {
    const longRows = [{ id: 1, cliente: 'x'.repeat(200) }];
    const sheet = await readWorkbook((await exportExcel({ columns, rows: longRows })).rawPayload);
    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(12);
    expect(sheet.getColumn(2).width).toBe(60);
  });

  it('limpia el nombre de archivo para la cabecera Content-Disposition', async () => {
    const res = await exportExcel({ columns, rows, fileName: 'mi "consulta"\r\n; evil.xlsx' });
    expect(res.headers['content-disposition']).toBe('attachment; filename="mi_consulta_evil_xlsx.xlsx"');
  });

  it('responde 400 si columns o rows no son listas válidas', async () => {
    expect((await exportExcel({ columns: 'id', rows })).statusCode).toBe(400);
    expect((await exportExcel({ columns, rows: null })).statusCode).toBe(400);
    expect((await exportExcel({ columns: [1, 2], rows })).statusCode).toBe(400);
  });
});
