import type { Node, Edge } from '@xyflow/react';

/* ── Shared props for all inspector sub-components ── */

export interface InspectorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (key: string, value: any) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  selectedNodeId: string;
}

/* ── Tab definition ── */

export interface TabDefinition {
  id: string;
  label: string;
  icon?: React.ElementType;
  /** Badge count shown on the tab (e.g. number of headers) */
  badge?: number;
  /** Validation status: 'ok' | 'warning' | 'error' | undefined */
  status?: 'ok' | 'warning' | 'error';
}

/* ── Variable definition for the VariableDrawer ── */

export interface VariableGroup {
  id: string;
  label: string;
  icon?: React.ElementType;
  color?: string;
  variables: VariableItem[];
}

export interface VariableItem {
  /** Display label, e.g. "nombre" */
  label: string;
  /** Full expression, e.g. "{{_item.nombre}}" */
  expression: string;
  /** Optional type hint, e.g. "string", "number" */
  type?: string;
}

/* ── Type‑level maps (mirrors BaseNode) ── */

export const TYPE_LABELS: Record<string, string> = {
  start: 'Inicio',
  httpGet: 'HTTP Request',
  httpPost: 'HTTP Request',
  httpRequest: 'HTTP Request',
  scraping: 'Web Scraping',
  export: 'Exportar archivo',
  query: 'Consulta DB',
  timer: 'Pausa programada',
  delay: 'Pausa programada',
  dataSource: 'Obtener datos (Excel/CSV)',
  fileSource: 'Obtener datos (Excel/CSV)',
  dataList: 'Lista de datos',
  variables: 'Variables',
  forEach: 'Inicio de bucle',
  forEachEnd: 'Fin de bucle',
  conditionalBranch: 'Bifurcación condicional',
  jsonTransform: 'Transformación JSON',
  webhookTrigger: 'Disparador Webhook',
  oauth2Connector: 'Conector OAuth2',
  aiChatCompletion: 'IA / Chat LLM',
  note: 'Nota',
};

export const TYPE_COLORS: Record<string, string> = {
  start: 'text-green-600',
  httpGet: 'text-blue-600',
  httpPost: 'text-indigo-600',
  httpRequest: 'text-blue-600',
  scraping: 'text-purple-600',
  export: 'text-orange-600',
  query: 'text-cyan-600',
  timer: 'text-amber-600',
  delay: 'text-amber-600',
  dataSource: 'text-emerald-600',
  fileSource: 'text-emerald-600',
  dataList: 'text-violet-600',
  variables: 'text-violet-600',
  forEach: 'text-sky-600',
  forEachEnd: 'text-sky-600',
  conditionalBranch: 'text-amber-500',
  jsonTransform: 'text-teal-600',
  webhookTrigger: 'text-pink-600',
  oauth2Connector: 'text-indigo-600',
  aiChatCompletion: 'text-fuchsia-600',
  note: 'text-amber-600',
};

export const TYPE_BG_COLORS: Record<string, string> = {
  start: 'bg-green-500/10',
  httpGet: 'bg-blue-500/10',
  httpPost: 'bg-indigo-500/10',
  httpRequest: 'bg-blue-500/10',
  scraping: 'bg-purple-500/10',
  export: 'bg-orange-500/10',
  query: 'bg-cyan-500/10',
  timer: 'bg-amber-500/10',
  delay: 'bg-amber-500/10',
  dataSource: 'bg-emerald-500/10',
  fileSource: 'bg-emerald-500/10',
  dataList: 'bg-violet-500/10',
  variables: 'bg-violet-500/10',
  forEach: 'bg-sky-500/10',
  forEachEnd: 'bg-sky-500/10',
  conditionalBranch: 'bg-amber-500/10',
  jsonTransform: 'bg-teal-500/10',
  webhookTrigger: 'bg-pink-500/10',
  oauth2Connector: 'bg-indigo-500/10',
  aiChatCompletion: 'bg-fuchsia-500/10',
  note: 'bg-amber-500/10',
};
