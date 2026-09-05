import { getDb } from '../db/database.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import mssql from 'mssql';
import ExcelJS from 'exceljs';
import { parseExcelOrCsvFile } from '../routes/files.js';

export interface ActiveExecutionState {
  flowId: string;
  startTime: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  nodes: Record<string, { status: 'running' | 'completed' | 'error' | 'progress'; result?: any }>;
  abortController: AbortController;
  cancelReason?: string;
}

export const activeFlowExecutions = new Map<string, ActiveExecutionState>();

// Stop flow execution
export function stopFlowEngine(flowId: string, reason = 'Ejecución detenida por el usuario'): boolean {
  const current = activeFlowExecutions.get(flowId);
  if (!current || current.status !== 'running') {
    return false;
  }
  current.status = 'cancelled';
  current.cancelReason = reason;
  current.abortController.abort(reason);
  setTimeout(() => {
    activeFlowExecutions.delete(flowId);
  }, 30000);
  return true;
}

// Global execution wrapper with parallel dependency resolution
export async function executeFlowEngine(
  flowId: string,
  onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress', result?: any) => void
): Promise<Record<string, any>> {
  const db = getDb();
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
  if (!flow) throw new Error('Flow not found');

  const abortController = new AbortController();

  // Track active execution in memory
  activeFlowExecutions.set(flowId, {
    flowId,
    startTime: Date.now(),
    status: 'running',
    nodes: {},
    abortController
  });

  const notifyProgress = (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress', result?: any) => {
    const current = activeFlowExecutions.get(flowId);
    if (current) {
      current.nodes[nodeId] = { status, result };
    }
    if (onNodeProgress) {
      onNodeProgress(nodeId, status, result);
    }
  };

  const definition = JSON.parse(flow.definition || '{"nodes":[],"edges":[]}');
  const nodes: any[] = definition.nodes || [];
  const edges: any[] = definition.edges || [];

  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};

  nodes.forEach(node => {
    inDegree[node.id] = 0;
    adjList[node.id] = [];
  });

  edges.forEach(edge => {
    if (adjList[edge.source]) {
      adjList[edge.source].push(edge.target);
      inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
    }
  });

  const context: Record<string, any> = {};
  const runningPromises = new Map<string, Promise<void>>();
  const completedNodes = new Set<string>();
  const errorNodes = new Set<string>();

  return new Promise((resolve, reject) => {
    let hasError = false;

    abortController.signal.addEventListener('abort', () => {
      hasError = true;
      for (const nodeId of runningPromises.keys()) {
        notifyProgress(nodeId, 'error', { error: 'Nodo detenido' });
      }
      reject(new Error(activeFlowExecutions.get(flowId)?.cancelReason || 'Ejecución detenida por el usuario'));
    });

    const checkAndRun = () => {
      const current = activeFlowExecutions.get(flowId);
      if (hasError || current?.status === 'cancelled' || abortController.signal.aborted) {
        return; // Stop triggering new nodes if flow failed or cancelled
      }
      
      let allDone = true;

      nodes.forEach(node => {
        if (!completedNodes.has(node.id) && !errorNodes.has(node.id)) {
          allDone = false;
          
          if (inDegree[node.id] === 0 && !runningPromises.has(node.id)) {
            // Node is ready to run
            const p = (async () => {
              if (abortController.signal.aborted) {
                throw new Error('Ejecución detenida por el usuario');
              }
              notifyProgress(node.id, 'running');
              
              const delayMs = node.type === 'start' ? 150 : 800;
              await new Promise<void>((res, rej) => {
                if (abortController.signal.aborted) {
                  return rej(new Error('Ejecución detenida por el usuario'));
                }
                const t = setTimeout(res, delayMs);
                const onAbort = () => {
                  clearTimeout(t);
                  abortController.signal.removeEventListener('abort', onAbort);
                  rej(new Error('Ejecución detenida por el usuario'));
                };
                abortController.signal.addEventListener('abort', onAbort, { once: true });
              });

              if (abortController.signal.aborted) {
                throw new Error('Ejecución detenida por el usuario');
              }
              
              try {
                let output: any = {};
                switch (node.type) {
                  case 'start':
                    output = { msg: 'Flow started' };
                    break;
                  case 'httpGet':
                  case 'httpPost':
                  case 'httpRequest':
                    output = await executeHttpNode(node, context, notifyProgress, abortController.signal);
                    break;
                  case 'scraping':
                    output = await executeScrapingNode(node, context, abortController.signal);
                    break;
                  case 'export':
                    output = await executeExportNode(node, context);
                    break;
                  case 'timer':
                  case 'delay':
                    output = await executeTimerNode(node, (status, res) => notifyProgress(node.id, status, res), abortController.signal);
                    break;
                  case 'dataSource':
                  case 'fileSource':
                    output = await executeDataSourceNode(node, abortController.signal);
                    break;
                  default:
                    output = { warning: 'Unknown node type' };
                }

                context[node.id] = output;
                completedNodes.add(node.id);
                notifyProgress(node.id, 'completed', output);

                // Unlock dependents
                if (adjList[node.id]) {
                  adjList[node.id].forEach(depId => {
                    inDegree[depId]--;
                  });
                }
              } catch (err: any) {
                hasError = true;
                errorNodes.add(node.id);
                notifyProgress(node.id, 'error', { error: err.message });
                throw err;
              }
            })();

            runningPromises.set(node.id, p);
            
            p.then(() => {
              runningPromises.delete(node.id);
              checkAndRun();
            }).catch(err => {
              runningPromises.delete(node.id);
              const current = activeFlowExecutions.get(flowId);
              if (current && current.status !== 'cancelled') {
                current.status = 'error';
              }
              setTimeout(() => {
                activeFlowExecutions.delete(flowId);
              }, 30000);
              reject(err);
            });
          }
        }
      });

      if (allDone && runningPromises.size === 0) {
        const current = activeFlowExecutions.get(flowId);
        if (current && current.status !== 'cancelled') {
          current.status = 'completed';
        }
        setTimeout(() => {
          activeFlowExecutions.delete(flowId);
        }, 30000);
        resolve(context);
      }
    };

    checkAndRun();
  });
}

// Http Node Handler
async function executeHttpNode(
  node: any,
  context: Record<string, any>,
  onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress', result?: any) => void,
  signal?: AbortSignal
) {
  const iterateOver = node.data?.iterateOver;
  const iterateMode = node.data?.iterateMode;
  let itemsToIterate: any[] = [null]; // By default, run once with no item

  if (iterateOver && iterateOver.trim() !== '' && iterateOver.trim() !== '{{ID_NODO}}') {
    const resolved = resolveTemplate(context, iterateOver);
    if (Array.isArray(resolved)) {
      itemsToIterate = resolved;
    }
  }

  // Auto-detect: if iterateMode is enabled but array wasn't resolved, grab first array from context
  if (iterateMode && (itemsToIterate.length === 1 && itemsToIterate[0] === null)) {
    for (const ctxVal of Object.values(context)) {
      if (Array.isArray(ctxVal) && ctxVal.length > 0) {
        itemsToIterate = ctxVal;
        break;
      }
    }
  }

  const results = [];
  
  for (let i = 0; i < itemsToIterate.length; i++) {
    if (signal?.aborted) {
      throw new Error('Ejecución detenida por el usuario');
    }
    const item = itemsToIterate[i];
    
    // Create a localized context for this iteration
    const localContext = { ...context };
    if (item !== null) {
      localContext['_item'] = item;
    }
    
    let endpoint = node.data?.endpoint || '';
    if (endpoint.includes('storefront.com') || !endpoint.startsWith('http')) {
      results.push({
        status: "success",
        code: 200,
        data: { items: [{ id: "prod_01", name: "Laptop Pro", price: 1299.99, stock: 45 }] }
      });
      continue;
    }
    
    endpoint = resolveTemplate(localContext, endpoint) as string;

    if (node.data?.params && node.data.params.trim() !== '') {
      try {
        const parsed = JSON.parse(node.data.params);
        const paramsObj = resolveTemplate(localContext, parsed);
        const url = new URL(endpoint);
        for (const [k, v] of Object.entries(paramsObj)) {
          url.searchParams.append(k, String(v));
        }
        endpoint = url.toString();
      } catch (e) {
        console.error('Failed to parse query params', e);
      }
    }

    let method = node.data?.method || 'GET';
    if (node.type === 'httpPost') method = 'POST';

    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (node.data?.headers && node.data.headers.trim() !== '') {
      try {
        const parsedHeaders = JSON.parse(node.data.headers);
        headers = { ...headers, ...resolveTemplate(localContext, parsedHeaders) };
      } catch(e) {
        console.error('Failed to parse headers', e);
      }
    }

    const options: RequestInit = { method, headers, signal };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (node.data?.body && node.data.body.trim() !== '') {
        const bodyContent = node.data.body;
        const resolvedBody = resolveTemplate(localContext, bodyContent);
        if (resolvedBody === undefined || resolvedBody === null || resolvedBody === '') {
          // skip - no body
        } else if (typeof resolvedBody === 'object') {
          options.body = JSON.stringify(resolvedBody);
        } else {
          // It's a string - try to parse as JSON to validate/normalize it
          const strBody = String(resolvedBody);
          try {
            const parsed = JSON.parse(strBody);
            options.body = JSON.stringify(parsed);
          } catch {
            options.body = strBody;
          }
        }
      } else if (node.data?.payload) {
        options.body = JSON.stringify(resolveTemplate(localContext, node.data.payload) || {});
      }
    }

    const response = await fetch(endpoint, options);
    if (!response.ok) {
      throw new Error(`HTTP Request failed with status ${response.status}`);
    }

    const text = await response.text();
    try {
      results.push(JSON.parse(text));
    } catch {
      results.push({ text });
    }
    
    // Report progress
    if (itemsToIterate.length > 1 && onNodeProgress) {
      onNodeProgress(node.id, 'progress', { current: i + 1, total: itemsToIterate.length });
    }
  }

  // Return single response if not iterating, or array if iterating
  return itemsToIterate.length > 1 || iterateOver ? results : results[0];
}

// Scraping Node Handler (spawns Python script if configured)
async function executeScrapingNode(node: any, context: Record<string, any>, signal?: AbortSignal) {
  const scriptName = node.data?.script;
  if (!scriptName) {
    return { data: 'Simulated web scraping result' };
  }

  // Resolve script path
  const scriptPath = path.join(process.cwd(), 'scripts', scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script file not found: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Ejecución detenida por el usuario'));
    }

    const py = spawn('python', [scriptPath]);
    let stdout = '';
    let stderr = '';

    if (signal) {
      signal.addEventListener('abort', () => {
        try {
          py.kill('SIGTERM');
        } catch {}
        reject(new Error('Ejecución detenida por el usuario'));
      });
    }

    py.stdout.on('data', data => stdout += data.toString());
    py.stderr.on('data', data => stderr += data.toString());

    py.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}. Error: ${stderr}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ output: stdout });
        }
      }
    });
  });
}

// Helper: resolve a path like "nodeId[0].name" or "nodeId.data.items" from context
function resolvePath(context: Record<string, any>, pathStr: string): any {
  const tokens = pathStr.trim().split('.');
  let val: any = context;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (val === undefined || val === null) break;

    const bracketRe = /^([^\[]*?)\[(\d+|\*)\]$/;
    const bracketMatch = token.match(bracketRe);
    
    if (bracketMatch) {
      const key = bracketMatch[1];
      const idxOrStar = bracketMatch[2];
      
      if (key) val = val[key];
      
      if (val !== undefined && val !== null) {
        if (idxOrStar === '*') {
          if (Array.isArray(val)) {
            const remainingTokens = tokens.slice(i + 1);
            if (remainingTokens.length === 0) return val;
            return val.map(item => resolvePath({ item }, ['item', ...remainingTokens].join('.')));
          }
          break;
        } else {
          val = val[parseInt(idxOrStar, 10)];
        }
      }
    } else {
      val = val[token];
    }
  }

  return val;
}

function resolveTemplate(context: Record<string, any>, value: any): any {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const exactMatch = trimmed.match(/^\{\{([^}]+)\}\}$/);
    if (exactMatch) {
      return resolvePath(context, exactMatch[1]);
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (match: string, pathStr: string) => {
      const val = resolvePath(context, pathStr);
      return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
    });
  }
  
  if (Array.isArray(value)) {
    return value.map(v => resolveTemplate(context, v));
  }
  
  if (value !== null && typeof value === 'object') {
    const result: any = {};
    for (const key of Object.keys(value)) {
      result[key] = resolveTemplate(context, value[key]);
    }
    return result;
  }
  
  return value;
}

// Export Node Handler
async function executeExportNode(node: any, context: Record<string, any>) {
  const fileName = node.data?.fileName || `exportacion_${new Date().toISOString().slice(0,10)}`;
  const format = node.data?.format || 'CSV';
  const dataSource = node.data?.dataSource as string | undefined;
  const columns = node.data?.columns as { header: string, key: string }[] | undefined;

  let baseData: any[] = [];

  if (dataSource) {
    // Resolve variable: strip {{ }} wrapper
    const match = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = match ? match[1] : dataSource;
    const resolved = resolvePath(context, pathStr);

    if (Array.isArray(resolved)) {
      baseData = resolved;
    } else if (resolved && typeof resolved === 'object') {
      // If it's not an array but an object, try to find an array inside it
      const arrVal = Object.values(resolved).find(v => Array.isArray(v));
      baseData = arrVal ? (arrVal as any[]) : [resolved];
    } else {
      baseData = [];
    }
  } else {
    // No dataSource configured: auto-detect from upstream context values
    // Look for the first array (likely the HTTP GET response)
    for (const ctxVal of Object.values(context)) {
      if (Array.isArray(ctxVal) && ctxVal.length > 0) {
        baseData = ctxVal;
        break;
      }
      // If the value is an object, check one level deep for arrays
      if (ctxVal && typeof ctxVal === 'object') {
        const nested = Object.values(ctxVal).find(v => Array.isArray(v));
        if (nested) {
          baseData = nested as any[];
          break;
        }
      }
    }
    // Last resort: flatten all context values
    if (baseData.length === 0) {
      baseData = Object.values(context);
    }
  }

  // Apply column mapping if defined
  let exportData: any[] = baseData;
  if (columns && columns.length > 0 && Array.isArray(baseData)) {
    exportData = baseData.map(item => {
      const row: Record<string, any> = {};
      for (const col of columns) {
        if (col.header && col.key) {
          // Resolve dot-notation key on item
          const parts = col.key.split('.');
          let val: any = item;
          for (const part of parts) {
            if (val === undefined || val === null) break;
            val = val[part];
          }
          row[col.header] = val ?? '';
        }
      }
      return row;
    });
  }

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const isExcel = format === 'Excel';
  const ext = isExcel ? '.xlsx' : '.csv';
  const safeFileName = fileName.endsWith(ext) ? fileName : (fileName.replace(/\.(csv|xlsx|json)$/, '') + ext);
  const filePath = path.join(dataDir, safeFileName);

  if (isExcel) {
    // Generate a real .xlsx file with ExcelJS
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');

    if (exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null) {
      const headers = Object.keys(exportData[0]);

      // Parse the header color early so we can apply it to the header row
      const headerColStr = node.data?.headerColor as string;
      const parsedColor = headerColStr && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(headerColStr) 
        ? headerColStr.replace('#', '').toUpperCase() 
        : null;

      // Add styled header row - per cell to avoid coloring the entire row
      sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 16) }));
      const headerRow = sheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: parsedColor ? `FF${parsedColor.length === 3 ? parsedColor.split('').map(c => c+c).join('') : parsedColor}` : 'FF1E293B' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF6366F1' } } };
      });

      // Add data rows - plain, no background color (except first column if specified)
      exportData.forEach(row => {
        const dataRow = sheet.addRow(headers.map(h => {
          const v = row[h];
          return (v === null || v === undefined) ? '' : v;
        }));
        dataRow.height = 18;
        
        if (parsedColor) {
          const firstCell = dataRow.getCell(1);
          firstCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${parsedColor.length === 3 ? parsedColor.split('').map(c => c+c).join('') : parsedColor}` } };
        }
      });
    }

    await workbook.xlsx.writeFile(filePath);

  } else {
    // Generate CSV
    if (exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null) {
      const headers = Object.keys(exportData[0]);
      const csvRows = [headers.join(',')];

      for (const row of exportData) {
        const values = headers.map(header => {
          const val = row[header];
          const strVal = (val === null || val === undefined) ? '' : String(val);
          if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
            return `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        });
        csvRows.push(values.join(','));
      }
      fs.writeFileSync(filePath, csvRows.join('\n'), 'utf8');
    } else {
      fs.writeFileSync(filePath, exportData.join('\n'), 'utf8');
    }
  }

  const previewRows = exportData.slice(0, 1000);
  const sampleHeaders = exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null
    ? Object.keys(exportData[0])
    : [];

  return {
    filePath,
    format,
    records: exportData.length,
    success: true,
    previewRows,
    headers: sampleHeaders
  };
}

// Timer / Delay Node Handler with real-time second-by-second countdown and abort support
async function executeTimerNode(
  node: any,
  notify: (status: 'running' | 'completed' | 'error' | 'progress', result?: any) => void,
  signal?: AbortSignal
) {
  const durationVal = parseFloat(node.data?.duration ?? '10') || 10;
  const unit = (node.data?.unit as string) || 'seconds';

  let totalSeconds = durationVal;
  if (unit === 'minutes') {
    totalSeconds = Math.round(durationVal * 60);
  } else if (unit === 'hours') {
    totalSeconds = Math.round(durationVal * 3600);
  }
  totalSeconds = Math.max(1, Math.round(totalSeconds));

  let remainingSeconds = totalSeconds;

  // Initial progress update
  notify('progress', { remainingSeconds, totalSeconds, elapsedSeconds: 0 });

  while (remainingSeconds > 0) {
    if (signal?.aborted) {
      throw new Error('Ejecución detenida por el usuario');
    }

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Ejecución detenida por el usuario'));
      }
      let onAbort: (() => void) | undefined;
      const timer = setTimeout(() => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, 1000);

      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort!);
          reject(new Error('Ejecución detenida por el usuario'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    remainingSeconds--;
    const elapsedSeconds = totalSeconds - remainingSeconds;
    notify('progress', { remainingSeconds, totalSeconds, elapsedSeconds });
  }

  return {
    totalSeconds,
    completedAt: new Date().toISOString(),
    success: true,
    msg: `Pausa de ${totalSeconds}s completada`
  };
}

// Data Source Node Handler (Loads Excel / CSV into workflow context)
async function executeDataSourceNode(
  node: any,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    throw new Error('Ejecución detenida por el usuario');
  }

  const rawFilePath = node.data?.filePath;
  if (!rawFilePath) {
    throw new Error('El nodo de origen de datos no tiene ningún archivo seleccionado.');
  }

  const fullPath = path.isAbsolute(rawFilePath) ? rawFilePath : path.join(process.cwd(), rawFilePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Archivo no encontrado en el servidor: ${rawFilePath}`);
  }

  const sheetName = node.data?.sheetName as string | undefined;
  const parsed = await parseExcelOrCsvFile(fullPath, sheetName);

  return parsed.rows;
}

// Query Node Handler
async function executeQueryNode(node: any, context: Record<string, any>, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Ejecución detenida por el usuario');

  const queryId = node.data?.queryId;
  if (!queryId) throw new Error('Query ID not configured in query node');

  const db = getDb();
  const queryInfo = db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId) as any;
  if (!queryInfo) throw new Error('Query not found in database');

  const sqlText = queryInfo.sql_text;
  let connectionIds: string[] = [];
  try {
    connectionIds = JSON.parse(queryInfo.connection_ids || '[]');
  } catch(e) {}
  if (connectionIds.length === 0) throw new Error('Query has no connections configured');

  let params: Record<string, any> = {};
  if (node.data?.queryParams && node.data.queryParams.trim() !== '') {
    try {
      const parsed = JSON.parse(node.data.queryParams);
      params = resolveTemplate(context, parsed);
    } catch(e) {
      console.error('Failed to parse query params mapping', e);
    }
  }

  const connectionId = connectionIds[0];
  const { executeMssqlQuery } = await import('./mssql.js');
  const result = await executeMssqlQuery(connectionId, sqlText, params);
  if (signal?.aborted) throw new Error('Ejecución detenida por el usuario');

  const extractMode = node.data?.extractMode || 'all';
  
  if (extractMode === 'selected_columns') {
    const colsStr = node.data?.extractColumns || '';
    const cols = colsStr.split(',').map((c: string) => c.trim()).filter(Boolean);
    
    if (cols.length > 0 && result.rows && result.rows.length > 0) {
      if (cols.length === 1) {
        return result.rows.map((r: any) => r[cols[0]]);
      } else {
        return result.rows.map((r: any) => {
          const obj: any = {};
          for (const col of cols) {
            obj[col] = r[col];
          }
          return obj;
        });
      }
    }
    return [];
  }

  return result.rows;
}
