import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { basename, join, resolve } from 'path';

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: file => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
    }).catch(err => {
      sqlJsPromise = null;
      throw err;
    });
  }
  return sqlJsPromise;
}

export function validateSqliteFilePath(filePath: string): string {
  const raw = String(filePath ?? '').trim();
  if (!raw) {
    throw new Error('La ruta del archivo SQLite es obligatoria');
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)) {
    throw new Error('Ruta SQLite no permitida (path traversal detectado)');
  }
  const resolved = resolve(raw);
  if (basename(resolved).toLowerCase() === 'orquesta.sqlite') {
    throw new Error('No se permite acceder a la base de datos interna orquesta.sqlite');
  }
  return resolved;
}

export async function executeSqliteQuery(filePath: string, sqlText: string, params: Record<string, any> = {}) {
  const safePath = validateSqliteFilePath(filePath);
  if (!existsSync(safePath)) {
    throw new Error(`Archivo SQLite no encontrado en la ruta: ${filePath}`);
  }

  const SQL = await getSqlJs();

  const fileBuffer = readFileSync(safePath);
  const db = new SQL.Database(fileBuffer);

  try {
    // Convert common LIKE patterns with parameters inside quotes to string concatenation
    // Support #param_param and legacy :param
    let parsedSql = sqlText.replace(/'(%?)#param_([a-zA-Z0-9_]+)(%?)'/g, (match, leading, paramName, trailing) => {
      let parts = [];
      if (leading) parts.push("'%'");
      parts.push(`:${paramName}`);
      if (trailing) parts.push("'%'");
      if (parts.length === 1) return `:${paramName}`;
      return parts.join(' || ');
    });

    parsedSql = parsedSql.replace(/(^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match, prefix, paramName) => {
      return prefix + ':' + paramName;
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
