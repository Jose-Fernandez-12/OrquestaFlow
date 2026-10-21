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

/** Timeouts from Configuración (system_settings), read again on every query so changes apply at once. */
export function readMssqlTimeouts(): { connectionMs: number; requestMs: number } {
  let connectionMs = 30000;
  let requestMs = 300000;
  try {
    const db = getDb();
    const read = (key: string) => {
      const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as any;
      const parsed = parseInt(row?.value, 10);
      return !isNaN(parsed) && parsed > 0 ? parsed * 1000 : null;
    };
    connectionMs = read('mssql_connection_timeout_seconds') ?? connectionMs;
    requestMs = read('mssql_request_timeout_seconds') ?? requestMs;
  } catch {}
  return { connectionMs, requestMs };
}

// Create connection config from SQLite database entry
function buildMssqlConfig(connection: any, connectionTimeoutMs: number) {
  const { user, password } = resolveMssqlCredentials(connection);

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
    connectionTimeout: connectionTimeoutMs,
    // 0 = no driver timeout. A pool keeps the config it was created with, so a timeout here would
    // ignore later changes in Configuración and would not count the wait for a free connection.
    // executeMssqlQuery enforces the current request timeout on each query instead.
    requestTimeout: 0,
  };
}

// Global cache for connection pools to avoid reconnecting and destroying pools per query.
// The promise is cached so concurrent queries share one pool instead of each opening its own.
const poolCache = new Map<string, { pool: Promise<mssql.ConnectionPool>; connectionTimeout: number }>();

async function getOrCreatePool(config: any): Promise<mssql.ConnectionPool> {
  const cacheKey = `${config.server}:${config.port || 1433}:${config.database}:${config.user}`;
  const cached = poolCache.get(cacheKey);

  if (cached && cached.connectionTimeout === config.connectionTimeout) {
    try {
      const pool = await cached.pool;
      if (pool.connected) return pool;
    } catch {}
  }
  // Another query already replaced it while this one waited
  const current = poolCache.get(cacheKey);
  if (current && current !== cached) return getOrCreatePool(config);

  if (cached) {
    poolCache.delete(cacheKey);
    // close() waits for the queries still running on the old pool before closing it
    cached.pool.then(pool => pool.close()).catch(() => {});
  }
  const pool = new mssql.ConnectionPool(config).connect();
  poolCache.set(cacheKey, { pool, connectionTimeout: config.connectionTimeout });
  pool.catch(() => {
    if (poolCache.get(cacheKey)?.pool === pool) poolCache.delete(cacheKey);
  });
  return pool;
}

export async function closeAllMssqlPools(): Promise<void> {
  for (const [key, entry] of poolCache.entries()) {
    try {
      const pool = await entry.pool;
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

export interface MssqlQueryOptions {
  /** Registers the request so cancelMssqlQuery(executionId) can stop it (SQL editor) */
  executionId?: string;
  /** Cancels the query on the server when aborted (flow stopped) */
  signal?: AbortSignal;
}

export async function executeMssqlQuery(
  connectionId: string,
  sqlText: string,
  params: Record<string, any> = {},
  options: string | MssqlQueryOptions = {}
) {
  const { executionId, signal }: MssqlQueryOptions = typeof options === 'string' ? { executionId: options } : options;
  const stoppedByUser = () => new Error('Ejecución detenida por el usuario');
  if (signal?.aborted) throw stoppedByUser();

  const db = getDb();
  const connInfo = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as any;
  if (!connInfo) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  // The time limit covers the whole query, including the wait for a free connection of the pool
  const timeouts = readMssqlTimeouts();
  const startedAt = Date.now();
  const config = buildMssqlConfig(connInfo, timeouts.connectionMs);

  // Connect and run query using cached pool
  const pool = await getOrCreatePool(config);
  if (signal?.aborted) throw stoppedByUser();
  const request = pool.request();
  if (executionId) {
    registerActiveMssqlRequest(executionId, request);
  }

  // Timeout or stop: cancel the query on the server (attention) and fail right away, without waiting
  // for the server to confirm, so the node never stays running past its limit
  let stopError: Error | null = null;
  let rejectStop: (err: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  stopped.catch(() => {});
  const stop = (err: Error) => {
    if (stopError) return;
    stopError = err;
    try {
      request.cancel();
    } catch {}
    rejectStop(err);
  };
  const seconds = Math.round(timeouts.requestMs / 1000);
  const timer = setTimeout(() => {
    const err: any = new Error(
      `La consulta superó el tiempo límite de ${seconds} s (Configuración › SQL Server) y se canceló en el servidor.`
    );
    err.code = 'ETIMEOUT';
    stop(err);
  }, Math.max(0, timeouts.requestMs - (Date.now() - startedAt)));
  const onAbort = () => stop(stoppedByUser());
  signal?.addEventListener('abort', onAbort, { once: true });

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

    const running = request.query(parsedSql);
    // Once stopped, the late "Canceled" error of the query is expected and not reported
    running.catch(() => {});
    const result = await Promise.race([running, stopped]);
    return {
      columns: result.recordset && result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [],
      rows: result.recordset || [],
      rowCount: result.rowsAffected[0] || 0
    };
  } catch (err: any) {
    if (stopError) {
      console.log(`Query stopped for ${executionId || connectionId}: ${(stopError as Error).message}`);
      throw stopError;
    }
    if (err && (err.code === 'ECANCEL' || err.message?.includes('Canceled') || err.message?.includes('cancelled') || err.message?.includes('abort'))) {
      console.log(`Query execution cancelled for ${executionId || connectionId}`);
    } else {
      console.error("MSSQL Query Error:", err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (executionId) {
      unregisterActiveMssqlRequest(executionId, request);
    }
  }
}
