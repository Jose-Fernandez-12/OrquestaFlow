import { FastifyInstance } from 'fastify';

const DEFAULT_HEADER_COLOR = 'FF1E293B';
const LIGHT_TEXT_COLOR = 'FFFFFFFF';
const DARK_TEXT_COLOR = 'FF0F172A';
const MIN_COLUMN_WIDTH = 12;
const MAX_COLUMN_WIDTH = 60;
const MAX_FILE_NAME_LENGTH = 100;

interface ExcelExportBody {
  columns: string[];
  rows: Record<string, unknown>[];
  fileName?: string;
  headerColor?: string;
  headerTextColor?: string;
}

/** '#1E293B', '1E293B', '#abc' o 'abc' → 'FF1E293B' (ARGB de ExcelJS). Devuelve null si no es válido. */
export function toArgbColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return `FF${hex.split('').map(c => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(hex)) return `FF${hex}`.toUpperCase();
  return null;
}

/** Texto claro sobre fondos oscuros y oscuro sobre fondos claros, según la luminancia percibida */
export function autoHeaderTextColor(argb: string): string {
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 160 ? DARK_TEXT_COLOR : LIGHT_TEXT_COLOR;
}

/** Nombre seguro para Content-Disposition: solo ASCII alfanumérico, guion y guion bajo */
export function safeFileName(input: unknown): string {
  const base = typeof input === 'string' ? input : '';
  const clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_FILE_NAME_LENGTH);
  return clean || 'export';
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // Export data as Excel
  app.post<{ Body: ExcelExportBody }>(
    '/excel',
    async (request, reply) => {
      const { columns, rows, fileName, headerColor, headerTextColor } = request.body ?? ({} as Partial<ExcelExportBody>);

      if (!Array.isArray(columns) || !columns.every(col => typeof col === 'string') || !Array.isArray(rows)) {
        return reply.status(400).send({ error: 'columns debe ser una lista de textos y rows una lista de filas' });
      }

      const fillArgb = toArgbColor(headerColor) ?? DEFAULT_HEADER_COLOR;
      const textArgb = toArgbColor(headerTextColor) ?? autoHeaderTextColor(fillArgb);

      try {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Resultados');

        // Header
        sheet.columns = columns.map(col => ({
          header: col.charAt(0).toUpperCase() + col.slice(1),
          key: col,
          width: MIN_COLUMN_WIDTH
        }));

        // Data rows
        for (const row of rows) {
          sheet.addRow(row);
        }

        // Ancho según el contenido más largo de cada columna (cabecera incluida)
        const maxLengths: number[] = columns.map(() => 0);
        sheet.eachRow(row => {
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            maxLengths[colNumber - 1] = Math.max(maxLengths[colNumber - 1], cell.text.length);
          });
        });
        maxLengths.forEach((maxLength, index) => {
          sheet.getColumn(index + 1).width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, maxLength + 2));
        });

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
          cell.font = { bold: true, size: 11, color: { argb: textArgb } };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        const buffer = await workbook.xlsx.writeBuffer();

        reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${safeFileName(fileName)}.xlsx"`)
          .send(Buffer.from(buffer as ArrayBuffer));
      } catch {
        reply.status(500).send({ error: 'Error al generar el archivo Excel' });
      }
    }
  );

  // Export data as CSV
  app.post<{ Body: { columns: string[]; rows: Record<string, unknown>[]; separator?: string; fileName?: string } }>(
    '/csv',
    async (request, reply) => {
      const { columns, rows, separator = ',', fileName = 'export' } = request.body;

      try {
        const header = columns.join(separator);
        const lines = rows.map(row =>
          columns.map(col => {
            const val = row[col];
            const str = val === null || val === undefined ? '' : String(val);
            // Escape fields containing separator, quotes, or newlines
            if (str.includes(separator) || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          }).join(separator)
        );

        const csv = [header, ...lines].join('\n');

        reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${fileName}.csv"`)
          .send(csv);
      } catch {
        reply.status(500).send({ error: 'Error al generar el archivo CSV' });
      }
    }
  );
}
