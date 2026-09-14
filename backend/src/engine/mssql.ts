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

// Global cache for connection pools to avoid reconnecting and destroying pools per query
const poolCache = new Map<string, mssql.ConnectionPool>();

async function getOrCreatePool(config: any): Promise<mssql.ConnectionPool> {
  const cacheKey = `${config.server}:${config.port || 1433}:${config.database}:${config.user}`;
  let pool = poolCache.get(cacheKey);

  if (!pool || !pool.connected) {
    if (pool) {
      try {
        await pool.close();
      } catch {}
    }
    pool = await new mssql.ConnectionPool(config).connect();
    poolCache.set(cacheKey, pool);
  }

  return pool;
}

export async function closeAllMssqlPools(): Promise<void> {
  for (const [key, pool] of poolCache.entries()) {
    try {
      if (pool.connected) {
        await pool.close();
      }
    } catch (e) {
      console.error(`Error closing MSSQL pool ${key}:`, e);
    }
  }
  poolCache.clear();
}

// Active MSSQL requests map by execution ID (e.g. logId)
const activeMssqlRequests = new Map<string, Set<mssql.Request>>();

export function registerActiveMssqlRequest(executionId: string, request: mssql.Request) {
  let requests = activeMssqlRequests.get(executionId);
  if (!requests) {
    requests = new Set();
    activeMssqlRequests.set(executionId, requests);
  }
  requests.add(request);
}

export function unregisterActiveMssqlRequest(executionId: string, request: mssql.Request) {
  const requests = activeMssqlRequests.get(executionId);
  if (requests) {
    requests.delete(request);
    if (requests.size === 0) {
      activeMssqlRequests.delete(executionId);
    }
  }
}

export function cancelMssqlQuery(executionId: string): boolean {
  const requests = activeMssqlRequests.get(executionId);
  if (!requests || requests.size === 0) {
    return false;
  }
  for (const req of requests) {
    try {
      req.cancel();
    } catch (err) {
      console.error(`Error cancelling request for ${executionId}:`, err);
    }
  }
  activeMssqlRequests.delete(executionId);
  return true;
}

export async function executeMssqlQuery(connectionId: string, sqlText: string, params: Record<string, any> = {}, executionId?: string) {
  const db = getDb();
  const connInfo = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as any;
  if (!connInfo) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const config = buildMssqlConfig(connInfo);
  
  // Connect and run query using cached pool
  const pool = await getOrCreatePool(config);
  const request = pool.request();
  if (executionId) {
    registerActiveMssqlRequest(executionId, request);
  }

  try {
    // Map named parameters from :param to MS SQL format (@param)
    // MS SQL does not support colon parameters natively, so we replace them and inject variables.
    // Replace #param_param inside string literals (like '%#param_param%') with string concatenation
    let parsedSql = sqlText.replace(/'(%?)#param_([a-zA-Z0-9_]+)(%?)'/g, (match, leading, paramName, trailing) => {
      let concatArgs = [];
      if (leading) concatArgs.push("'%'");
      concatArgs.push(`@${paramName}`);
      if (trailing) concatArgs.push("'%'");
      if (concatArgs.length === 1) return `@${paramName}`;
      return concatArgs.join(' + ');
    });
    
    // Replace remaining normal #param_param with @param
    parsedSql = parsedSql.replace(/(^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match, prefix, paramName) => {
      return prefix + '@' + paramName;
    });

    // Extract all unique parameters from original SQL
    const paramMatches = [...sqlText.matchAll(/(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
    const uniqueParams = [...new Set(paramMatches.map(m => m[1]))];

    uniqueParams.forEach(key => {
      let val = params[key];
      // Fallback to empty string if parameter is missing, so it doesn't crash execution
      if (val === undefined || val === null) {
        val = '';
      }
      
      let isArray = Array.isArray(val);
      let elements = [];
      if (isArray) {
        elements = val;
      } else if (typeof val === 'string' && val.includes(',') && (val.includes("'") || val.includes('"'))) {
        isArray = true;
        elements = val.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      }

      if (isArray) {
        const tokenRegex = new RegExp(`@${key}\\b`, 'g');
        if (parsedSql.match(tokenRegex)) {
          const replacementTokens = elements.map((_: any, i: number) => `@${key}_${i}`);
          parsedSql = parsedSql.replace(tokenRegex, replacementTokens.join(', '));
          
          elements.forEach((el: any, i: number) => {
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
  } catch (err: any) {
    if (err && (err.code === 'ECANCEL' || err.message?.includes('Canceled') || err.message?.includes('cancelled') || err.message?.includes('abort'))) {
      console.log(`Query execution cancelled for ${executionId || connectionId}`);
    } else {
      console.error("MSSQL Query Error:", err);
    }
    throw err;
  } finally {
    if (executionId) {
      unregisterActiveMssqlRequest(executionId, request);
    }
  }
}
