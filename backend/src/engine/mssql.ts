import mssql from 'mssql';
import { getDb } from '../db/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Create connection config from SQLite database entry
function buildMssqlConfig(connection: any) {
  // Map environment credential keys. 
  // User quote: "hay multiples conexiones, pero 1 de ellas comparte el mismo usuario y contraseña, y solo 2 distintas"
  // So we check process.env[env_credential_key + '_USER'] & process.env[env_credential_key + '_PASSWORD']
  const key = connection.env_credential_key || 'SQLSERVER';
  
  const user = connection.username || process.env[`DB_USER_${key}`] || process.env.DB_USER_DEFAULT || 'sa';
  const password = connection.password || process.env[`DB_PASSWORD_${key}`] || process.env.DB_PASSWORD_DEFAULT || 'SecretPassword123!';

  return {
    user,
    password,
    server: connection.host,
    database: connection.database_name,
    port: Number(connection.port || 1433),
    options: {
      encrypt: connection.host.includes('.database.windows.net') || false, // Azure SQL requires encryption
      trustServerCertificate: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 300000,
  };
}

export async function executeMssqlQuery(connectionId: string, sqlText: string, params: Record<string, any> = {}) {
  const db = getDb();
  const connInfo = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as any;
  if (!connInfo) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const config = buildMssqlConfig(connInfo);
  
  // Connect and run query
  const pool = await mssql.connect(config);
  try {
    const request = pool.request();

    // Map named parameters from :param to MS SQL format (@param)
    // MS SQL does not support colon parameters natively, so we replace them and inject variables.
    // Replace :param inside string literals (like '%:param%') with string concatenation
    let parsedSql = sqlText.replace(/'(%?):([a-zA-Z0-9_]+)(%?)'/g, (match, leading, paramName, trailing) => {
      let concatArgs = [];
      if (leading) concatArgs.push("'%'");
      concatArgs.push(`@${paramName}`);
      if (trailing) concatArgs.push("'%'");
      if (concatArgs.length === 1) return `@${paramName}`;
      return concatArgs.join(' + ');
    });
    
    // Replace remaining normal :param with @param
    parsedSql = parsedSql.replace(/(?<!')(:[a-zA-Z0-9_]+)\b/g, (match) => {
      return '@' + match.substring(1);
    });

    // Extract all unique parameters from original SQL
    const paramMatches = [...sqlText.matchAll(/:([a-zA-Z0-9_]+)\b/g)];
    const uniqueParams = [...new Set(paramMatches.map(m => m[1]))];

    uniqueParams.forEach(key => {
      let val = params[key];
      // Fallback to empty string if parameter is missing, so it doesn't crash execution
      if (val === undefined || val === null) {
        val = '';
      }
      
      // Handle comma-separated lists for IN clauses (e.g. 'A','B')
      if (typeof val === 'string' && val.includes(',') && (val.includes("'") || val.includes('"'))) {
        const elements = val.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        const tokenRegex = new RegExp(`@${key}\\b`, 'g');
        if (parsedSql.match(tokenRegex)) {
          const replacementTokens = elements.map((_, i) => `@${key}_${i}`);
          parsedSql = parsedSql.replace(tokenRegex, replacementTokens.join(', '));
          
          elements.forEach((el, i) => {
            request.input(`${key}_${i}`, el);
          });
          return;
        }
      }

      request.input(key, val);
    });

    console.log("EXECUTING SQL:", parsedSql);
    console.log("PARAMETERS:", request.parameters);

    const result = await request.query(parsedSql);
    return {
      columns: result.recordset && result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [],
      rows: result.recordset || [],
      rowCount: result.rowsAffected[0] || 0
    };
  } finally {
    await pool.close();
  }
}
