import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useAppSelector } from '../../../store/hooks';
import { getUpstreamNodes, isDataProducerNode, getForEachItems, findParentForEachNode } from './utils';
import type { VariableGroup, VariableItem } from './types';

const MAX_VARIABLES_PER_NODE = 60;
const MAX_DEPTH = 3;

function valueType(value: unknown): string {
  if (value === null || value === undefined) return 'vacío';
  if (Array.isArray(value)) return 'lista';
  if (typeof value === 'number') return 'número';
  if (typeof value === 'boolean') return 'booleano';
  if (typeof value === 'object') return 'objeto';
  return 'texto';
}

// Row sets expose their first row's fields: the engine resolves {{nodo.campo}} against row 1
function sampleOf(result: any): { sample: any; isRowSet: boolean; count?: number; prefix: string } {
  if (Array.isArray(result)) return { sample: result[0], isRowSet: true, count: result.length, prefix: '' };
  if (result && typeof result === 'object') {
    for (const key of ['rows', 'data', 'items']) {
      if (Array.isArray(result[key])) {
        return { sample: result[key][0], isRowSet: true, count: result[key].length, prefix: key };
      }
    }
  }
  return { sample: result, isRowSet: false, prefix: '' };
}

function collectPaths(value: any, prefix: string, depth: number, out: Array<{ path: string; value: any }>) {
  if (out.length >= MAX_VARIABLES_PER_NODE || value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (out.length >= MAX_VARIABLES_PER_NODE) return;
    const path = prefix ? `${prefix}.${key}` : key;
    out.push({ path, value: child });
    if (Array.isArray(child)) {
      out.push({ path: `${path}.length`, value: child.length });
    } else if (depth < MAX_DEPTH) {
      collectPaths(child, path, depth + 1, out);
    }
  }
}

function inferResultFromConfig(node: Node): any {
  const data = node.data || {};
  if (node.type === 'dataList' && data.items) {
    try {
      const parsed = typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if ((node.type === 'dataSource' || node.type === 'fileSource') && Array.isArray(data.sampleRows)) {
    return data.sampleRows;
  }
  if (node.type === 'webhookTrigger') {
    let body: any = {};
    try {
      body = data.samplePayload ? JSON.parse(String(data.samplePayload)) : {};
    } catch {}
    return { body, headers: {}, query: {}, timestamp: '' };
  }
  if (node.type === 'oauth2Connector') {
    return { access_token: '', token_type: 'Bearer', expires_in: 0, authorization_header: '' };
  }
  if (node.type === 'aiChatCompletion') {
    return { content: '', parsed: data.responseFormat === 'json_object' ? {} : null, model: '', usage: {} };
  }
  return undefined;
}

export function useAvailableVariables(node: Node, nodes: Node[], edges: Edge[]): VariableGroup[] {
  const nodeResults = useAppSelector(state => state.flows.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);

  const parentForEachNode = useMemo(() => findParentForEachNode(node, edges, nodes), [node, edges, nodes]);

  const parentLoopItems = useMemo(() => {
    if (!parentForEachNode) return [];
    return getForEachItems(parentForEachNode, nodes, edges, nodeResults, intermediateContext);
  }, [parentForEachNode, nodes, edges, nodeResults, intermediateContext]);

  const upstreamNodes = useMemo(() => getUpstreamNodes(node, edges, nodes), [node, edges, nodes]);

  return useMemo(() => {
    const groups: VariableGroup[] = [];

    if (parentForEachNode) {
      const loopVars: VariableItem[] = [];
      const first = parentLoopItems[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const paths: Array<{ path: string; value: any }> = [];
        collectPaths(first, '', 1, paths);
        paths.forEach(p => loopVars.push({ label: p.path, expression: `{{_item.${p.path}}}`, type: valueType(p.value) }));
      }
      loopVars.push({ label: 'Elemento completo', expression: '{{_item}}', type: 'objeto' });
      loopVars.push({ label: 'Índice actual (0…n)', expression: '{{_index}}', type: 'número' });
      loopVars.push({ label: 'Total de elementos', expression: '{{_total}}', type: 'número' });
      groups.push({
        id: 'loop',
        label: `Bucle: ${String(parentForEachNode.data?.label || parentForEachNode.id)}`,
        color: 'text-sky-600',
        variables: loopVars,
      });
    }

    upstreamNodes.forEach((upNode, idx) => {
      const live = nodeResults[upNode.id] ?? intermediateContext?.[upNode.id];
      const usable = live !== undefined && !(live && typeof live === 'object' && (live as any).skipped === true);
      const result = usable ? live : inferResultFromConfig(upNode);
      const vars: VariableItem[] = [];

      if (result !== undefined) {
        const { sample, isRowSet, count, prefix } = sampleOf(result);
        const base = prefix ? `${upNode.id}.${prefix}` : upNode.id;
        if (isRowSet) {
          vars.push({ label: 'Cantidad de registros', expression: `{{${base}.length}}`, type: 'número' });
        }
        const paths: Array<{ path: string; value: any }> = [];
        collectPaths(sample, prefix, 1, paths);
        paths.forEach(p =>
          vars.push({
            label: isRowSet ? `${p.path} (fila 1${count ? ` de ${count}` : ''})` : p.path,
            expression: `{{${upNode.id}.${p.path}}}`,
            type: valueType(p.value),
          })
        );
      }

      vars.push({ label: 'Resultado completo', expression: `{{${upNode.id}}}`, type: 'referencia' });

      groups.push({
        id: `upstream-${idx}`,
        label: String(upNode.data?.label || upNode.type || upNode.id) + (usable ? '' : result !== undefined ? ' · esquema' : ' · sin ejecutar'),
        color: isDataProducerNode(upNode.type) ? 'text-accent' : 'text-muted',
        variables: vars,
      });
    });

    return groups;
  }, [parentForEachNode, parentLoopItems, upstreamNodes, nodeResults, intermediateContext]);
}
