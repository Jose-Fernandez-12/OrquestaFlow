import { getDb } from '../db/database.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import { v4 as uuid } from 'uuid';
import mssql from 'mssql';
import ExcelJS from 'exceljs';
import { parseExcelOrCsvFile } from '../routes/files.js';
import { getSystemSettingsFromDb } from '../routes/settings.js';

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

// Only remove the state of the run that scheduled the cleanup; a newer run of the same flow must survive
function scheduleExecutionCleanup(flowId: string, state: ActiveExecutionState | undefined) {
  setTimeout(() => {
    if (state && activeFlowExecutions.get(flowId) === state) {
      activeFlowExecutions.delete(flowId);
    }
  }, 30000);
}

// Stop flow execution
export function stopFlowEngine(flowId: string, reason = 'Ejecución detenida por el usuario'): boolean {
  const current = activeFlowExecutions.get(flowId);
  if (!current || current.status !== 'running') {
    return false;
  }
  current.status = 'cancelled';
  current.cancelReason = reason;
  current.abortController.abort(reason);
  if (current.resumeResolvers) {
    Object.values(current.resumeResolvers).forEach(resolve => resolve('stop'));
    current.resumeResolvers = {};
  }
  scheduleExecutionCleanup(flowId, activeFlowExecutions.get(flowId));
  return true;
}

// Pause execution for debug mode
export function pauseDebugExecution(flowId: string): boolean {
  const current = activeFlowExecutions.get(flowId);
  if (!current || current.status !== 'running') {
    return false;
  }
  current.debugState = 'paused';
  current.skipHttpPauseForNode = {};
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
  options?: { mode?: 'normal' | 'debug'; initialContext?: Record<string, any> }
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
    if (tgtNode?.type === 'conditionalBranch' && isBranchHandle(edge.targetHandle)) {
      return { ...edge, source: edge.target, target: edge.source, sourceHandle: edge.targetHandle, targetHandle: edge.sourceHandle };
    }
    if (srcNode?.type === 'conditionalBranch' && isBranchHandle(edge.sourceHandle)) {
      return edge;
    }
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

  // ForEach sub-graph exclusion: mark nodes between forEach and forEachEnd
  // with inDegree = Infinity so the main Kahn traversal ignores them.
  // The forEach node will manage their execution internally.
  const forEachNodes = nodes.filter(n => n.type === 'forEach');
  const forEachManagedNodeIds = new Set<string>();

  for (const feNode of forEachNodes) {
    const endId = findForEachEndNode(feNode.id, adjList, nodes);
    if (endId) {
      const subIds = getForEachSubgraphNodes(feNode.id, endId, adjList, nodes);
      subIds.forEach(sid => {
        forEachManagedNodeIds.add(sid);
        inDegree[sid] = Infinity; // Exclude from main DAG traversal
      });

      // Crucial fix: The subgraph nodes between feNode and endId execute inside executeForEachNode,
      // NOT in the main Kahn traversal loop.
      // Therefore, edges from subIds to endId will never decrement inDegree[endId] in the main DAG.
      // We must remove their inDegree contribution:
      normalizedEdges.forEach(edge => {
        if (edge.target === endId && subIds.includes(edge.source)) {
          inDegree[endId] = Math.max(0, (inDegree[endId] || 0) - 1);
        }
      });

      // Instead, feNode's completion in the main DAG must unlock endId:
      if (!adjList[feNode.id]) {
        adjList[feNode.id] = [];
      }
      if (!adjList[feNode.id].includes(endId)) {
        adjList[feNode.id].push(endId);
        inDegree[endId] = (inDegree[endId] || 0) + 1;
      }
    }
  }

  const experimentalEnabled = getSystemSettingsFromDb().experimental_nodes_enabled;
  const disabledExperimental = nodes.find(n => EXPERIMENTAL_NODE_TYPES.includes(n.type));
  if (disabledExperimental && !experimentalEnabled) {
    activeFlowExecutions.delete(flowId);
    throw new Error(
      `El flujo usa el nodo experimental "${disabledExperimental.data?.label || disabledExperimental.type}". Habilita los nodos experimentales en Configuración para ejecutarlo.`
    );
  }

  const initialInDegree: Record<string, number> = { ...inDegree };
  const skippedIncoming: Record<string, number> = {};
  const skippedNodes = new Set<string>();

  const context: Record<string, any> = { ...(options?.initialContext || {}) };
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
        // Subgraph nodes are executed internally by forEachNode, not by the main Kahn loop
        if (forEachManagedNodeIds.has(node.id)) {
          return;
        }

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
                notifyProgress(node.id, 'paused', { context: { ...context }, ...buildDebugPreview(node, context, normalizedEdges, nodes) });
                await new Promise<void>((resolve) => {
                  if (currentExec.resumeResolvers) {
                    currentExec.resumeResolvers[node.id] = () => resolve();
                  }
                });
              }

              notifyProgress(node.id, 'running');
              
              const isDebug = currentExec?.mode === 'debug';
              const delayMs = isDebug ? (node.type === 'start' ? 150 : 500) : 0;
              if (delayMs > 0) {
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
              }

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
                    output = await executeExportNode(node, context, edges, nodes);
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
                  case 'dataList':
                    output = executeDataListNode(node);
                    break;
                  case 'variables':
                    output = executeVariablesNode(node, context);
                    break;
                  case 'forEach':
                    output = await executeForEachNode(
                      node, context, normalizedEdges, nodes, adjList, notifyProgress,
                      abortController.signal, flowId
                    );
                    break;
                  case 'forEachEnd':
                    // Passthrough: inherit the accumulated results from the paired forEach node
                    {
                      const pairedForEach = nodes.find(
                        n => n.type === 'forEach' && findForEachEndNode(n.id, adjList, nodes) === node.id
                      );
                      if (pairedForEach && context[pairedForEach.id] !== undefined) {
                        output = context[pairedForEach.id];
                      } else if (context[node.id] !== undefined) {
                        output = context[node.id];
                      } else {
                        const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
                        for (const uid of upstreamIds) {
                          if (context[uid] !== undefined) {
                            output = context[uid];
                            break;
                          }
                        }
                      }
                      if (Array.isArray(output)) {
                        output = flattenRows(output);
                      }
                    }
                    break;
                  case 'conditionalBranch':
                    output = executeConditionalBranchNode(node, context);
                    break;
                  case 'jsonTransform':
                    try {
                      output = await executeJsonTransformNode(node, context, normalizedEdges, nodes);
                    } catch (err: any) {
                      if (currentExec?.mode === 'debug' && currentExec?.debugState === 'paused' && !currentExec?.skipHttpPauseForNode?.[node.id]) {
                        notifyProgress(node.id, 'paused', {
                          debugType: 'transform_error',
                          context: { ...context },
                          nodePreview: {
                            kind: 'transform_error',
                            error: err.message || String(err),
                            logs: Array.isArray(err._logs) ? err._logs : []
                          }
                        });
                        await new Promise<void>((resolve) => {
                          if (currentExec.resumeResolvers) {
                            currentExec.resumeResolvers[node.id] = () => resolve();
                          }
                        });
                      }
                      throw err;
                    }
                    if (currentExec?.mode === 'debug' && currentExec?.debugState === 'paused' && !currentExec?.skipHttpPauseForNode?.[node.id]) {
                      const unwrapData = output && typeof output === 'object' && output._data !== undefined ? output._data : output;
                      const logs = output && typeof output === 'object' && Array.isArray(output._logs) ? output._logs : [];
                      notifyProgress(node.id, 'paused', {
                        debugType: 'transform_result',
                        context: { ...context, [node.id]: output },
                        nodePreview: {
                          kind: 'transform_result',
                          output: unwrapData,
                          logs
                        }
                      });
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
                    break;
                  case 'webhookTrigger':
                    output = executeWebhookTriggerNode(node, context);
                    break;
                  case 'oauth2Connector':
                    output = await executeOAuth2ConnectorNode(node, context, abortController.signal);
                    break;
                  case 'aiChatCompletion':
                    output = await executeAiChatCompletionNode(node, context, abortController.signal);
                    break;
                  default:
                    output = { warning: 'Unknown node type' };
                }

                if (abortController.signal.aborted) {
                  throw new Error('Ejecución detenida por el usuario');
                }

                context[node.id] = output;
                if (node.data?.label && typeof node.data.label === 'string') {
                  context[node.data.label] = output;
                }
                completedNodes.add(node.id);
                if (node.type === 'forEach') {
                  const endId = findForEachEndNode(node.id, adjList, nodes);
                  if (endId) {
                    const subIds = getForEachSubgraphNodes(node.id, endId, adjList, nodes);
                    subIds.forEach(sid => completedNodes.add(sid));
                  }
                }
                notifyProgress(node.id, 'completed', output);

                if (node.type === 'conditionalBranch') {
                  const branchState: BranchSkipState = {
                    inDegree, initialInDegree, skippedIncoming, skippedNodes, completedNodes,
                    adjList, notify: notifyProgress
                  };
                  normalizedEdges
                    .filter(e => e.source === node.id)
                    .forEach(edge => {
                      if (edgeFollowsBranch(edge, output.selectedHandle)) {
                        inDegree[edge.target]--;
                      } else {
                        skipIncomingEdge(edge.target, branchState);
                      }
                    });
                } else if (adjList[node.id]) {
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
              scheduleExecutionCleanup(flowId, activeFlowExecutions.get(flowId));
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
        scheduleExecutionCleanup(flowId, activeFlowExecutions.get(flowId));
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

  // When executing inside a forEach loop, the outer loop already drives iteration item-by-item.
  // Sub-nodes must run exactly once per item, never performing batch iteration over the parent list.
  const isInsideForEach = context._item !== undefined || context._index !== undefined;

  if (!isInsideForEach) {
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
      const effectiveItem = item ?? context._item;
      const currentIterationInfo = itemsToIterate.length > 1
        ? { current: i + 1, total: itemsToIterate.length }
        : (context._index !== undefined ? { current: context._index + 1, total: context._total } : undefined);

      const requestPreview = {
        method,
        endpoint,
        headers,
        body: requestBody || null,
        params: node.data?.params || null,
        iteration: currentIterationInfo,
        item: effectiveItem
      };

      if (onNodeProgress) {
        onNodeProgress(node.id, 'paused', {
          debugType: 'http_request',
          requestPreview,
          context: { ...context, _item: effectiveItem }
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
      if (itemsToIterate.length > 1) {
        onNodeProgress(node.id, 'running', {
          current: i + 1,
          total: itemsToIterate.length
        });
      } else {
        onNodeProgress(node.id, 'running');
      }
    }

    // Dynamic HTTP network timeout: node-level setting > system setting > default 30s
    let httpTimeoutMs = 30000;
    if (node.data?.timeout) {
      const nodeSec = parseInt(node.data.timeout, 10);
      if (!isNaN(nodeSec) && nodeSec > 0) httpTimeoutMs = nodeSec * 1000;
    } else {
      try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM system_settings WHERE key = 'http_timeout_seconds'").get() as any;
        if (row?.value) {
          const sysSec = parseInt(row.value, 10);
          if (!isNaN(sysSec) && sysSec > 0) httpTimeoutMs = sysSec * 1000;
        }
      } catch {}
    }

    const fetchController = new AbortController();
    const timeoutSeconds = Math.round(httpTimeoutMs / 1000);
    const timeoutId = setTimeout(() => fetchController.abort(new Error(`Timeout de ${timeoutSeconds} segundos agotado`)), httpTimeoutMs);
    
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
    const shouldPauseAfterResponse = currentExec?.mode === 'debug' && currentExec?.debugState === 'paused' && !currentExec?.skipHttpPauseForNode?.[node.id];
    if (shouldPause || shouldPauseAfterResponse) {
      const currentIterationInfo = itemsToIterate.length > 1
        ? { current: i + 1, total: itemsToIterate.length }
        : (context._index !== undefined ? { current: context._index + 1, total: context._total } : undefined);

      const responsePreview = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        durationMs,
        headers: responseHeaders,
        data: parsedBody,
        iteration: currentIterationInfo
      };
      if (onNodeProgress) {
        onNodeProgress(node.id, 'paused', {
          debugType: 'http_response',
          responsePreview,
          current: context._index !== undefined ? context._index + 1 : (i + 1),
          total: context._total !== undefined ? context._total : itemsToIterate.length,
          context: { ...context, _item: item ?? context._item }
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
    } else if (Array.isArray(val) && !/^\d+$/.test(token) && token !== 'length' && !(token in val)) {
      // Field access on a row set (e.g. {{consulta.total}}) reads the first row
      const first = val[0];
      val = first !== null && typeof first === 'object' ? first[token] : undefined;
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
      if (data._data !== undefined) return flattenRows(data._data);
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
async function executeExportNode(node: any, context: Record<string, any>, edges?: any[], nodes?: any[]) {
  let fileName = node.data?.fileName || `exportacion_${new Date().toISOString().slice(0,10)}`;
  // Resolve template variables in fileName (e.g., {{_item.id_eds}} inside a forEach loop)
  if (typeof fileName === 'string' && fileName.includes('{{')) {
    fileName = resolveTemplate(context, fileName);
  }
  const format = node.data?.format || 'CSV';
  const dataSource = node.data?.dataSource as string | undefined;
  const columns = node.data?.columns as { header: string, key: string }[] | undefined;

  let rawData: any = null;

  if (dataSource && dataSource.trim() !== '') {
    const match = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = match ? match[1] : dataSource;
    rawData = resolvePath(context, pathStr);
  } else {
    // 1. Direct upstream from edges (e.g. forEachEnd -> export)
    if (edges && nodes) {
      const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
      for (const uid of upstreamIds) {
        if (context[uid] !== undefined && context[uid] !== null) {
          rawData = context[uid];
          break;
        }
      }
    }

    // 2. Fallback: reverse context keys to prioritize the latest executed upstream node (HTTP Request, forEachEnd, etc.)
    if (!rawData) {
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

  // Pre-build join index maps for O(1) matching: avoids O(N * M * C) freeze on large datasets
  const joins = (node.data?.joins as { nodeId: string, localKey: string, foreignKey: string }[]) || [];
  const joinLookups = new Map<string, { lookup: Map<string, any>; localKey: string; foreignKey: string }>();
  if (joins && Array.isArray(joins)) {
    for (const j of joins) {
      if (j.nodeId && j.localKey && j.foreignKey) {
        const targetData = context[j.nodeId];
        const flatTarget = flattenRows(targetData);
        if (flatTarget.length > 0) {
          const lookup = new Map<string, any>();
          const fkLower = j.foreignKey.toLowerCase();
          for (const r of flatTarget) {
            if (r && typeof r === 'object') {
              const actualKey = Object.keys(r).find(k => k.toLowerCase() === fkLower) || j.foreignKey;
              const val = r[actualKey];
              if (val !== undefined && val !== null) {
                lookup.set(String(val), r);
              }
            }
          }
          joinLookups.set(j.nodeId, { lookup, localKey: j.localKey, foreignKey: j.foreignKey });
        }
      }
    }
  }

  // Apply column mapping or auto-merge joined columns
  let exportData: any[] = baseData;
  if (columns && columns.length > 0 && Array.isArray(baseData)) {
    exportData = baseDataWrapped.map((wrappedItem, itemIndex) => {
      const { item } = wrappedItem;
      const row: Record<string, any> = {};

      // Pre-fetch matches from joins for this item (O(1) lookups per item)
      const joinedRowMatches = new Map<string, any>();
      for (const [joinNodeId, { lookup, localKey }] of joinLookups) {
        const lkLower = localKey.toLowerCase();
        const actualLocalKey = Object.keys(item).find(k => k.toLowerCase() === lkLower) || localKey;
        const localVal = item[actualLocalKey];
        if (localVal !== undefined && localVal !== null) {
          const matchedRow = lookup.get(String(localVal));
          if (matchedRow) {
            joinedRowMatches.set(joinNodeId, matchedRow);
          }
        }
      }

      for (const col of columns) {
        if (col.header && col.key) {
          if (col.key.includes('{{') && col.key.includes('}}')) {
             row[col.header] = resolveTemplate({ ...context, _item: item, _index: itemIndex }, col.key) ?? '';
          } else {
            // 1. Resolve dot-notation key on item
            const parts = col.key.split('.');
            let val: any = item;
            for (const part of parts) {
              if (val === undefined || val === null) break;
              val = val[part];
            }
            
            // 2. Check if val is present in matched joined node rows
            if (val === undefined || val === null) {
              for (const matchedRow of joinedRowMatches.values()) {
                if (col.key in matchedRow) {
                  val = matchedRow[col.key];
                  break;
                }
              }
            }

            // 3. Fallback: Resolve as a direct path in global context
            if (val === undefined || val === null) {
              val = resolvePath(context, col.key);
            }
            
            row[col.header] = val ?? '';
          }
        }
      }
      return row;
    });
  } else if (joinLookups.size > 0 && Array.isArray(baseData)) {
    // If no custom column mapping was specified, automatically merge joined node fields
    exportData = baseData.map(item => {
      const merged = { ...item };
      for (const [, { lookup, localKey }] of joinLookups) {
        const lkLower = localKey.toLowerCase();
        const actualLocalKey = Object.keys(item).find(k => k.toLowerCase() === lkLower) || localKey;
        const localVal = item[actualLocalKey];
        if (localVal !== undefined && localVal !== null) {
          const matched = lookup.get(String(localVal));
          if (matched && typeof matched === 'object') {
            Object.assign(merged, matched);
          }
        }
      }
      return merged;
    });
  }

  const dataDir = path.join(process.cwd(), 'data', 'exports');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const isExcel = format === 'Excel';
  const ext = isExcel ? '.xlsx' : '.csv';
  const cleanedFileName = String(fileName).replace(/[<>:"/\\|?*\r\n\t]/g, '_').trim();
  const safeFileName = cleanedFileName.endsWith(ext) ? cleanedFileName : (cleanedFileName.replace(/\.(csv|xlsx|json)$/i, '') + ext);
  let filePath = path.join(dataDir, safeFileName);

  if (isExcel) {
    // Generate .xlsx with ExcelJS
    const workbook = new ExcelJS.Workbook();
    
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
        if (!sheetName || sheetName.trim() === '') {
          sheetName = `Hoja_${nodeId.substring(0, 5)}`;
        }
        
        let sheetData = context[nodeId];
        if (!sheetData) continue;
        
        const flatData = flattenRows(sheetData);
        if (flatData.length === 0) continue;
        
        const sheet = workbook.addWorksheet(sheetName.substring(0, 31));
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

      const allKeysSet = new Set<string>();
      for (const row of exportData) {
        if (typeof row === 'object' && row !== null) {
          Object.keys(row).forEach(k => allKeysSet.add(k));
        }
      }
      const headers = allKeysSet.size > 0 
        ? Array.from(allKeysSet) 
        : (exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null ? Object.keys(exportData[0]) : []);

      if (exportData.length > 0 && headers.length > 0) {
        sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 16) }));
        const headerRow = sheet.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: parsedColor ? `FF${parsedColor.length === 3 ? parsedColor.split('').map(c => c+c).join('') : parsedColor}` : 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        exportData.forEach(row => {
          const dataRow = sheet.addRow(headers.map(h => {
            const v = (typeof row === 'object' && row !== null) ? row[h] : row;
            return (v === null || v === undefined) ? '' : v;
          }));
          dataRow.height = 18;
        });
      }
    }

    // Use writeBuffer and atomic write to avoid stream hangs and handle Excel file lock
    const buffer = await workbook.xlsx.writeBuffer();
    try {
      fs.writeFileSync(filePath, Buffer.from(buffer));
    } catch (err: any) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
        const fileExt = path.extname(safeFileName);
        const base = path.basename(safeFileName, fileExt);
        filePath = path.join(dataDir, `${base}_${timestamp}${fileExt}`);
        fs.writeFileSync(filePath, Buffer.from(buffer));
      } else {
        throw err;
      }
    }

  } else {
    // Generate CSV
    const allKeysSet = new Set<string>();
    for (const row of exportData) {
      if (typeof row === 'object' && row !== null) {
        Object.keys(row).forEach(k => allKeysSet.add(k));
      }
    }
    const headers = allKeysSet.size > 0 
      ? Array.from(allKeysSet) 
      : (exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null ? Object.keys(exportData[0]) : []);

    let csvContent = '';
    if (exportData.length > 0 && headers.length > 0) {
      const csvRows = [headers.join(',')];

      for (const row of exportData) {
        const values = headers.map(header => {
          const val = (typeof row === 'object' && row !== null) ? row[header] : row;
          const strVal = (val === null || val === undefined) ? '' : String(val);
          if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
            return `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        });
        csvRows.push(values.join(','));
      }
      csvContent = csvRows.join('\n');
    } else {
      csvContent = exportData.join('\n');
    }

    try {
      fs.writeFileSync(filePath, csvContent, 'utf8');
    } catch (err: any) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
        const fileExt = path.extname(safeFileName);
        const base = path.basename(safeFileName, fileExt);
        filePath = path.join(dataDir, `${base}_${timestamp}${fileExt}`);
        fs.writeFileSync(filePath, csvContent, 'utf8');
      } else {
        throw err;
      }
    }
  }

  const previewRows = exportData.slice(0, 1000);
  const sampleHeaders = exportData.length > 0 && typeof exportData[0] === 'object' && exportData[0] !== null
    ? Object.keys(exportData[0])
    : [];

  return {
    filePath,
    fileName: safeFileName,
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
    
    if (sourceNode.type === 'timer' || sourceNode.type === 'delay' || sourceNode.type === 'conditionalBranch') {
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

// DataList Node Handler: parses a static JSON array defined by the user in the node inspector
function executeDataListNode(node: any): any[] {
  const itemsStr = node.data?.items;
  if (!itemsStr || (typeof itemsStr === 'string' && itemsStr.trim() === '')) {
    return [];
  }

  let parsed: any;
  if (typeof itemsStr === 'string') {
    try {
      parsed = JSON.parse(itemsStr);
    } catch (e) {
      throw new Error(`DataList: JSON invalido - ${(e as Error).message}`);
    }
  } else {
    parsed = itemsStr;
  }

  if (!Array.isArray(parsed)) {
    throw new Error('DataList: El contenido debe ser un array JSON (ej: [{ "id": 1 }, { "id": 2 }])');
  }

  return parsed;
}

// Variables Node Handler: evaluates a dictionary of variables (static, typed, dynamic dates or templates)
function executeVariablesNode(node: any, context: Record<string, any>): Record<string, any> {
  const vars = node.data?.variables;
  const result: Record<string, any> = {};

  if (!Array.isArray(vars) || vars.length === 0) {
    if (node.data?.rawJson && typeof node.data.rawJson === 'string' && node.data.rawJson.trim() !== '') {
      try {
        const parsed = JSON.parse(node.data.rawJson);
        if (typeof parsed === 'object' && parsed !== null) {
          return resolveTemplate(context, parsed);
        }
      } catch (e: any) {
        throw new Error(`Variables: JSON inválido - ${e.message}`);
      }
    }
    return {};
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayYMD = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayYMD = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
  const yesterdayISO = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

  const monthStart = `${now.getFullYear()}${pad(now.getMonth() + 1)}01`;
  const monthStartISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

  for (const v of vars) {
    if (!v || !v.key || typeof v.key !== 'string' || !v.key.trim()) continue;
    const key = v.key.trim();
    const type = v.type || 'string';
    let val: any = v.value;

    if (typeof val === 'string' && val.includes('{{')) {
      val = resolveTemplate(context, val);
    }

    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (lower === '$today' || lower === '$hoy' || lower === '$today_ymd') {
        val = todayYMD;
      } else if (lower === '$today_iso' || lower === '$hoy_iso') {
        val = todayISO;
      } else if (lower === '$yesterday' || lower === '$ayer' || lower === '$yesterday_ymd') {
        val = yesterdayYMD;
      } else if (lower === '$yesterday_iso' || lower === '$ayer_iso') {
        val = yesterdayISO;
      } else if (lower === '$month_start' || lower === '$inicio_mes') {
        val = monthStart;
      } else if (lower === '$month_start_iso' || lower === '$inicio_mes_iso') {
        val = monthStartISO;
      } else if (lower === '$now_timestamp' || lower === '$timestamp') {
        val = Date.now();
      } else if (lower === '$now_iso') {
        val = now.toISOString();
      }
    }

    if (type === 'number') {
      const num = Number(val);
      result[key] = isNaN(num) ? 0 : num;
    } else if (type === 'boolean') {
      result[key] = val === true || val === 'true' || val === 1 || val === '1';
    } else if (type === 'json') {
      if (typeof val === 'string') {
        try {
          result[key] = JSON.parse(val);
        } catch {
          result[key] = val;
        }
      } else {
        result[key] = val;
      }
    } else if (type === 'date') {
      result[key] = val != null ? String(val) : todayISO;
    } else {
      result[key] = val != null ? String(val) : '';
    }
  }

  return result;
}

// Locate the paired forEachEnd node for a given forEach node using BFS through adjList
function findForEachEndNode(
  forEachNodeId: string,
  adjList: Record<string, string[]>,
  nodes: any[]
): string | null {
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = nodes.find(n => n.id === current);
    if (node && node.type === 'forEachEnd') {
      return current;
    }

    // Continue BFS to descendants
    for (const next of (adjList[current] || [])) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return null;
}

// Extract all node IDs that are strictly between a forEach and its forEachEnd (exclusive of both)
function getForEachSubgraphNodes(
  forEachNodeId: string,
  forEachEndNodeId: string,
  adjList: Record<string, string[]>,
  nodes: any[]
): string[] {
  const subgraphNodes: string[] = [];
  const visited = new Set<string>();
  const queue = [...(adjList[forEachNodeId] || [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Don't include the forEachEnd itself in the subgraph body
    if (current === forEachEndNodeId) continue;

    subgraphNodes.push(current);

    // Continue to descendants (but stop at forEachEnd)
    for (const next of (adjList[current] || [])) {
      if (!visited.has(next) && next !== forEachEndNodeId) {
        queue.push(next);
      }
    }
  }

  return subgraphNodes;
}

// ForEach Node Handler: iterates over an array and re-executes the sub-graph for each item
async function executeForEachNode(
  node: any,
  context: Record<string, any>,
  edges: any[],
  nodes: any[],
  adjList: Record<string, string[]>,
  onNodeProgress: (nodeId: string, status: 'running' | 'completed' | 'error' | 'progress' | 'paused', result?: any) => void,
  signal: AbortSignal,
  flowId: string
): Promise<any[]> {
  // Resolve the array to iterate over
  const iterateOverExpr = node.data?.iterateOver;
  let items: any[] = [];

  if (iterateOverExpr && iterateOverExpr.trim() !== '') {
    const resolved = resolveTemplate(context, iterateOverExpr);
    if (Array.isArray(resolved)) {
      items = resolved;
    } else if (resolved !== undefined && resolved !== null) {
      items = [resolved];
    }
  } else {
    // Auto-detect: find first array in context from upstream nodes
    const upstreamIds = getEffectiveDataSources(node.id, edges, nodes);
    for (const uid of upstreamIds) {
      if (Array.isArray(context[uid])) {
        items = context[uid];
        break;
      }
    }
  }

  if (items.length === 0) {
    onNodeProgress(node.id, 'completed', { iterations: 0, results: [] });
    context[node.id] = [];
    const forEachEndId = findForEachEndNode(node.id, adjList, nodes);
    if (forEachEndId) {
      context[forEachEndId] = [];
    }
    return [];
  }

  // Find the paired forEachEnd node
  const forEachEndId = findForEachEndNode(node.id, adjList, nodes);
  if (!forEachEndId) {
    throw new Error('ForEach: No se encontro un nodo "Fin de bucle" conectado. Conecta un nodo forEachEnd despues del sub-flujo.');
  }

  // Get the sub-graph nodes (between forEach and forEachEnd)
  const subgraphNodeIds = getForEachSubgraphNodes(node.id, forEachEndId, adjList, nodes);
  const subgraphNodes = nodes.filter(n => subgraphNodeIds.includes(n.id));

  if (subgraphNodes.length === 0) {
    onNodeProgress(node.id, 'completed', { iterations: 0, results: [] });
    context[node.id] = [];
    if (forEachEndId) {
      context[forEachEndId] = [];
    }
    return [];
  }

  const terminalEdges = edges.filter(
    e => e.target === forEachEndId && subgraphNodeIds.includes(e.source)
  );

  // Build local adjList and compute base inDegree for the sub-graph
  const subAdjList: Record<string, string[]> = {};
  const baseInDegree: Record<string, number> = {};

  subgraphNodes.forEach(n => {
    subAdjList[n.id] = [];
    baseInDegree[n.id] = 0;
  });

  // Only include edges whose source and target are both in the sub-graph
  const subEdges = edges.filter(
    e => subgraphNodeIds.includes(e.source) && subgraphNodeIds.includes(e.target)
  );

  // Also include edges from the forEach node to sub-graph nodes (these start with inDegree 0)
  const forEachOutEdges = edges.filter(
    e => e.source === node.id && subgraphNodeIds.includes(e.target)
  );

  subEdges.forEach(edge => {
    if (subAdjList[edge.source]) {
      subAdjList[edge.source].push(edge.target);
      baseInDegree[edge.target] = (baseInDegree[edge.target] || 0) + 1;
    }
  });

  // Nodes directly connected from forEach start with inDegree 0 (already initialized)
  // No need to adjust because we excluded the forEach->subgraph edges from inDegree calc

  const currentExec = flowId ? activeFlowExecutions.get(flowId) : undefined;
  if (currentExec?.mode === 'debug' && currentExec?.debugState === 'paused') {
    onNodeProgress(node.id, 'paused', {
      debugType: 'forEach_start',
      items,
      totalItems: items.length,
      current: 0,
      total: items.length,
      context: { ...context, [node.id]: items, _items: items }
    });
    await new Promise<void>((resolve) => {
      if (currentExec.resumeResolvers) {
        currentExec.resumeResolvers[node.id] = () => resolve();
      }
    });
  }

  const iterationResults: any[] = [];

  // Sequential iteration over each item
  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) {
      throw new Error('Ejecucion detenida por el usuario');
    }

    const item = items[i];

    // Emit progress for the forEach node itself
    onNodeProgress(node.id, 'progress', { current: i + 1, total: items.length, item });

    // Create a local context for this iteration
    const localContext: Record<string, any> = {
      ...context,
      _item: item,
      item: item,
      _index: i,
      _total: items.length,
      [node.id]: item
    };

    // Reset sub-graph state for this iteration
    const localInDegree = { ...baseInDegree };
    const localCompleted = new Set<string>();
    const localSkipped = new Set<string>();
    const localSkippedIncoming: Record<string, number> = {};
    const localRunning = new Map<string, Promise<void>>();
    let iterationError = false;
    let lastOutput: any = null;

    // Mini-Kahn execution for the sub-graph
    await new Promise<void>((resolve, reject) => {
      const checkAndRunLocal = () => {
        if (iterationError || signal.aborted) return;

        let allDone = true;

        subgraphNodes.forEach(subNode => {
          if (!localCompleted.has(subNode.id) && !iterationError) {
            allDone = false;

            if (localInDegree[subNode.id] === 0 && !localRunning.has(subNode.id)) {
              const p = (async () => {
                if (signal.aborted) throw new Error('Ejecucion detenida por el usuario');

                const isHttpNode = ['httpGet', 'httpPost', 'httpRequest'].includes(subNode.type);
                const currentExec = flowId ? activeFlowExecutions.get(flowId) : undefined;
                if (!isHttpNode && currentExec?.mode === 'debug' && currentExec?.debugState === 'paused') {
                  onNodeProgress(subNode.id, 'paused', {
                    context: { ...localContext },
                    iteration: { current: i + 1, total: items.length, item },
                    ...buildDebugPreview(subNode, localContext, edges, nodes, { current: i + 1, total: items.length })
                  });
                  await new Promise<void>((resolve) => {
                    if (currentExec.resumeResolvers) {
                      currentExec.resumeResolvers[subNode.id] = () => resolve();
                    }
                  });
                }

                onNodeProgress(subNode.id, 'running');

                // Animation delay only in debug mode
                const isSubDebug = currentExec?.mode === 'debug';
                const delayMs = isSubDebug ? 250 : 0;
                if (delayMs > 0) {
                  await new Promise<void>((res, rej) => {
                    if (signal.aborted) return rej(new Error('Ejecucion detenida por el usuario'));
                    const t = setTimeout(res, delayMs);
                    const onAbort = () => { clearTimeout(t); signal.removeEventListener('abort', onAbort); rej(new Error('Ejecucion detenida por el usuario')); };
                    signal.addEventListener('abort', onAbort, { once: true });
                  });
                }

                if (signal.aborted) throw new Error('Ejecucion detenida por el usuario');

                try {
                  let output: any = {};
                  switch (subNode.type) {
                    case 'start':
                      output = { msg: 'Flow started' };
                      break;
                    case 'httpGet':
                    case 'httpPost':
                    case 'httpRequest':
                      output = await executeHttpNode(subNode, localContext, onNodeProgress, signal, flowId);
                      break;
                    case 'scraping':
                      output = await executeScrapingNode(subNode, localContext, signal);
                      break;
                    case 'export':
                      output = await executeExportNode(subNode, localContext, edges, nodes);
                      break;
                    case 'query':
                      output = await executeQueryNode(subNode, localContext, signal);
                      break;
                    case 'timer':
                    case 'delay':
                      output = await executeTimerNode(subNode, (status, res) => onNodeProgress(subNode.id, status, res), signal);
                      {
                        const timerUpstreamIds = getEffectiveDataSources(subNode.id, edges, nodes);
                        if (timerUpstreamIds.length > 0 && localContext[timerUpstreamIds[0]]) {
                          output = localContext[timerUpstreamIds[0]];
                        }
                      }
                      break;
                    case 'dataSource':
                    case 'fileSource':
                      output = await executeDataSourceNode(subNode, localContext, signal, edges, nodes);
                      break;
                    case 'dataList':
                      output = executeDataListNode(subNode);
                      break;
                    case 'variables':
                      output = executeVariablesNode(subNode, localContext);
                      break;
                    case 'conditionalBranch':
                      output = executeConditionalBranchNode(subNode, localContext);
                      break;
                    case 'jsonTransform': {
                      output = await executeJsonTransformNode(subNode, localContext, edges, nodes);
                      const currentExec = flowId ? activeFlowExecutions.get(flowId) : undefined;
                      if (currentExec?.mode === 'debug' && currentExec?.debugState === 'paused' && !currentExec?.skipHttpPauseForNode?.[subNode.id]) {
                        const unwrapData = output && typeof output === 'object' && output._data !== undefined ? output._data : output;
                        const logs = output && typeof output === 'object' && Array.isArray(output._logs) ? output._logs : [];
                        onNodeProgress(subNode.id, 'paused', {
                          debugType: 'transform_result',
                          context: { ...localContext, [subNode.id]: output },
                          nodePreview: {
                            kind: 'transform_result',
                            output: unwrapData,
                            logs
                          }
                        });
                        const resumeAction = await new Promise<string>((resolve) => {
                          if (currentExec.resumeResolvers) {
                            currentExec.resumeResolvers[subNode.id] = (act?: string) => resolve(act || 'step');
                          }
                        });
                        if (resumeAction === 'continue_node') {
                          if (!currentExec.skipHttpPauseForNode) currentExec.skipHttpPauseForNode = {};
                          currentExec.skipHttpPauseForNode[subNode.id] = true;
                        }
                      }
                      break;
                    }
                    case 'oauth2Connector':
                      output = await executeOAuth2ConnectorNode(subNode, localContext, signal);
                      break;
                    case 'aiChatCompletion':
                      output = await executeAiChatCompletionNode(subNode, localContext, signal);
                      break;
                    default:
                      output = { warning: 'Unknown node type' };
                  }

                  localContext[subNode.id] = output;
                  if (subNode.data?.label && typeof subNode.data.label === 'string') {
                    localContext[subNode.data.label] = output;
                  }
                  if (subNode.type !== 'conditionalBranch') lastOutput = output;
                  localCompleted.add(subNode.id);
                  onNodeProgress(subNode.id, 'completed', output);

                  if (subNode.type === 'conditionalBranch') {
                    const branchState: BranchSkipState = {
                      inDegree: localInDegree,
                      initialInDegree: baseInDegree,
                      skippedIncoming: localSkippedIncoming,
                      skippedNodes: localSkipped,
                      completedNodes: localCompleted,
                      adjList: subAdjList,
                      notify: onNodeProgress
                    };
                    subEdges
                      .filter(e => e.source === subNode.id)
                      .forEach(edge => {
                        if (edgeFollowsBranch(edge, output.selectedHandle)) {
                          localInDegree[edge.target]--;
                        } else {
                          skipIncomingEdge(edge.target, branchState);
                        }
                      });
                  } else if (subAdjList[subNode.id]) {
                    subAdjList[subNode.id].forEach(depId => {
                      localInDegree[depId]--;
                    });
                  }
                } catch (err: any) {
                  iterationError = true;
                  onNodeProgress(subNode.id, 'error', { error: err.message });
                  throw err;
                }
              })();

              localRunning.set(subNode.id, p);

              p.then(() => {
                localRunning.delete(subNode.id);
                checkAndRunLocal();
              }).catch(err => {
                localRunning.delete(subNode.id);
                reject(err);
              });
            }
          }
        });

        if (allDone && localRunning.size === 0) {
          resolve();
        }
      };

      checkAndRunLocal();
    });

    let subResult: any = lastOutput;
    if (terminalEdges.length > 0) {
      const activeTerminal = terminalEdges.find(e => {
        if (localSkipped.has(e.source)) return false;
        const out = localContext[e.source];
        if (nodes.find(n => n.id === e.source)?.type === 'conditionalBranch') {
          return edgeFollowsBranch(e, out?.selectedHandle);
        }
        return out !== undefined;
      });
      if (!activeTerminal) {
        continue;
      }
      const terminalIsConditional = nodes.find(n => n.id === activeTerminal.source)?.type === 'conditionalBranch';
      subResult = terminalIsConditional ? item : localContext[activeTerminal.source];
    }

    // Flatten rows from subResult and enrich with parent item metadata
    const flatSub = flattenRows(subResult);
    if (flatSub.length > 0) {
      const mergedRows = flatSub.map(row => {
        if (typeof row === 'object' && row !== null && typeof item === 'object' && item !== null && !Array.isArray(item)) {
          return { ...item, ...row };
        }
        return row;
      });
      iterationResults.push(...mergedRows);
    } else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      if (typeof subResult === 'object' && subResult !== null) {
        iterationResults.push({ ...item, ...subResult });
      } else if (subResult !== undefined && subResult !== null) {
        iterationResults.push({ ...item, resultado: subResult });
      } else {
        iterationResults.push({ ...item });
      }
    } else {
      iterationResults.push(subResult);
    }

    // Propagate accumulated results back to main context for both forEach and forEachEnd
    context[node.id] = iterationResults;
    if (forEachEndId) {
      context[forEachEndId] = iterationResults;
    }
  }

  context[node.id] = iterationResults;
  if (forEachEndId) {
    context[forEachEndId] = iterationResults;
  }

  return iterationResults;
}


// -------------------------------------------------------------
// Branching, transformation and experimental nodes
// -------------------------------------------------------------

export const EXPERIMENTAL_NODE_TYPES = ['webhookTrigger', 'oauth2Connector', 'aiChatCompletion'];

function isBranchHandle(handle?: string | null): boolean {
  if (!handle) return false;
  return handle === 'true' || handle === 'false' || handle === 'default' || handle.startsWith('case_');
}

function edgeFollowsBranch(edge: any, selectedHandle?: string): boolean {
  if (!isBranchHandle(edge.sourceHandle)) return true;
  return edge.sourceHandle === selectedHandle;
}

interface BranchSkipState {
  inDegree: Record<string, number>;
  initialInDegree: Record<string, number>;
  skippedIncoming: Record<string, number>;
  skippedNodes: Set<string>;
  completedNodes: Set<string>;
  adjList: Record<string, string[]>;
  notify: (nodeId: string, status: any, result?: any) => void;
}

// A node is skipped only when every one of its inputs comes from a non-selected branch;
// merge nodes that still receive an active input run normally.
function skipIncomingEdge(targetId: string, state: BranchSkipState): void {
  if (state.completedNodes.has(targetId) || !(targetId in state.inDegree)) return;
  state.inDegree[targetId]--;
  state.skippedIncoming[targetId] = (state.skippedIncoming[targetId] || 0) + 1;
  if (state.inDegree[targetId] > 0) return;
  if (state.skippedIncoming[targetId] < (state.initialInDegree[targetId] || 0)) return;

  state.skippedNodes.add(targetId);
  state.completedNodes.add(targetId);
  state.notify(targetId, 'completed', { skipped: true, reason: 'Rama condicional no seleccionada' });
  for (const next of state.adjList[targetId] || []) {
    skipIncomingEdge(next, state);
  }
}

// ── Conditional branch ──

interface ConditionRule {
  id?: string;
  left?: string;
  operator?: string;
  right?: string;
}

const OPERATOR_ALIASES: Record<string, string> = {
  greater_than: 'gt',
  greater_equal: 'gte',
  greater_or_equal: 'gte',
  less_than: 'lt',
  less_equal: 'lte',
  less_or_equal: 'lte',
  is_null: 'is_empty',
  is_not_null: 'is_not_empty',
};

const UNARY_OPERATORS = ['is_empty', 'is_not_empty', 'is_true', 'is_false'];

function resolveOperand(context: Record<string, any>, raw: unknown): any {
  if (raw === undefined || raw === null) return '';
  const text = String(raw);
  if (text.includes('{{')) return resolveTemplate(context, text);
  const trimmed = text.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? quoted[2] : trimmed;
}

function toNumber(value: any): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toTimestamp(value: any): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : t;
}

function toText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function isEmptyValue(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function valuesEqual(a: any, b: any): boolean {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return toText(a).toLowerCase() === toText(b).toLowerCase();
}

function compareOrdered(a: any, b: any): number | null {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na - nb;
  const ta = toTimestamp(a);
  const tb = toTimestamp(b);
  if (ta !== null && tb !== null) return ta - tb;
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return toText(a).localeCompare(toText(b), 'es', { sensitivity: 'base', numeric: true });
}

function evaluateRule(operator: string, left: any, right: any): boolean {
  switch (operator) {
    case 'equals':
      return valuesEqual(left, right);
    case 'not_equals':
      return !valuesEqual(left, right);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareOrdered(left, right);
      if (cmp === null) return false;
      if (operator === 'gt') return cmp > 0;
      if (operator === 'gte') return cmp >= 0;
      if (operator === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    case 'contains':
      return Array.isArray(left)
        ? left.some(v => valuesEqual(v, right))
        : toText(left).toLowerCase().includes(toText(right).toLowerCase());
    case 'not_contains':
      return !evaluateRule('contains', left, right);
    case 'starts_with':
      return toText(left).toLowerCase().startsWith(toText(right).toLowerCase());
    case 'ends_with':
      return toText(left).toLowerCase().endsWith(toText(right).toLowerCase());
    case 'in_list': {
      const list = Array.isArray(right) ? right : toText(right).split(',').map(s => s.trim()).filter(Boolean);
      return list.some(v => valuesEqual(left, v));
    }
    case 'regex':
      try {
        return new RegExp(toText(right), 'i').test(toText(left));
      } catch {
        throw new Error(`Expresión regular inválida: ${toText(right)}`);
      }
    case 'is_empty':
      return isEmptyValue(left);
    case 'is_not_empty':
      return !isEmptyValue(left);
    case 'is_true':
      return left === true || ['true', '1', 'si', 'sí', 'yes'].includes(toText(left).toLowerCase());
    case 'is_false':
      return left === false || ['false', '0', 'no'].includes(toText(left).toLowerCase());
    default:
      throw new Error(`Operador de comparación desconocido: ${operator}`);
  }
}

function getConditionRules(data: any): ConditionRule[] {
  if (Array.isArray(data?.conditions) && data.conditions.length > 0) return data.conditions;
  return [{ left: data?.leftOperand ?? '', operator: data?.operator || 'equals', right: data?.rightOperand ?? '' }];
}

export function normalizeSwitchCases(cases: any): Array<{ id: string; value: string; label?: string }> {
  if (!Array.isArray(cases)) return [];
  return cases.map((c: any, idx: number) =>
    typeof c === 'string'
      ? { id: String(idx + 1), value: c }
      : { id: String(c?.id ?? idx + 1), value: String(c?.value ?? ''), label: c?.label }
  );
}

function executeConditionalBranchNode(node: any, context: Record<string, any>) {
  const data = node.data || {};
  const mode = data.mode === 'switch' ? 'switch' : 'if_else';

  if (mode === 'switch') {
    const expression = data.switchField ?? data.switchValue ?? '';
    const switchValue = resolveOperand(context, expression);
    const cases = normalizeSwitchCases(data.cases);
    const matched = cases.find(c => valuesEqual(switchValue, resolveOperand(context, c.value)));
    const selectedHandle = matched ? `case_${matched.id}` : 'default';
    return {
      mode,
      result: matched ? matched.value : 'default',
      selectedHandle,
      branchLabel: matched ? (matched.label || matched.value) : 'Por defecto',
      switchExpression: expression,
      switchValue,
    };
  }

  const combinator = data.combinator === 'or' ? 'or' : 'and';
  const evaluations = getConditionRules(data).map(rule => {
    const operator = OPERATOR_ALIASES[rule.operator || ''] || rule.operator || 'equals';
    const unary = UNARY_OPERATORS.includes(operator);
    const leftValue = resolveOperand(context, rule.left);
    const rightValue = unary ? undefined : resolveOperand(context, rule.right);
    return {
      left: rule.left,
      operator,
      right: unary ? undefined : rule.right,
      leftValue,
      rightValue,
      passed: evaluateRule(operator, leftValue, rightValue),
    };
  });

  const isMatch = combinator === 'or' ? evaluations.some(e => e.passed) : evaluations.every(e => e.passed);
  return {
    mode,
    result: isMatch,
    selectedHandle: isMatch ? 'true' : 'false',
    branchLabel: isMatch ? 'Sí' : 'No',
    combinator,
    evaluations,
  };
}

// ── JSON transform ──

function resolveTransformInput(node: any, context: Record<string, any>, edges: any[], nodes: any[]): any {
  const expr = String(node.data?.inputData ?? node.data?.inputDataSource ?? '').trim();
  let val: any;
  if (expr) {
    val = resolveTemplate(context, expr);
  } else {
    for (const upstreamId of getEffectiveDataSources(node.id, edges, nodes)) {
      if (context[upstreamId] !== undefined) {
        val = context[upstreamId];
        break;
      }
    }
    if (val === undefined) val = context._item;
  }
  if (val && typeof val === 'object' && val._data !== undefined && Array.isArray(val._logs)) {
    return val._data;
  }
  return val;
}

function getTransformMappings(data: any): Array<{ from: string; to: string }> {
  if (Array.isArray(data?.mappings)) {
    return data.mappings
      .filter((m: any) => m && String(m.from || '').trim())
      .map((m: any) => ({ from: String(m.from).trim(), to: String(m.to || m.from).trim() }));
  }
  const legacy = String(data?.pickFields ?? data?.fields ?? '');
  return legacy.split(',').map(s => s.trim()).filter(Boolean).map(f => ({ from: f, to: f }));
}

function mapRecord(row: any, mappings: Array<{ from: string; to: string }>, keepOthers: boolean, context: Record<string, any>) {
  if (row === null || typeof row !== 'object') return row;
  const out: Record<string, any> = keepOthers ? { ...row } : {};
  for (const { from, to } of mappings) {
    if (from.includes('{{')) {
      out[to] = resolveTemplate({ ...context, _item: row, item: row }, from);
      continue;
    }
    let value = evaluatePathOnObject(row, from);
    if (value === undefined) {
      const key = Object.keys(row).find(k => k.toLowerCase() === from.toLowerCase());
      value = key !== undefined ? row[key] : null;
    }
    if (keepOthers && from !== to && !from.includes('.')) delete out[from];
    out[to] = value ?? null;
  }
  return out;
}

function extractRowSet(input: any): any[] | null {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && (Array.isArray(input.rows) || Array.isArray(input.data) || Array.isArray(input.items))) {
    return flattenRows(input);
  }
  return null;
}

const TRANSFORM_TIMEOUT_MS = 5000;

// Lets users write either a bare expression (data.length) or statements without a return
function compilesAsExpression(code: string): boolean {
  try {
    new vm.Script(`(${code}\n)`);
    return true;
  } catch {
    return false;
  }
}

function runTransformScript(code: string, data: any, context: Record<string, any>): { result: any; _logs: Array<{ level: string; args: string[]; ts: number; tableData?: any }> } {
  // {{ruta}} inside the script is replaced by a correctly quoted JSON literal
  const body = code.replace(/\{\{([^}]+)\}\}/g, (_m, pathStr: string) => JSON.stringify(resolvePath(context, pathStr) ?? null));
  const fnBody = /\breturn\b/.test(body) || !compilesAsExpression(body) ? body : `return (${body}\n);`;
  
  // Check if user declared a function by name at top-level e.g. function miTransformacion(...)
  const fnMatch = body.match(/(?:^|\n)\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  const declaredFnName = fnMatch ? fnMatch[1] : null;

  const payload = JSON.stringify({
    data: data ?? null,
    context: context || {},
    item: context?._item ?? null,
    index: context?._index ?? null,
  });

  // Data is re-created inside the isolated context so the script never touches host objects.
  // A safe console object captures log/info/warn/error/table/debug/checkpoint calls into __logs.
  const script = `
    const __logs = [];
    function __fmt(v) { try { return typeof v === 'object' ? JSON.stringify(v) : String(v); } catch { return String(v); } }
    const console = {
      log:   function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'log',   args:a, ts:Date.now()}); },
      info:  function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'info',  args:a, ts:Date.now()}); },
      warn:  function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'warn',  args:a, ts:Date.now()}); },
      error: function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'error', args:a, ts:Date.now()}); },
      debug: function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'debug', args:a, ts:Date.now()}); },
      dir:   function() { const a=[]; for(let i=0;i<arguments.length;i++) a.push(__fmt(arguments[i])); __logs.push({level:'log',   args:a, ts:Date.now()}); },
      table: function(t) {
        let s = ''; try { s = typeof t === 'object' ? JSON.stringify(t) : String(t); } catch(e) { s = String(t); }
        __logs.push({level:'table', args:[s], ts:Date.now(), tableData: t});
      },
      checkpoint: function(label, v) {
        const a = [String(label || 'Punto de control')];
        if (arguments.length > 1) a.push(__fmt(v));
        __logs.push({level:'checkpoint', args:a, ts:Date.now()});
      }
    };
    const __in = JSON.parse(__payload);
    let __result = undefined;
    let __error = null;
    try {
      __result = (function (data, context, item, index) {
        "use strict";
        ${fnBody}
        ${declaredFnName ? `\ntry { if (typeof ${declaredFnName} === 'function') return ${declaredFnName}(data, context); } catch(e) { return ${declaredFnName}(data); }` : ''}
      })(__in.data, __in.context, __in.item, __in.index);
    } catch(err) {
      __error = err ? (err.message || String(err)) : 'Error en la ejecución';
    }
    JSON.stringify({ result: __result === undefined ? null : __result, _logs: __logs, error: __error });
  `;

  try {
    const serialized = vm.runInNewContext(script, { __payload: payload }, { timeout: TRANSFORM_TIMEOUT_MS, filename: 'transformacion.js' });
    const parsed = JSON.parse(serialized);
    if (parsed.error) {
      const err = new Error(`Error en la transformación JavaScript: ${parsed.error}`) as any;
      err._logs = Array.isArray(parsed._logs) ? parsed._logs : [];
      throw err;
    }
    return { result: parsed.result, _logs: Array.isArray(parsed._logs) ? parsed._logs : [] };
  } catch (e: any) {
    if (e?._logs) {
      throw e;
    }
    if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`La transformación superó el límite de ${TRANSFORM_TIMEOUT_MS / 1000}s (¿bucle infinito?)`);
    }
    throw new Error(`Error en la transformación JavaScript: ${e?.message || e}`);
  }
}

async function executeJsonTransformNode(node: any, context: Record<string, any>, edges: any[], nodes: any[]): Promise<any> {
  const data = node.data || {};
  const input = resolveTransformInput(node, context, edges, nodes);
  const mappings = getTransformMappings(data);
  const hasMappings = mappings.length > 0;
  const isMapMode = (data.transformType === 'pick' || data.transformType === 'map') && hasMappings;

  if (isMapMode) {
    const keepOthers = Boolean(data.keepOthers);
    const rows = extractRowSet(input);
    if (rows) return rows.map(row => mapRecord(row, mappings, keepOthers, context));
    return mapRecord(input, mappings, keepOthers, context);
  }

  const code = String(data.expression || '').trim() || 'return data;';
  const { result, _logs } = runTransformScript(code, input, context);
  // Attach _logs to the output so the frontend can display the console panel
  if (_logs.length > 0) {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return { ...result, _logs };
    }
    // For arrays or primitives, wrap in a container
    return { _data: result, _logs };
  }
  return result;
}

// ── Webhook trigger ──

function executeWebhookTriggerNode(node: any, context: Record<string, any>): any {
  if (context._webhookPayload) {
    return context._webhookPayload;
  }
  let body: any = {};
  const sample = String(node.data?.samplePayload || '').trim();
  if (sample) {
    try {
      body = JSON.parse(sample);
    } catch {
      throw new Error('Webhook: el payload de prueba no es un JSON válido');
    }
  }
  return {
    body,
    headers: {},
    query: {},
    timestamp: new Date().toISOString(),
    manual: true,
  };
}

// ── Shared helpers for outbound calls ──

function resolveSecret(context: Record<string, any>, raw: unknown): string {
  const value = String(resolveTemplate(context, String(raw ?? '')) ?? '').trim();
  const envMatch = value.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!envMatch) return value;
  const envValue = process.env[envMatch[1]];
  if (!envValue) throw new Error(`La variable de entorno ${envMatch[1]} no está definida en el servidor`);
  return envValue;
}

function maskSecret(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.startsWith('env:')) return s;
  return '••••••••';
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number, label: string) {
  try {
    return await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (e: any) {
    if (signal?.aborted) throw new Error('Ejecución detenida por el usuario');
    if (e?.name === 'TimeoutError') throw new Error(`${label}: sin respuesta tras ${Math.round(timeoutMs / 1000)}s`);
    throw new Error(`${label}: no se pudo conectar (${e?.cause?.code || e?.message || e})`);
  }
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return json.error_description || json.error?.message || json.message || (typeof json.error === 'string' ? json.error : text);
  } catch {
    return text.slice(0, 500);
  }
}

// ── OAuth2 connector ──

const oauthTokenCache = new Map<string, { token: any; expiresAt: number }>();

function buildOAuth2Request(node: any, context: Record<string, any>, revealSecrets: boolean) {
  const data = node.data || {};
  const grantType = data.grantType || 'client_credentials';
  const tokenUrl = String(resolveTemplate(context, data.tokenUrl || '') || '').trim();
  const clientId = String(resolveTemplate(context, data.clientId || '') || '').trim();
  const scope = String(resolveTemplate(context, data.scope || '') || '').trim();
  const authMethod = data.authMethod === 'basic' ? 'basic' : 'body';
  const secret = (raw: unknown) => (revealSecrets ? resolveSecret(context, raw) : maskSecret(raw));
  const clientSecret = secret(data.clientSecret);

  const params: Record<string, string> = { grant_type: grantType };
  if (authMethod === 'body') {
    if (clientId) params.client_id = clientId;
    if (clientSecret) params.client_secret = clientSecret;
  }
  if (scope) params.scope = scope;
  if (grantType === 'password') {
    params.username = String(resolveTemplate(context, data.username || '') || '');
    params.password = secret(data.password);
  }
  if (grantType === 'refresh_token') {
    params.refresh_token = secret(data.refreshToken);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (authMethod === 'basic') {
    headers.Authorization = revealSecrets
      ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      : 'Basic ••••••••';
  }

  return { grantType, tokenUrl, clientId, scope, params, headers };
}

async function executeOAuth2ConnectorNode(node: any, context: Record<string, any>, signal?: AbortSignal): Promise<any> {
  const req = buildOAuth2Request(node, context, true);
  if (!req.tokenUrl) throw new Error('OAuth2: debe indicar la URL del endpoint de token');
  if (req.grantType === 'refresh_token' && !req.params.refresh_token) throw new Error('OAuth2: falta el refresh token');
  if (req.grantType === 'password' && !req.params.username) throw new Error('OAuth2: falta el usuario');

  const useCache = node.data?.cacheToken !== false;
  const cacheKey = JSON.stringify([req.tokenUrl, req.clientId, req.grantType, req.scope, req.params.username || '']);
  const cached = useCache ? oauthTokenCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.token, from_cache: true };
  }

  const timeoutMs = getSystemSettingsFromDb().http_timeout_seconds * 1000;
  const res = await fetchWithTimeout(
    req.tokenUrl,
    { method: 'POST', headers: req.headers, body: new URLSearchParams(req.params).toString() },
    signal,
    timeoutMs,
    'OAuth2'
  );

  if (!res.ok) {
    throw new Error(`OAuth2: el servidor respondió ${res.status} - ${await readErrorBody(res)}`);
  }

  const tokenData = (await res.json().catch(() => null)) as any;
  const accessToken = tokenData?.access_token || tokenData?.token;
  if (!accessToken) throw new Error('OAuth2: la respuesta no contiene access_token');

  const tokenType = String(tokenData.token_type || 'Bearer');
  const expiresIn = Number(tokenData.expires_in) || 3600;
  const token = {
    ...tokenData,
    access_token: accessToken,
    token_type: tokenType,
    expires_in: expiresIn,
    authorization_header: `${tokenType.charAt(0).toUpperCase()}${tokenType.slice(1)} ${accessToken}`,
    acquired_at: new Date().toISOString(),
  };

  if (useCache) {
    oauthTokenCache.set(cacheKey, { token, expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000 });
  }
  return { ...token, from_cache: false };
}

// ── AI chat completion ──

function buildAiRequest(node: any, context: Record<string, any>) {
  const data = node.data || {};
  const endpoint = String(resolveTemplate(context, data.endpoint || 'https://api.openai.com/v1/chat/completions') || '').trim();
  const model = String(resolveTemplate(context, data.model || 'gpt-4o-mini') || '').trim();
  const systemPrompt = toText(resolveTemplate(context, data.systemPrompt || ''));
  const userPrompt = toText(resolveTemplate(context, data.userPrompt || ''));
  const temperature = Number(data.temperature ?? 0.7);
  const maxTokens = Number(data.maxTokens) || undefined;
  const responseFormat = data.responseFormat === 'json_object' ? 'json_object' : 'text';

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const body: Record<string, any> = { model, messages, temperature };
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormat === 'json_object') body.response_format = { type: 'json_object' };

  return { endpoint, model, userPrompt, responseFormat, body };
}

function parseJsonContent(content: string): any {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function executeAiChatCompletionNode(node: any, context: Record<string, any>, signal?: AbortSignal): Promise<any> {
  const req = buildAiRequest(node, context);
  if (!req.endpoint) throw new Error('IA: debe indicar la URL del endpoint');
  if (!req.model) throw new Error('IA: debe indicar el modelo');
  if (!req.userPrompt.trim()) throw new Error('IA: el prompt del usuario está vacío (revisa las variables usadas)');

  const apiKey = resolveSecret(context, node.data?.apiKey);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const timeoutMs = Math.max(5, Number(node.data?.timeoutSeconds) || 120) * 1000;
  const startedAt = Date.now();
  const res = await fetchWithTimeout(req.endpoint, { method: 'POST', headers, body: JSON.stringify(req.body) }, signal, timeoutMs, 'IA');

  if (!res.ok) {
    throw new Error(`IA: el proveedor respondió ${res.status} - ${await readErrorBody(res)}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  const choice = json?.choices?.[0];
  if (!choice) throw new Error('IA: la respuesta no tiene el formato OpenAI esperado (choices vacío)');
  const content: string = choice.message?.content ?? '';

  const parsed = req.responseFormat === 'json_object' || /^\s*(```|\{|\[)/.test(content) ? parseJsonContent(content) : null;
  if (req.responseFormat === 'json_object' && parsed === null) {
    throw new Error('IA: se solicitó JSON pero el modelo devolvió texto no válido');
  }

  return {
    content,
    parsed,
    model: json.model || req.model,
    finish_reason: choice.finish_reason,
    usage: json.usage,
    duration_ms: Date.now() - startedAt,
  };
}

// ── Debug previews (computed before the node runs, never with side effects) ──

function truncateForPreview(value: any): any {
  const text = JSON.stringify(value ?? null);
  if (text && text.length > 4000) return `${text.slice(0, 4000)}…`;
  return value ?? null;
}

function summarizeData(value: any) {
  const rows = extractRowSet(value);
  if (rows) {
    return { type: 'lista', count: rows.length, sample: truncateForPreview(rows.slice(0, 3)) };
  }
  const empty = value === null || value === undefined;
  return { type: empty ? 'vacío' : typeof value, count: empty ? 0 : 1, sample: truncateForPreview(value) };
}

function buildDebugPreview(
  node: any,
  context: Record<string, any>,
  edges: any[],
  nodes: any[],
  iteration?: { current: number; total: number }
): Record<string, any> {
  try {
    switch (node.type) {
      case 'conditionalBranch':
        return { nodePreview: { kind: 'condition', ...executeConditionalBranchNode(node, context) } };
      case 'jsonTransform':
        return { nodePreview: { kind: 'transform', input: summarizeData(resolveTransformInput(node, context, edges, nodes)) } };
      case 'aiChatCompletion': {
        const req = buildAiRequest(node, context);
        return {
          requestPreview: {
            method: 'POST',
            endpoint: req.endpoint,
            headers: {
              'Content-Type': 'application/json',
              ...(node.data?.apiKey ? { Authorization: `Bearer ${maskSecret(node.data.apiKey)}` } : {}),
            },
            body: req.body,
            iteration,
          },
        };
      }
      case 'oauth2Connector': {
        const req = buildOAuth2Request(node, context, false);
        return {
          requestPreview: { method: 'POST', endpoint: req.tokenUrl, headers: req.headers, body: req.params, iteration },
        };
      }
      default:
        return {};
    }
  } catch (e: any) {
    return { nodePreview: { kind: 'error', error: e?.message || String(e) } };
  }
}
