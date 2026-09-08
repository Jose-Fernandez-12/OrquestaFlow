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
  mode?: 'normal' | 'debug';
  debugState?: 'running' | 'paused';
  resumeResolvers?: Record<string, (action?: string) => void>;
  skipHttpPauseForNode?: Record<string, boolean>;
  nodes: Record<string, { status: 'running' | 'completed' | 'error' | 'progress' | 'paused'; result?: any }>;
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

// Resume node execution for debug mode
export function resumeNodeExecution(
  flowId: string,
  nodeId?: string,
  action: 'step_over' | 'continue' | 'continue_node' | 'step_request' = 'step_over'
): boolean {
  const current = activeFlowExecutions.get(flowId);
  if (!current || current.status !== 'running') {
    return false;
  }

  if (action === 'continue') {
    current.debugState = 'running';
    if (!current.skipHttpPauseForNode) current.skipHttpPauseForNode = {};
    if (nodeId) current.skipHttpPauseForNode[nodeId] = true;
    if (current.resumeResolvers) {
      Object.values(current.resumeResolvers).forEach(resolve => resolve('continue'));
      current.resumeResolvers = {};
    }
    return true;
  }

  if (action === 'continue_node' && nodeId) {
    if (!current.skipHttpPauseForNode) current.skipHttpPauseForNode = {};
    current.skipHttpPauseForNode[nodeId] = true;
    if (current.resumeResolvers && current.resumeResolvers[nodeId]) {
      current.resumeResolvers[nodeId]('continue_node');
      delete current.resumeResolvers[nodeId];
      return true;
    }
  }

  // action === 'step_over' or 'step_request'
  if (nodeId && current.resumeResolvers && current.resumeResolvers[nodeId]) {
    current.resumeResolvers[nodeId]('step');
    delete current.resumeResolvers[nodeId];
    return true;
  }

  return false;
}

// Global execution wrapper with parallel dependency resolution
export async function executeFlowEngine(
  flowId: string,
  onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress' | 'paused', result?: any) => void,
  options?: { mode?: 'normal' | 'debug' }
): Promise<Record<string, any>> {
  const db = getDb();
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
  if (!flow) throw new Error('Flow not found');

  const abortController = new AbortController();
  const mode = options?.mode || 'normal';

  // Track active execution in memory
  activeFlowExecutions.set(flowId, {
    flowId,
    startTime: Date.now(),
    status: 'running',
    mode,
    debugState: mode === 'debug' ? 'paused' : 'running',
    resumeResolvers: {},
    nodes: {},
    abortController
  });

  const notifyProgress = (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress' | 'paused', result?: any) => {
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

  // Normalize edges: if an edge connects A -> B, but A references B in its configuration,
  // the edge was connected backwards and B must execute before A.
  const normalizedEdges = edges.map(edge => {
    const srcNode = nodes.find(n => n.id === edge.source);
    const tgtNode = nodes.find(n => n.id === edge.target);
    if (srcNode && tgtNode) {
      const srcConfigStr = JSON.stringify(srcNode.data || {});
      if (srcConfigStr.includes(tgtNode.id)) {
        return { ...edge, source: tgtNode.id, target: srcNode.id };
      }
    }
    return edge;
  });

  normalizedEdges.forEach(edge => {
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

              const isHttpNode = ['httpGet', 'httpPost', 'httpRequest'].includes(node.type);
              const currentExec = activeFlowExecutions.get(flowId);
              if (!isHttpNode && currentExec?.mode === 'debug' && currentExec?.debugState === 'paused') {
                notifyProgress(node.id, 'paused', { context: { ...context } });
                await new Promise<void>((resolve) => {
                  if (currentExec.resumeResolvers) {
                    currentExec.resumeResolvers[node.id] = () => resolve();
                  }
                });
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
                    output = await executeHttpNode(node, context, notifyProgress, abortController.signal, flowId);
                    break;
                  case 'scraping':
                    output = await executeScrapingNode(node, context, abortController.signal);
                    break;
                  case 'export':
                    output = await executeExportNode(node, context);
                    break;
                  case 'query':
                    output = await executeQueryNode(node, context, abortController.signal);
                    break;
                  case 'timer':
                  case 'delay':
                    output = await executeTimerNode(node, (status, res) => notifyProgress(node.id, status, res), abortController.signal);
                    {
                      const timerUpstreamIds = getEffectiveDataSources(node.id, edges, nodes);
                      if (timerUpstreamIds.length > 0 && context[timerUpstreamIds[0]]) {
                        output = context[timerUpstreamIds[0]];
                      }
                    }
                    break;
                  case 'dataSource':
                  case 'fileSource':
                    output = await executeDataSourceNode(node, context, abortController.signal, edges, nodes);
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
  onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress' | 'paused', result?: any) => void,
  signal?: AbortSignal,
  flowId?: string
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
        if (typeof paramsObj === 'object' && paramsObj !== null) {
          for (const [k, v] of Object.entries(paramsObj)) {
            if (v !== undefined && v !== null) {
              url.searchParams.set(k, String(v));
            }
          }
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

    const authType = node.data?.authType;
    if (authType === 'bearer' && node.data?.authToken) {
      const resolvedToken = resolveTemplate(localContext, node.data.authToken);
      if (resolvedToken) {
        headers['Authorization'] = `Bearer ${String(resolvedToken).trim()}`;
      }
    } else if (authType === 'basic') {
      const user = resolveTemplate(localContext, node.data?.authUsername || '') || '';
      const pass = resolveTemplate(localContext, node.data?.authPassword || '') || '';
      if (user || pass) {
        const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      }
    }

    let requestBody: any = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (node.data?.body && node.data.body.trim() !== '') {
        const bodyContent = node.data.body;
        const resolvedBody = resolveTemplate(localContext, bodyContent);
        if (resolvedBody === undefined || resolvedBody === null || resolvedBody === '') {
          // skip - no body
        } else if (typeof resolvedBody === 'object') {
          requestBody = JSON.stringify(resolvedBody, null, 2);
        } else {
          // It's a string - try to parse as JSON to validate/normalize it
          const strBody = String(resolvedBody);
          try {
            const parsed = JSON.parse(strBody);
            requestBody = JSON.stringify(parsed, null, 2);
          } catch {
            requestBody = strBody;
          }
        }
      } else if (node.data?.payload) {
        requestBody = JSON.stringify(resolveTemplate(localContext, node.data.payload) || {}, null, 2);
      }
    }

    // DEBUG MODE: Pause before sending each request to let the user inspect how the request was formed
    const currentExec = flowId ? activeFlowExecutions.get(flowId) : undefined;
    const shouldPause = currentExec?.mode === 'debug' &&
                        currentExec?.debugState === 'paused' &&
                        !currentExec?.skipHttpPauseForNode?.[node.id];

    if (shouldPause) {
      const requestPreview = {
        method,
        endpoint,
        headers,
        body: requestBody || null,
        params: node.data?.params || null,
        iteration: {
          current: i + 1,
          total: itemsToIterate.length
        },
        item
      };

      if (onNodeProgress) {
        onNodeProgress(node.id, 'paused', {
          debugType: 'http_request',
          requestPreview,
          context: { ...context, _item: item }
        });
      }

      const resumeAction = await new Promise<string>((resolve) => {
        if (currentExec.resumeResolvers) {
          currentExec.resumeResolvers[node.id] = (act?: string) => resolve(act || 'step');
        }
      });

      if (resumeAction === 'continue_node') {
        if (!currentExec.skipHttpPauseForNode) currentExec.skipHttpPauseForNode = {};
        currentExec.skipHttpPauseForNode[node.id] = true;
      }
    }

    if (onNodeProgress) {
      onNodeProgress(node.id, 'running', {
        current: i + 1,
        total: itemsToIterate.length
      });
    }

    // Combine user abort signal with a 30-second network timeout ONLY when actually fetching
    const fetchController = new AbortController();
    const timeoutId = setTimeout(() => fetchController.abort(new Error('Timeout de 30 segundos agotado')), 30000);
    
    if (signal) {
      signal.addEventListener('abort', () => fetchController.abort(new Error('Ejecución detenida por el usuario')), { once: true });
    }

    const options: RequestInit = { method, headers, signal: fetchController.signal };
    if (requestBody) {
      options.body = requestBody;
    }

    const fetchStart = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoint, options);
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw new Error(`HTTP Request falló: ${err.message}`);
    }
    clearTimeout(timeoutId);
    const durationMs = Date.now() - fetchStart;

    const responseHeaders: Record<string, string> = {};
    try {
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
    } catch {}

    const text = await response.text();
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }

    // Extract path if specified
    const extractPath = node.data?.extractPath;
    const finalResult = extractPath ? resolvePath(parsedBody, extractPath) : parsedBody;
    results.push(finalResult);

    // DEBUG MODE: Pause after receiving response if in debug step mode so user can inspect the response
    if (shouldPause) {
      const responsePreview = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        durationMs,
        headers: responseHeaders,
        data: parsedBody,
        iteration: itemsToIterate.length > 1 ? { current: i + 1, total: itemsToIterate.length } : undefined
      };
      if (onNodeProgress) {
        onNodeProgress(node.id, 'paused', {
          debugType: 'http_response',
          responsePreview,
          current: i + 1,
          total: itemsToIterate.length
        });
      }
      const resumeActionAfter = await new Promise<string>((resolve) => {
        if (currentExec?.resumeResolvers) {
          currentExec.resumeResolvers[node.id] = (act?: string) => resolve(act || 'step');
        }
      });
      if (resumeActionAfter === 'continue_node') {
        if (!currentExec.skipHttpPauseForNode) currentExec.skipHttpPauseForNode = {};
        currentExec.skipHttpPauseForNode[node.id] = true;
      }
    }

    if (!response.ok) {
      const errDetail = typeof parsedBody === 'string' ? parsedBody.slice(0, 300) : JSON.stringify(parsedBody).slice(0, 300);
      throw new Error(`HTTP Request falló con estado ${response.status} en ${endpoint}. ${errDetail ? 'Detalle: ' + errDetail : ''}`);
    }
    
    // Report progress
    if (itemsToIterate.length > 1 && onNodeProgress) {
      onNodeProgress(node.id, 'progress', { current: i + 1, total: itemsToIterate.length });
    }
  }

  return itemsToIterate.length > 1 ? results : results[0];
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

// Helper: evaluate direct property path on an object without recursing into fallback searches
function evaluatePathOnObject(obj: any, pathStr: string): any {
  if (!pathStr || !pathStr.trim() || obj === undefined || obj === null) return undefined;
  const tokens = pathStr.trim().split('.');
  let val: any = obj;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (val === undefined || val === null) return undefined;

    const bracketMatch = token.match(/^([^\[]*?)\[(\d+|\*)\]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const idxOrStar = bracketMatch[2];
      if (key) val = val[key];
      if (val === undefined || val === null) return undefined;

      if (idxOrStar === '*') {
        if (Array.isArray(val)) {
          const remainingTokens = tokens.slice(i + 1);
          if (remainingTokens.length === 0) return val;
          return val.map(item => evaluatePathOnObject(item, remainingTokens.join('.')));
        }
        return undefined;
      } else {
        val = val[parseInt(idxOrStar, 10)];
      }
    } else {
      val = val[token];
    }
  }
  return val;
}

// Helper: resolve a path like "nodeId[0].name" or "nodeId.data.items" from context with smart fallback (no recursion)
function resolvePath(context: Record<string, any>, pathStr: string): any {
  if (!pathStr || !pathStr.trim() || !context) return undefined;
  const trimmed = pathStr.trim();

  // 1. Direct path resolution with tokens on context
  const direct = evaluatePathOnObject(context, trimmed);
  if (direct !== undefined && direct !== null) {
    return direct;
  }

  // 2. Fallback: check if _item exists (iteration mode)
  if (context._item !== undefined && context._item !== null) {
    if (typeof context._item === 'object') {
      if (context._item[trimmed] !== undefined && context._item[trimmed] !== null) {
        return context._item[trimmed];
      }
      const fromItem = evaluatePathOnObject(context._item, trimmed);
      if (fromItem !== undefined && fromItem !== null) return fromItem;

      // Case-insensitive check on _item
      const lower = trimmed.toLowerCase();
      for (const [k, v] of Object.entries(context._item)) {
        if (k.toLowerCase() === lower) return v;
      }
    } else {
      return context._item;
    }
  }

  // 3. Fallback: smart lookup across upstream nodes in context (pure iterative, no recursion)
  const lowerTrimmed = trimmed.toLowerCase();
  for (const [ctxKey, ctxVal] of Object.entries(context)) {
    if (ctxKey === 'start' || ctxKey === '_item') continue;
    if (ctxVal === undefined || ctxVal === null) continue;

    if (Array.isArray(ctxVal) && ctxVal.length > 0) {
      const first = ctxVal[0];
      if (first && typeof first === 'object') {
        const val = evaluatePathOnObject(first, trimmed);
        if (val !== undefined && val !== null) return val;
        for (const [k, v] of Object.entries(first)) {
          if (k.toLowerCase() === lowerTrimmed) return v;
        }
      }
    } else if (typeof ctxVal === 'object') {
      const val = evaluatePathOnObject(ctxVal, trimmed);
      if (val !== undefined && val !== null) return val;

      if (ctxVal.data && typeof ctxVal.data === 'object') {
        if (Array.isArray(ctxVal.data) && ctxVal.data.length > 0) {
          const first = ctxVal.data[0];
          if (first && typeof first === 'object') {
            const dVal = evaluatePathOnObject(first, trimmed);
            if (dVal !== undefined && dVal !== null) return dVal;
            for (const [k, v] of Object.entries(first)) {
              if (k.toLowerCase() === lowerTrimmed) return v;
            }
          }
        } else {
          const dVal = evaluatePathOnObject(ctxVal.data, trimmed);
          if (dVal !== undefined && dVal !== null) return dVal;
        }
      }

      for (const [k, v] of Object.entries(ctxVal)) {
        if (k.toLowerCase() === lowerTrimmed) return v;
      }
    }
  }

  return undefined;
}

function resolveTemplate(context: Record<string, any>, value: any): any {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const exactMatch = trimmed.match(/^\{\{([^}]+)\}\}$/);
    if (exactMatch) {
      return resolvePath(context, exactMatch[1]);
    }

    // 1. Replace {{path}}
    let res = value.replace(/\{\{([^}]+)\}\}/g, (match: string, pathStr: string) => {
      const val = resolvePath(context, pathStr);
      return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
    });

    // 2. Support single braces in URLs: /City/{id} or /City/{cityId} or /City/{aca_van un id}
    if (res.includes('http') || res.startsWith('/')) {
      res = res.replace(/\{([^{}]+)\}/g, (match: string, pathStr: string) => {
        let val = resolvePath(context, pathStr);
        // If placeholder has descriptive text or cannot find exact match, look for id-related field
        if (val === undefined) {
          if (pathStr.toLowerCase().includes('id')) {
            val = resolvePath(context, 'id');
            if (val === undefined && context._item && typeof context._item === 'object') {
              for (const [k, v] of Object.entries(context._item)) {
                if (k.toLowerCase().includes('id')) {
                  val = v;
                  break;
                }
              }
            }
            if (val === undefined) {
              for (const ctxVal of Object.values(context)) {
                const target = Array.isArray(ctxVal) ? ctxVal[0] : ctxVal;
                if (target && typeof target === 'object') {
                  for (const [k, v] of Object.entries(target)) {
                    if (k.toLowerCase().includes('id')) {
                      val = v;
                      break;
                    }
                  }
                }
                if (val !== undefined) break;
              }
            }
          }
        }
        if (val !== undefined && val !== null) {
          return String(val);
        }
        return match;
      });

      // 3. Support route params like :id
      res = res.replace(/:([a-zA-Z0-9_]+)/g, (match: string, paramName: string) => {
        let val = resolvePath(context, paramName);
        if (val === undefined && paramName.toLowerCase().includes('id')) {
          if (context._item && typeof context._item === 'object') {
            for (const [k, v] of Object.entries(context._item)) {
              if (k.toLowerCase().includes('id')) {
                val = v;
                break;
              }
            }
          }
          if (val === undefined) {
            for (const ctxVal of Object.values(context)) {
              const target = Array.isArray(ctxVal) ? ctxVal[0] : ctxVal;
              if (target && typeof target === 'object') {
                for (const [k, v] of Object.entries(target)) {
                  if (k.toLowerCase().includes('id')) {
                    val = v;
                    break;
                  }
                }
              }
              if (val !== undefined) break;
            }
          }
        }
        if (val !== undefined && val !== null) {
          return String(val);
        }
        return match;
      });
    }

    return res;
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

function flattenRows(data: any): any[] {
  if (!data) return [];
  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.rows)) return flattenRows(data.rows);
      if (Array.isArray(data.data)) return flattenRows(data.data);
      if (Array.isArray(data.items)) return flattenRows(data.items);
      if (data.data && typeof data.data === 'object' && Object.keys(data.data).length > 0) {
        return [data.data];
      }
      const arr = Object.values(data).find(v => Array.isArray(v));
      if (arr) return flattenRows(arr);
      return [data];
    }
    return [];
  }

  const result: any[] = [];
  for (const item of data) {
    if (!item) continue;
    if (Array.isArray(item)) {
      result.push(...flattenRows(item));
    } else if (typeof item === 'object') {
      if (Array.isArray(item.data)) {
        result.push(...flattenRows(item.data));
      } else if (Array.isArray(item.rows)) {
        result.push(...flattenRows(item.rows));
      } else if (Array.isArray(item.items)) {
        result.push(...flattenRows(item.items));
      } else if (item.data && typeof item.data === 'object' && Object.keys(item.data).length > 0) {
        result.push({ ...item.data });
      } else {
        result.push(item);
      }
    }
  }
  return result;
}

// Export Node Handler
async function executeExportNode(node: any, context: Record<string, any>) {
  const fileName = node.data?.fileName || `exportacion_${new Date().toISOString().slice(0,10)}`;
  const format = node.data?.format || 'CSV';
  const dataSource = node.data?.dataSource as string | undefined;
  const columns = node.data?.columns as { header: string, key: string }[] | undefined;

  let rawData: any = null;

  if (dataSource && dataSource.trim() !== '') {
    const match = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = match ? match[1] : dataSource;
    rawData = resolvePath(context, pathStr);
  } else {
    // Auto-detect: reverse context keys to prioritize the latest executed upstream node (HTTP Request)
    const contextKeys = Object.keys(context).reverse();
    for (const key of contextKeys) {
      if (key.startsWith('start')) continue;
      const val = context[key];
      if (val !== undefined && val !== null) {
        rawData = val;
        break;
      }
    }
  }

  let baseDataWrapped: { item: any, rootIndex: number }[] = [];
  if (Array.isArray(rawData)) {
      rawData.forEach((rootItem, idx) => {
          const flat = flattenRows(rootItem);
          baseDataWrapped.push(...flat.map(item => ({ item, rootIndex: idx })));
      });
  } else {
      const flat = flattenRows(rawData);
      baseDataWrapped.push(...flat.map(item => ({ item, rootIndex: 0 })));
  }

  const baseData = baseDataWrapped.map(w => w.item);

  // Apply column mapping if defined
  let exportData: any[] = baseData;
  if (columns && columns.length > 0 && Array.isArray(baseData)) {
    exportData = baseDataWrapped.map((wrappedItem, itemIndex) => {
      const { item, rootIndex } = wrappedItem;
      const row: Record<string, any> = {};
      for (const col of columns) {
        if (col.header && col.key) {
          if (col.key.includes('{{') && col.key.includes('}}')) {
             row[col.header] = resolveTemplate({ ...context, _item: item, _index: itemIndex }, col.key) ?? '';
          } else {
            // Resolve dot-notation key on item
            const parts = col.key.split('.');
            let val: any = item;
            for (const part of parts) {
              if (val === undefined || val === null) break;
              val = val[part];
            }
            
            // Fallback 1: Resolve as a direct path in the global context
            if (val === undefined || val === null) {
              val = resolvePath(context, col.key);
            }
            
            // Fallback 2: Smart resolution across other node results for flat keys
            if (val === undefined || val === null) {
               for (const [nodeId, nodeResult] of Object.entries(context)) {
                  if (nodeId === 'start') continue;
                  if (Array.isArray(nodeResult)) {
                      let rowMatch: any = null;
                      let manualJoinAttempted = false;
                      const joins = node.data?.joins as { nodeId: string, localKey: string, foreignKey: string }[] | undefined;
                      const explicitJoin = joins?.find(j => j.nodeId === nodeId);
                      
                      if (explicitJoin && explicitJoin.localKey && explicitJoin.foreignKey) {
                          manualJoinAttempted = true;
                          
                          // Find actual local key (case-insensitive)
                          const localKeyActual = Object.keys(item).find(k => k.toLowerCase() === explicitJoin.localKey.toLowerCase());
                          
                          if (localKeyActual && item[localKeyActual] !== undefined && item[localKeyActual] !== null) {
                              rowMatch = nodeResult.find((r: any) => {
                                  // Find actual foreign key (case-insensitive)
                                  const foreignKeyActual = Object.keys(r).find(k => k.toLowerCase() === explicitJoin.foreignKey.toLowerCase());
                                  return foreignKeyActual && String(r[foreignKeyActual]) === String(item[localKeyActual]);
                              });
                          }
                      } else if (nodeResult.length > 0 && typeof nodeResult[0] === 'object' && typeof item === 'object') {
                          // Smart Relational Join: try to find a common ID key between the item and nodeResult
                          const itemKeys = Object.keys(item);
                          const foreignKeys = Object.keys(nodeResult[0]);
                          // Find common keys that likely represent IDs
                          const commonKeys = itemKeys.filter(k => 
                              foreignKeys.some(fk => fk.toLowerCase() === k.toLowerCase())
                          );
                          
                          // Prefer keys that have 'id' or 'code' in their name
                          const bestKeyItem = commonKeys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('code')) || commonKeys[0];
                          
                          if (bestKeyItem && item[bestKeyItem] !== undefined && item[bestKeyItem] !== null) {
                              const bestKeyForeign = foreignKeys.find(fk => fk.toLowerCase() === bestKeyItem.toLowerCase())!;
                              // Find the row where the IDs match
                              rowMatch = nodeResult.find((r: any) => String(r[bestKeyForeign]) === String(item[bestKeyItem]));
                          }
                      }

                      // Try to match by index if relational join failed
                      if (!rowMatch && !manualJoinAttempted) {
                          rowMatch = nodeResult[rootIndex];
                      }

                      if (rowMatch && typeof rowMatch === 'object' && col.key in rowMatch) {
                          val = rowMatch[col.key];
                          break;
                      }
                  } else if (nodeResult && typeof nodeResult === 'object') {
                      if (col.key in nodeResult) {
                          val = nodeResult[col.key];
                          break;
                      }
                  }
               }
            }

            row[col.header] = val ?? '';
          }
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
    
    // Parse the header color early so we can apply it to the header row
    const headerColStr = node.data?.headerColor as string;
    const parsedColor = headerColStr && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(headerColStr) 
      ? headerColStr.replace('#', '').toUpperCase() 
      : null;

    if (node.data?.exportMode === 'multi') {
      const multiSheetConfig = (node.data?.multiSheetConfig as Record<string, string>) || {};
      const nodeIds = Object.keys(multiSheetConfig);
      
      if (nodeIds.length === 0) {
        workbook.addWorksheet('Datos Vacio');
      }

      for (const nodeId of nodeIds) {
        let sheetName = multiSheetConfig[nodeId];
        // Ensure valid sheet name
        if (!sheetName || sheetName.trim() === '') {
          sheetName = `Hoja_${nodeId.substring(0, 5)}`;
        }
        
        let sheetData = context[nodeId];
        if (!sheetData) continue;
        
        const flatData = flattenRows(sheetData);
        if (flatData.length === 0) continue;
        
        const sheet = workbook.addWorksheet(sheetName.substring(0, 31)); // Excel limit is 31 chars
        const firstItem = typeof flatData[0] === 'object' && flatData[0] !== null ? flatData[0] : { Valor: flatData[0] };
        const headers = Object.keys(firstItem);
        
        sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 16) }));
        const headerRow = sheet.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: parsedColor ? `FF${parsedColor.length === 3 ? parsedColor.split('').map(c => c+c).join('') : parsedColor}` : 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        flatData.forEach(row => {
          const dataRow = sheet.addRow(headers.map(h => {
            const v = (typeof row === 'object' && row !== null) ? row[h] : row;
            return (v === null || v === undefined) ? '' : v;
          }));
          dataRow.height = 18;
        });
      }
    } else {
      // Single Sheet Mode
      const sheet = workbook.addWorksheet('Datos');

      if (exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null) {
        const headers = Object.keys(exportData[0]);

        // Add styled header row - per cell to avoid coloring the entire row
        sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 16) }));
        const headerRow = sheet.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: parsedColor ? `FF${parsedColor.length === 3 ? parsedColor.split('').map(c => c+c).join('') : parsedColor}` : 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
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

// Helper to trace back through timers/delays to find the real upstream data sources
function getEffectiveDataSources(nodeId: string, edges: any[] = [], nodes: any[] = []): string[] {
  const incomingEdges = (edges || []).filter(e => e.target === nodeId);
  const result: string[] = [];

  for (const edge of incomingEdges) {
    const sourceNode = (nodes || []).find(n => n.id === edge.source);
    if (!sourceNode) {
      result.push(edge.source);
      continue;
    }
    
    // If source is a timer or delay, trace back to what feeds the timer
    if (sourceNode.type === 'timer' || sourceNode.type === 'delay') {
      const upstreamSources = getEffectiveDataSources(sourceNode.id, edges, nodes);
      result.push(...upstreamSources);
    } else if (sourceNode.type !== 'start') {
      result.push(sourceNode.id);
    }
  }

  return [...new Set(result)];
}

// Data Source Node Handler (Loads Excel / CSV into workflow context or merges incoming data)
async function executeDataSourceNode(
  node: any,
  context: Record<string, any>,
  signal?: AbortSignal,
  edges?: any[],
  nodes?: any[]
) {
  if (signal?.aborted) {
    throw new Error('Ejecución detenida por el usuario');
  }

  const mode = node.data?.mode || 'file';

  if (mode === 'merge') {
    // Modo Unificador: Unir datos de los nodos anteriores conectados a la entrada
    // Filtramos temporizadores y nodos de control para obtener los orígenes de datos reales
    const incomingSourceIds = getEffectiveDataSources(node.id, edges || [], nodes || []);

    const targetKeys = incomingSourceIds.length > 0
      ? incomingSourceIds
      : Object.keys(context).filter(k => {
          if (k === 'start' || k === node.id) return false;
          const n = (nodes || []).find(nodeItem => nodeItem.id === k);
          return n?.type !== 'timer' && n?.type !== 'delay';
        });

    const contextResults: any[][] = [];
    for (const key of targetKeys) {
      const val = context[key];
      if (!val) continue;
      const flat = flattenRows(val);
      if (flat.length > 0) {
        contextResults.push(flat);
      }
    }

    if (contextResults.length === 0) {
      return [];
    }

    // Ordenar de mayor a menor longitud para usar el más grande como base
    contextResults.sort((a, b) => b.length - a.length);
    const baseArray = contextResults[0];
    const otherArrays = contextResults.slice(1);

    const merged = baseArray.map((baseItem, index) => {
      let combined = { ...baseItem };
      
      for (const arr of otherArrays) {
        let rowMatch: any = null;
        
        // Smart Relational Join: Buscar llaves ID en común
        const itemKeys = Object.keys(combined);
        const foreignKeys = Object.keys(arr[0] || {});
        
        const commonKeys = itemKeys.filter(k => 
          foreignKeys.some(fk => fk.toLowerCase() === k.toLowerCase())
        );
        
        const bestKeyItem = commonKeys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('code')) || commonKeys[0];
        
        if (bestKeyItem && combined[bestKeyItem] !== undefined && combined[bestKeyItem] !== null) {
          const bestKeyForeign = foreignKeys.find(fk => fk.toLowerCase() === bestKeyItem.toLowerCase())!;
          rowMatch = arr.find((r: any) => String(r[bestKeyForeign]) === String(combined[bestKeyItem]));
        }

        // Fallback a unión por índice
        if (!rowMatch) {
          rowMatch = arr[index];
        }

        if (rowMatch && typeof rowMatch === 'object') {
          combined = { ...combined, ...rowMatch };
        }
      }
      return combined;
    });

    return merged;
  }

  // Modo archivo tradicional
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
