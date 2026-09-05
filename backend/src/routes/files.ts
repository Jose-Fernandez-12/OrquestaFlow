import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { v4 as uuid } from 'uuid';

export async function parseExcelOrCsvFile(filePath: string, sheetName?: string): Promise<{
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
  sheets: string[];
}> {
  const ext = path.extname(filePath).toLowerCase();
  const workbook = new ExcelJS.Workbook();
  const sheets: string[] = [];

  if (ext === '.csv' || ext === '.txt') {
    // Read as CSV
    await workbook.csv.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { columns: [], rows: [], totalRows: 0, sheets: [] };
    }

    const columns: string[] = [];
    const rows: Record<string, any>[] = [];

    worksheet.eachRow((row, rowNumber) => {
      const values = (row.values as any[]) || [];
      const rowArr = values.slice(1).map(v => (v === null || v === undefined ? '' : String(v).trim()));
      
      if (rowNumber === 1) {
        rowArr.forEach((h, idx) => {
          columns.push(h ? String(h) : `col_${idx + 1}`);
        });
      } else {
        const rowObj: Record<string, any> = {};
        columns.forEach((col, idx) => {
          rowObj[col] = rowArr[idx] !== undefined ? rowArr[idx] : '';
        });
        rows.push(rowObj);
      }
    });

    return { columns, rows, totalRows: rows.length, sheets: ['CSV'] };
  } else {
    // Read as Excel (.xlsx)
    await workbook.xlsx.readFile(filePath);
    workbook.worksheets.forEach(ws => sheets.push(ws.name));

    const worksheet = sheetName 
      ? workbook.getWorksheet(sheetName) || workbook.worksheets[0] 
      : workbook.worksheets[0];

    if (!worksheet) {
      return { columns: [], rows: [], totalRows: 0, sheets };
    }

    const columns: string[] = [];
    const rows: Record<string, any>[] = [];

    worksheet.eachRow((row, rowNumber) => {
      const values = (row.values as any[]) || [];
      const rowArr = values.slice(1).map(v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && v.text) return v.text;
        if (typeof v === 'object' && v.result) return v.result;
        return v;
      });

      if (rowNumber === 1) {
        rowArr.forEach((h, idx) => {
          columns.push(h ? String(h).trim() : `col_${idx + 1}`);
        });
      } else {
        const rowObj: Record<string, any> = {};
        let hasContent = false;
        columns.forEach((col, idx) => {
          const val = rowArr[idx] !== undefined ? rowArr[idx] : '';
          rowObj[col] = val;
          if (val !== '') hasContent = true;
        });
        if (hasContent) {
          rows.push(rowObj);
        }
      }
    });

    return { columns, rows, totalRows: rows.length, sheets };
  }
}

export async function fileManagerRoutes(app: FastifyInstance): Promise<void> {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Upload file (.xlsx, .xls, .csv)
  app.post('/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No se recibio ningun archivo' });
    }

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.xlsx', '.xls', '.csv', '.txt'].includes(ext)) {
      return reply.status(400).send({ error: 'Formato no soportado. Debe ser un archivo .xlsx, .xls o .csv' });
    }

    const uniqueId = uuid().slice(0, 8);
    const sanitizedOrigName = path.basename(data.filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFileName = `${sanitizedOrigName}_${uniqueId}${ext}`;
    const targetPath = path.join(uploadsDir, storedFileName);

    // Save buffer
    const buffer = await data.toBuffer();
    fs.writeFileSync(targetPath, buffer);

    try {
      const parsed = await parseExcelOrCsvFile(targetPath);
      return {
        data: {
          originalName: data.filename,
          storedFileName,
          filePath: `uploads/${storedFileName}`,
          format: ext === '.csv' || ext === '.txt' ? 'CSV' : 'Excel',
          sizeBytes: buffer.length,
          sheets: parsed.sheets,
          columns: parsed.columns,
          totalRows: parsed.totalRows,
          sampleRows: parsed.rows.slice(0, 5)
        }
      };
    } catch (err: any) {
      return reply.status(500).send({ 
        error: `Error al procesar el archivo: ${err.message}`,
        filePath: `uploads/${storedFileName}`,
        storedFileName
      });
    }
  });

  // Preview data from an existing file in uploads or data folder
  app.get<{ Querystring: { filePath: string; sheetName?: string; limit?: string } }>('/preview', async (request, reply) => {
    const { filePath, sheetName, limit = '100' } = request.query;
    if (!filePath) {
      return reply.status(400).send({ error: 'filePath es obligatorio' });
    }

    // Resolve path safely within cwd
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      return reply.status(404).send({ error: `Archivo no encontrado: ${filePath}` });
    }

    try {
      const parsed = await parseExcelOrCsvFile(fullPath, sheetName);
      const parsedLimit = Math.min(parseInt(limit, 10) || 100, 1000);

      return {
        data: {
          columns: parsed.columns,
          rows: parsed.rows.slice(0, parsedLimit),
          totalRows: parsed.totalRows,
          sheets: parsed.sheets,
          fileName: path.basename(fullPath)
        }
      };
    } catch (err: any) {
      return reply.status(500).send({ error: `Error al leer archivo: ${err.message}` });
    }
  });
}
