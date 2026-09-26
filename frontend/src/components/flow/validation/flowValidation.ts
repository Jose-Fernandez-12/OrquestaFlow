import type { Node, Edge } from '@xyflow/react';
import { getBranchOutputs, getConditionRules, isBranchHandle } from '../nodeDefinitions';

export type IssueLevel = 'error' | 'warning';

export interface FlowIssue {
  nodeId: string;
  level: IssueLevel;
  message: string;
  /** Already explained inside the node's own inspector: not repeated in the inspector banner */
  inline?: boolean;
}

const LOOP_VARIABLES = new Set(['_item', 'item', '_index', '_total', 'Variables', 'variables', 'context', 'data']);

function parseJson(raw: unknown): { ok: boolean; value?: any } {
  if (typeof raw !== 'string') return { ok: raw !== undefined, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out));
  return out;
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Generated node ids ("node_http_1", uuids) and labels with spaces are never plain field names */
function looksLikeNodeReference(name: string): boolean {
  return /^node_/i.test(name) || UUID_PREFIX.test(name) || /\s/.test(name);
}

/** Names a {{...}} template may start with: node ids, labels, variable keys and loop variables */
function knownReferenceNames(nodes: Node[]): Set<string> {
  const names = new Set<string>(LOOP_VARIABLES);
  for (const n of nodes) {
    names.add(n.id);
    const label = String(n.data?.label || '').trim();
    if (label) names.add(label);
    const alias = String(n.data?.itemAlias || '').trim();
    if (alias) names.add(alias);
    if (n.type === 'variables') {
      for (const v of (Array.isArray(n.data?.variables) ? n.data.variables : []) as any[]) {
        if (v?.key) names.add(String(v.key).trim());
      }
      const raw = parseJson(n.data?.rawJson);
      if (raw.ok && raw.value && typeof raw.value === 'object') Object.keys(raw.value).forEach(k => names.add(k));
    }
  }
  return names;
}

/**
 * Checks a flow before running it. Errors are configurations that will certainly fail or do nothing;
 * warnings are likely mistakes that still let the flow run.
 */
export function validateFlow(nodes: Node[], edges: Edge[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const add = (nodeId: string, level: IssueLevel, message: string, inline = false) =>
    issues.push(inline ? { nodeId, level, message, inline } : { nodeId, level, message });
  const incoming = (id: string) => edges.filter(e => e.target === id);
  const outgoing = (id: string) => edges.filter(e => e.source === id);
  const known = knownReferenceNames(nodes);

  for (const node of nodes) {
    if (node.type === 'note') continue; // documentation only
    const data = (node.data || {}) as Record<string, any>;
    const text = (v: unknown) => String(v ?? '').trim();

    switch (node.type) {
      case 'httpGet':
      case 'httpPost':
      case 'httpRequest': {
        const endpoint = text(data.endpoint);
        if (!endpoint) add(node.id, 'error', 'Falta la URL del endpoint.');
        else if (!/^https?:\/\//i.test(endpoint) && !endpoint.startsWith('{{')) {
          add(node.id, 'warning', 'La URL no empieza por http:// o https://; el motor la tratará como una respuesta simulada.');
        }
        for (const [field, label] of [['headers', 'Headers'], ['params', 'Parámetros de consulta']] as const) {
          if (text(data[field]) && !parseJson(data[field]).ok) add(node.id, 'warning', `${label}: el JSON no es válido y se ignorará.`);
        }
        break;
      }
      case 'query':
        if (!data.queryId) add(node.id, 'error', 'No hay una consulta SQL seleccionada.');
        break;
      case 'dataSource':
      case 'fileSource':
        if (data.mode !== 'merge' && !data.filePath) add(node.id, 'error', 'No hay un archivo Excel/CSV cargado.');
        if (data.mode === 'merge' && incoming(node.id).length < 2) add(node.id, 'warning', 'El modo unificador necesita al menos dos nodos conectados a su entrada.');
        break;
      case 'dataList': {
        const parsed = parseJson(data.items);
        if (!text(data.items)) add(node.id, 'warning', 'La lista está vacía.');
        else if (!parsed.ok) add(node.id, 'error', 'El JSON de la lista no es válido.');
        else if (!Array.isArray(parsed.value)) add(node.id, 'error', 'El contenido debe ser una lista: [ {...}, {...} ].');
        break;
      }
      case 'variables':
        if (text(data.rawJson) && !parseJson(data.rawJson).ok && !(Array.isArray(data.variables) && data.variables.length)) {
          add(node.id, 'error', 'El JSON de variables no es válido.');
        }
        break;
      case 'jsonTransform':
        if ((data.transformType === 'map' || data.transformType === 'pick') && Array.isArray(data.mappings) && data.mappings.length) break;
        if (!text(data.expression)) add(node.id, 'warning', 'No hay código JavaScript: los datos pasarán sin cambios.', true);
        break;
      case 'conditionalBranch': {
        if (data.mode === 'switch') {
          if (!text(data.switchField ?? data.switchValue)) add(node.id, 'error', 'Falta el "Valor a evaluar": siempre saldrá por "Por defecto".');
          if (!Array.isArray(data.cases) || data.cases.length === 0) add(node.id, 'warning', 'El switch no tiene casos.');
        } else if (getConditionRules(data).some(r => !text(r.left))) {
          add(node.id, 'error', 'Hay una condición sin campo a evaluar.');
        }
        const connected = new Set(outgoing(node.id).map(e => e.sourceHandle).filter(isBranchHandle));
        const unconnected = getBranchOutputs(data).filter(o => o.handle !== 'default' && !connected.has(o.handle));
        if (connected.size === 0) add(node.id, 'warning', 'Ninguna salida de la bifurcación está conectada.');
        else if (unconnected.length) add(node.id, 'warning', `Salidas sin conectar: ${unconnected.map(o => o.label).join(', ')}.`);
        break;
      }
      case 'forEach': {
        const reachesEnd = (() => {
          const seen = new Set<string>();
          const queue = outgoing(node.id).map(e => e.target);
          while (queue.length) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            if (nodes.find(n => n.id === id)?.type === 'forEachEnd') return true;
            queue.push(...outgoing(id).map(e => e.target));
          }
          return false;
        })();
        if (!reachesEnd) add(node.id, 'error', 'El bucle no llega a un nodo "Fin de bucle".');
        if (!text(data.iterateOver) && incoming(node.id).length === 0) add(node.id, 'error', 'El bucle no tiene una lista que recorrer.');
        break;
      }
      case 'scraping':
        if (!data.script) add(node.id, 'warning', 'No hay un script de extracción seleccionado: devolverá un resultado simulado.');
        break;
      case 'oauth2Connector':
        if (!text(data.tokenUrl)) add(node.id, 'error', 'Falta la URL del endpoint de token.');
        break;
      case 'aiChatCompletion':
        if (!text(data.userPrompt)) add(node.id, 'error', 'El prompt del usuario está vacío.');
        break;
      case 'export':
        if (data.exportMode === 'multi' && Object.keys(data.multiSheetConfig || {}).length === 0) {
          add(node.id, 'warning', 'Modo multi-pestaña sin pestañas configuradas.');
        }
        break;
    }

    // Nodes left out of the graph
    if (nodes.length > 1 && node.type !== 'start' && incoming(node.id).length === 0 && outgoing(node.id).length === 0) {
      add(node.id, 'warning', 'El nodo no está conectado a ningún otro.');
    }

    // Templates pointing at a node that no longer exists (e.g. it was deleted). A bare {{campo}} is
    // legitimate (the engine looks it up in the loop item and upstream rows), so only names that look
    // like node ids or labels are checked.
    const missing = new Set<string>();
    for (const value of collectStrings(data)) {
      for (const match of value.matchAll(/\{\{([^}]+)\}\}/g)) {
        const name = match[1].trim().split(/[.[]/)[0].trim();
        if (name && !known.has(name) && looksLikeNodeReference(name)) missing.add(name);
      }
    }
    for (const name of missing) {
      add(node.id, 'warning', `{{${name}…}} no corresponde a ningún nodo del flujo (¿se eliminó o se renombró?).`);
    }
  }

  return issues;
}

export function groupIssues(issues: FlowIssue[]): Map<string, FlowIssue[]> {
  const byNode = new Map<string, FlowIssue[]>();
  for (const issue of issues) {
    const list = byNode.get(issue.nodeId) || [];
    list.push(issue);
    byNode.set(issue.nodeId, list);
  }
  return byNode;
}
