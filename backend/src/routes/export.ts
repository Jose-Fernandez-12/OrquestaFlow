import { FastifyInstance } from 'fastify';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // Export data as Excel
  app.post<{ Body: { columns: string[]; rows: Record<string, unknown>[]; fileName?: string } }>(
    '/excel',
    async (request, reply) => {
      const { columns, rows, fileName = 'export' } = request.body;

      try {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Resultados');

        // Header
        sheet.columns = columns.map(col => ({
          header: col.charAt(0).toUpperCase() + col.slice(1),
          key: col,
          width: 20
        }));

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, size: 11 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F0FE' }
        };

        // Data rows
        for (const row of rows) {
          sheet.addRow(row);
        }

        const buffer = await workbook.xlsx.writeBuffer();

        reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${fileName}.xlsx"`)
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
