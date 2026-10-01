import mssql from 'mssql';
import { getDb } from '../db/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * User and password of a SQL Server connection. In order: the ones saved in the connection, then the
 * environment for its credential key (KEY_USER / KEY_PASSWORD, or DB_USER_KEY / DB_PASSWORD_KEY),
 * then DB_USER_DEFAULT / DB_PASSWORD_DEFAULT. Several connections can share one key, so one pair of
 * variables serves all of them.
 *
 * Fails with a clear message when nothing is found: guessing a login only produces a confusing
 * "Login failed" from the server (a flow imported from a JSON file arrives without credentials).
 */
export function resolveMssqlCredentials(
  connection: { name?: string; username?: string; password?: string; env_credential_key?: string | null },
  env: Record<string, string | undefined> = process.env
): { user: string; password: string } {
  const key = (connection.env_credential_key || 'SQLSERVER').trim();
  const pick = (...names: string[]) => names.map(n => env[n]).find(v => v !== undefined && v !== '');

  const user = connection.username || pick(`${key}_USER`, `DB_USER_${key}`, 'DB_USER_DEFAULT');
  const password = connection.password || pick(`${key}_PASSWORD`, `DB_PASSWORD_${key}`, 'DB_PASSWORD_DEFAULT');

  if (!user || !password) {
    const missing = [!user && 'usuario', !password && 'contraseña'].filter(Boolean).join(' y ');
    throw new Error(
      `La conexión «${connection.name || 'sin nombre'}» no tiene ${missing}. ` +
      `Configúralos en Conexiones o define ${key}_USER y ${key}_PASSWORD en backend/.env.`
    );
  }
  return { user, password };
}

export type CredentialSource = 'connection' | 'env' | 'missing';

/**
 * Where a SQL Server connection takes its credentials from, without revealing them: saved in the
 * connection, from backend/.env (and which variables), or missing. Shown in Configuración.
 */
export function describeMssqlCredentials(
  connection: { username?: string; password?: string; env_credential_key?: string | null },
  env: Record<string, string | undefined> = process.env
): { source: CredentialSource; key: string; variables: string[] } {
  const key = (connection.env_credential_key || 'SQLSERVER').trim();
  const has = (name: string) => env[name] !== undefined && env[name] !== '';
  // Same order resolveMssqlCredentials uses
  const userVar = [`${key}_USER`, `DB_USER_${key}`, 'DB_USER_DEFAULT'].find(has);
  const passVar = [`${key}_PASSWORD`, `DB_PASSWORD_${key}`, 'DB_PASSWORD_DEFAULT'].find(has);

  if (connection.username && connection.password) return { source: 'connection', key, variables: [] };
  if ((!connection.username && !userVar) || (!connection.password && !passVar)) {
    return { source: 'missing', key, variables: [`${key}_USER`, `${key}_PASSWORD`] };
  }
  const variables = [connection.username ? null : userVar, connection.password ? null : passVar].filter(Boolean) as string[];
  return { source: 'env', key, variables };
}

// Create connection config from SQLite database entry
function buildMssqlConfig(connection: any) {
  const { user, password } = resolveMssqlCredentials(connection);

  // Dynamic timeouts from system_settings with defaults
  let connTimeoutMs = 30000;
  let reqTimeoutMs = 300000;
  try {
    const db = getDb();
    const connSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'mssql_connection_timeout_seconds'").get() as any;
    if (connSetting?.value) {
      const parsed = parseInt(connSetting.value, 10);
      if (!isNaN(parsed) && parsed > 0) connTimeoutMs = parsed * 1000;
    }
    const reqSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'mssql_request_timeout_seconds'").get() as any;
    if (reqSetting?.value) {
      const parsed = parseInt(reqSetting.value, 10);
      if (!isNaN(parsed) && parsed > 0) reqTimeoutMs = parsed * 1000;
    }
  } catch {}

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
    connectionTimeout: connTimeoutMs,
    requestTimeout: reqTimeoutMs,
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
