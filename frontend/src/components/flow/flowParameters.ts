import type { FlowVariable } from './inspector/inspectors/variablesSync';

export interface FlowParameter {
  key: string;
  type: FlowVariable['type'];
  defaultValue: any;
  description: string;
  promptOnRun: boolean;
  nodeId: string;
  nodeLabel: string;
}

function extractNodes(definitionOrNodes: unknown): any[] {
  if (Array.isArray(definitionOrNodes)) {
    return definitionOrNodes;
  }
  if (typeof definitionOrNodes === 'string' && definitionOrNodes.trim()) {
    try {
      const parsed = JSON.parse(definitionOrNodes);
      return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    } catch {
      return [];
    }
  }
  if (definitionOrNodes && typeof definitionOrNodes === 'object') {
    const maybeNodes = (definitionOrNodes as { nodes?: unknown }).nodes;
    return Array.isArray(maybeNodes) ? maybeNodes : [];
  }
  return [];
}

/**
 * Collects all variables declared across `variables` nodes in a flow.
 * If multiple nodes define the same key, the first definition wins.
 */
export function getFlowParameters(definitionOrNodes: unknown): FlowParameter[] {
  const nodes = extractNodes(definitionOrNodes);
  const seen = new Set<string>();
  const params: FlowParameter[] = [];

  for (const node of nodes) {
    if (!node || node.type !== 'variables') continue;
    const nodeLabel = String(node.data?.label || 'Variables');
    const vars = Array.isArray(node.data?.variables) ? node.data.variables : [];

    if (vars.length > 0) {
      for (const v of vars) {
        const key = typeof v?.key === 'string' ? v.key.trim() : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        params.push({
          key,
          type: v.type || 'string',
          defaultValue: v.value ?? '',
          description: String(v.description || ''),
          promptOnRun: Boolean(v.promptOnRun),
          nodeId: String(node.id || ''),
          nodeLabel,
        });
      }
    } else if (typeof node.data?.rawJson === 'string' && node.data.rawJson.trim()) {
      try {
        const parsed = JSON.parse(node.data.rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [rawKey, val] of Object.entries(parsed)) {
            const key = rawKey.trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const type: FlowVariable['type'] =
              typeof val === 'number'
                ? 'number'
                : typeof val === 'boolean'
                ? 'boolean'
                : typeof val === 'object' && val !== null
                ? 'json'
                : 'string';
            params.push({
              key,
              type,
              defaultValue: typeof val === 'object' && val !== null ? JSON.stringify(val) : val,
              description: '',
              promptOnRun: false,
              nodeId: String(node.id || ''),
              nodeLabel,
            });
          }
        }
      } catch {
        // ignore invalid rawJson
      }
    }
  }

  return params;
}

export function getPromptParameters(definitionOrNodes: unknown): FlowParameter[] {
  return getFlowParameters(definitionOrNodes).filter(p => p.promptOnRun);
}

export function hasFlowParameters(definitionOrNodes: unknown): boolean {
  return getFlowParameters(definitionOrNodes).length > 0;
}

export function hasPromptParameters(definitionOrNodes: unknown): boolean {
  return getPromptParameters(definitionOrNodes).length > 0;
}

