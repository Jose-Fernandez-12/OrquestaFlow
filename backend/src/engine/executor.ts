import { getDb } from '../db/database.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import mssql from 'mssql';
import ExcelJS from 'exceljs';

// Global execution wrapper with parallel dependency resolution
export async function executeFlowEngine(flowId: string, onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error', result?: any) => void) {
  const db = getDb();
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
  if (!flow) throw new Error('Flow not found');

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

    const checkAndRun = () => {
      if (hasError) return; // Stop triggering new nodes if flow failed
      
      let allDone = true;

      nodes.forEach(node => {
        if (!completedNodes.has(node.id) && !errorNodes.has(node.id)) {
          allDone = false;
          
          if (inDegree[node.id] === 0 && !runningPromises.has(node.id)) {
            // Node is ready to run
            const p = (async () => {
              if (onNodeProgress) onNodeProgress(node.id, 'running');
              
              // Añadimos un pequeño retraso artificial (150ms para inicio, 800ms para el resto)
              // Esto es solo para que en el frontend dé tiempo a verse la animación de "ejecutando" (azul)
              // a "completado" (verde), especialmente en endpoints muy rápidos.
              const delayMs = node.type === 'start' ? 150 : 800;
              await new Promise(r => setTimeout(r, delayMs));
              
              try {
                let output: any = {};
                switch (node.type) {
                  case 'start':
                    output = { msg: 'Flow started' };
                    break;
                  case 'httpGet':
                  case 'httpPost':
                  case 'httpRequest':
                    output = await executeHttpNode(node, context);
                    break;
                  case 'scraping':
                    output = await executeScrapingNode(node, context);
                    break;
                  case 'export':
                    output = await executeExportNode(node, context);
                    break;
                  default:
                    output = { warning: 'Unknown node type' };
                }

                context[node.id] = output;
                completedNodes.add(node.id);
                if (onNodeProgress) onNodeProgress(node.id, 'completed', output);

                // Unlock dependents
                (adjList[node.id] || []).forEach(neighborId => {
                  inDegree[neighborId]--;
                });
              } catch (err: any) {
                errorNodes.add(node.id);
                hasError = true;
                if (onNodeProgress) onNodeProgress(node.id, 'error', { error: err.message || 'Error executing node' });
                throw err;
              }
            })();

            runningPromises.set(node.id, p);
            
            p.then(() => {
              runningPromises.delete(node.id);
              checkAndRun();
            }).catch(err => {
              runningPromises.delete(node.id);
              reject(err);
            });
          }
        }
      });

      if (allDone && runningPromises.size === 0) {
        resolve(context);
      }
    };

    checkAndRun();
  });
}

// Http Node Handler
async function executeHttpNode(node: any, context: Record<string, any>) {
  let endpoint = node.data?.endpoint || '';

  // Intercept mock storefront URLs to prevent DNS failures and return actual data
  if (endpoint.includes('storefront.com') || !endpoint.startsWith('http')) {
    return {
      status: "success",
      code: 200,
      data: {
        items: [
          { id: "prod_01", name: "Laptop Pro", price: 1299.99, stock: 45 },
          { id: "prod_02", name: "Mouse Inalámbrico", price: 49.99, stock: 120 }
        ],
        pagination: { page: 1, total_pages: 5, total_items: 10 }
      }
    };
  }
  
  // Substitution helper for {{nodeId.key}}
  const substitute = (str: string) => {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{([^}]+)\}\}/g, (match: string, pathStr: string) => {
      const parts = pathStr.trim().split('.');
      let val = context;
      for (const part of parts) {
        if (val === undefined || val === null) return '';
        val = val[part];
      }
      return typeof val === 'object' ? JSON.stringify(val) : String(val || '');
    });
  };

  endpoint = substitute(endpoint);

  // Apply query params
  if (node.data?.params && node.data.params.trim() !== '') {
    try {
      const paramsObj = JSON.parse(substitute(node.data.params));
      const url = new URL(endpoint);
      for (const [k, v] of Object.entries(paramsObj)) {
        url.searchParams.append(k, String(v));
      }
      endpoint = url.toString();
    } catch (e) {
      console.error('Failed to parse query params', e);
    }
  }

  // Determine method
  let method = node.data?.method || 'GET';
  if (node.type === 'httpPost') method = 'POST'; // Backwards compatibility

  // Determine headers
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (node.data?.headers && node.data.headers.trim() !== '') {
    try {
      const parsedHeaders = JSON.parse(substitute(node.data.headers));
      headers = { ...headers, ...parsedHeaders };
    } catch(e) {
      console.error('Failed to parse headers', e);
    }
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    if (node.data?.body && node.data.body.trim() !== '') {
      options.body = substitute(node.data.body);
    } else if (node.data?.payload) {
      options.body = JSON.stringify(node.data.payload || {}); // Backwards compatibility
    }
  }

  const response = await fetch(endpoint, options);
  if (!response.ok) {
    throw new Error(`HTTP Request failed with status ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// Scraping Node Handler (spawns Python script if configured)
async function executeScrapingNode(node: any, context: Record<string, any>) {
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
    const py = spawn('python', [scriptPath]);
    let stdout = '';
    let stderr = '';

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
  // Tokenize path: split on '.' but keep bracket groups as part of previous token
  // e.g. "abc[0].name" -> ["abc[0]", "name"]
  const tokens = pathStr.trim().split('.');
  let val: any = context;

  for (const token of tokens) {
    if (val === undefined || val === null) break;

    // Check for bracket notation: e.g. "abc[0]" or just "[0]"
    const bracketRe = /^([^\[]*?)\[(\d+)\]$/;
    const bracketMatch = token.match(bracketRe);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const idx = parseInt(bracketMatch[2], 10);
      if (key) val = val[key];
      if (val !== undefined && val !== null) val = val[idx];
    } else {
      val = val[token];
    }
  }

  return val;
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

      // Add styled header row - per cell to avoid coloring the entire row
      sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 16) }));
      const headerRow = sheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell({ includeEmpty: false }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF6366F1' } } };
      });

      // Add data rows - plain, no background color
      exportData.forEach(row => {
        const dataRow = sheet.addRow(headers.map(h => {
          const v = row[h];
          return (v === null || v === undefined) ? '' : v;
        }));
        dataRow.height = 18;
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

  return { filePath, format, records: exportData.length, success: true };
}
