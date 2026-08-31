import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function executeSqliteQuery(filePath: string, sqlText: string, params: Record<string, any> = {}) {
  if (!existsSync(filePath)) {
    throw new Error(`Archivo SQLite no encontrado en la ruta: ${filePath}`);
  }

  const SQL = await initSqlJs({
    locateFile: file => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  });

  const fileBuffer = readFileSync(filePath);
  const db = new SQL.Database(fileBuffer);

  try {
    const stmt = db.prepare(sqlText);
    try {
      // Map params if any (SQLite supports object binding for keys starting with :, @, $)
      const binds: Record<string, any> = {};
      Object.keys(params).forEach(k => {
        binds[`:${k}`] = params[k];
        binds[`@${k}`] = params[k];
        binds[`$${k}`] = params[k];
      });

      stmt.bind(binds);

      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        columns,
        rows,
        rowCount: rows.length
      };
    } finally {
      stmt.free();
    }
  } finally {
    db.close();
  }
}
