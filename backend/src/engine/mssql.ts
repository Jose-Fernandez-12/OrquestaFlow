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
  
  const user = process.env[`DB_USER_${key}`] || process.env.DB_USER_DEFAULT || 'sa';
  const password = process.env[`DB_PASSWORD_${key}`] || process.env.DB_PASSWORD_DEFAULT || 'SecretPassword123!';

  return {
    user,
    password,
    server: connection.host,
    database: connection.database_name,
    port: Number(connection.port || 1433),
    options: {
      encrypt: false, // Local servers usually don't force encrypt
      trustServerCertificate: true,
    },
    connectionTimeout: 5000,
    requestTimeout: 15000,
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
    let parsedSql = sqlText;
    
    Object.keys(params).forEach(key => {
      const val = params[key];
      // Replace :param with @param
      parsedSql = parsedSql.replace(new RegExp(`:${key}\\b`, 'g'), `@${key}`);
      request.input(key, val);
    });

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
