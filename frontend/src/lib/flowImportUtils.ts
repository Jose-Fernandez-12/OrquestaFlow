export interface FlowBundlePreview {
  name: string;
  description: string;
  definition: {
    nodes: any[];
    edges: any[];
  };
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  queries: Array<{
    id: string;
    name: string;
    sql_text: string;
    params?: any;
    connection_ids?: string[];
  }>;
  connections: Array<{
    id: string;
    name: string;
    host: string;
    database_name?: string;
  }>;
  requiresCredentials: boolean;
  rawPayload: any;
}

export interface ParseResult {
  success: boolean;
  error?: string;
  data?: FlowBundlePreview;
}

export function parseAndInspectFlowBundle(jsonString: string, fallbackName?: string): ParseResult {
  if (!jsonString || typeof jsonString !== 'string' || jsonString.trim() === '') {
    return { success: false, error: 'El archivo está vacío o no es válido.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, error: 'El archivo no tiene una sintaxis JSON válida.' };
  }

  // 1. Resolve Flow Name & Description
  let flowName = (parsed.name || parsed.flow?.name || fallbackName || 'Flujo importado').trim();
  let flowDescription = (parsed.description || parsed.flow?.description || '').trim();

  // 2. Resolve Definition (nodes & edges)
  let rawDefinition = parsed.definition || parsed.flow?.definition;
  let nodes: any[] = [];
  let edges: any[] = [];

  if (rawDefinition) {
    if (typeof rawDefinition === 'string') {
      try {
        const inner = JSON.parse(rawDefinition);
        nodes = Array.isArray(inner.nodes) ? inner.nodes : [];
        edges = Array.isArray(inner.edges) ? inner.edges : [];
      } catch {
        return { success: false, error: 'La propiedad definition del flujo no contiene un JSON válido.' };
      }
    } else if (typeof rawDefinition === 'object' && rawDefinition !== null) {
      nodes = Array.isArray(rawDefinition.nodes) ? rawDefinition.nodes : [];
      edges = Array.isArray(rawDefinition.edges) ? rawDefinition.edges : [];
    }
  } else if (Array.isArray(parsed.nodes)) {
    nodes = parsed.nodes;
    edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  }

  if (nodes.length === 0 && edges.length === 0 && !rawDefinition) {
    return {
      success: false,
      error: 'El archivo no contiene una estructura reconocida de flujo (faltan nodos o definición).'
    };
  }

  // 3. Resolve Queries & Connections
  const queries: Array<{ id: string; name: string; sql_text: string; params?: any; connection_ids?: string[] }> =
    Array.isArray(parsed.queries) ? parsed.queries : [];

  const connections: Array<{ id: string; name: string; host: string; database_name?: string }> =
    Array.isArray(parsed.connections) ? parsed.connections : [];

  // Extract unique node types
  const nodeTypes = Array.from(new Set(nodes.map(n => n.type || 'desconocido')));

  // Check if any query node is present or if connections exist
  const hasQueryNodes = nodes.some(n => n.type === 'query');
  const requiresCredentials = connections.length > 0 || hasQueryNodes;

  return {
    success: true,
    data: {
      name: flowName,
      description: flowDescription,
      definition: {
        nodes,
        edges
      },
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodeTypes,
      queries,
      connections,
      requiresCredentials,
      rawPayload: {
        name: flowName,
        description: flowDescription,
        definition: { nodes, edges },
        queries,
        connections
      }
    }
  };
}
