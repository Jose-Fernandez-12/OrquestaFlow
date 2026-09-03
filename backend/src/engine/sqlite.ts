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
    // Convert common LIKE patterns with parameters inside quotes to string concatenation
    let parsedSql = sqlText.replace(/'(%?):([a-zA-Z0-9_]+)(%?)'/g, (match, leading, paramName, trailing) => {
      let parts = [];
      if (leading) parts.push("'%'");
      parts.push(`:${paramName}`);
      if (trailing) parts.push("'%'");
      if (parts.length === 1) return `:${paramName}`;
      return parts.join(' || ');
    });
    
    // Map params and expand list parameters for IN clauses
    const binds: Record<string, any> = {};
    Object.keys(params).forEach(k => {
      let val = params[k];
      
      // Handle comma-separated lists for IN clauses (e.g. 'A','B')
      if (typeof val === 'string' && val.includes(',') && (val.includes("'") || val.includes('"'))) {
        const elements = val.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        const tokenRegex = new RegExp(`:${k}\\b`, 'g');
        if (parsedSql.match(tokenRegex)) {
          const replacementTokens = elements.map((_, i) => `:${k}_${i}`);
          parsedSql = parsedSql.replace(tokenRegex, replacementTokens.join(', '));
          elements.forEach((el, i) => {
            binds[`:${k}_${i}`] = el;
          });
          return;
        }
      }
      
      binds[`:${k}`] = val;
      binds[`@${k}`] = val;
      binds[`$${k}`] = val;
    });

    const stmt = db.prepare(parsedSql);
    try {
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
