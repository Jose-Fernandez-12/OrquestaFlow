export const EXPERIMENTAL_NODE_TYPES = ['webhookTrigger', 'oauth2Connector', 'aiChatCompletion'];

export const isExperimentalNode = (type?: string) => !!type && EXPERIMENTAL_NODE_TYPES.includes(type);

export const isBranchHandle = (handle?: string | null) =>
  !!handle && (handle === 'true' || handle === 'false' || handle === 'default' || handle.startsWith('case_'));

export interface ConditionRule {
  id: string;
  left: string;
  operator: string;
  right: string;
}

export interface SwitchCase {
  id: string;
  value: string;
  label?: string;
}

export const CONDITION_OPERATORS: Array<{ value: string; label: string; symbol: string; unary?: boolean }> = [
  { value: 'equals', label: 'Es igual a', symbol: '=' },
  { value: 'not_equals', label: 'No es igual a', symbol: '≠' },
  { value: 'gt', label: 'Mayor que', symbol: '>' },
  { value: 'gte', label: 'Mayor o igual que', symbol: '≥' },
  { value: 'lt', label: 'Menor que', symbol: '<' },
  { value: 'lte', label: 'Menor o igual que', symbol: '≤' },
  { value: 'contains', label: 'Contiene', symbol: '∋' },
  { value: 'not_contains', label: 'No contiene', symbol: '∌' },
  { value: 'starts_with', label: 'Empieza con', symbol: 'a…' },
  { value: 'ends_with', label: 'Termina con', symbol: '…z' },
  { value: 'in_list', label: 'Está en la lista', symbol: '∈' },
  { value: 'regex', label: 'Coincide con regex', symbol: '~' },
  { value: 'is_empty', label: 'Está vacío', symbol: '∅', unary: true },
  { value: 'is_not_empty', label: 'Tiene valor', symbol: '≠∅', unary: true },
  { value: 'is_true', label: 'Es verdadero', symbol: '✓', unary: true },
  { value: 'is_false', label: 'Es falso', symbol: '✗', unary: true },
];

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

export const getOperator = (value?: string) => {
  const normalized = OPERATOR_ALIASES[value || ''] || value || 'equals';
  return CONDITION_OPERATORS.find(o => o.value === normalized) || CONDITION_OPERATORS[0];
};

export function getConditionRules(data: Record<string, any> | undefined): ConditionRule[] {
  if (Array.isArray(data?.conditions) && data.conditions.length > 0) {
    return data.conditions.map((c: any, idx: number) => ({
      id: String(c?.id ?? idx + 1),
      left: String(c?.left ?? ''),
      operator: getOperator(c?.operator).value,
      right: String(c?.right ?? ''),
    }));
  }
  return [{
    id: '1',
    left: String(data?.leftOperand ?? ''),
    operator: getOperator(data?.operator).value,
    right: String(data?.rightOperand ?? ''),
  }];
}

// Legacy string cases get positional ids, matching the backend normalization
export function normalizeSwitchCases(cases: unknown): SwitchCase[] {
  if (!Array.isArray(cases)) return [];
  return cases.map((c: any, idx: number) =>
    typeof c === 'string'
      ? { id: String(idx + 1), value: c }
      : { id: String(c?.id ?? idx + 1), value: String(c?.value ?? ''), label: c?.label || undefined }
  );
}

export function getBranchOutputs(data: Record<string, any> | undefined): Array<{ handle: string; label: string; tone: 'true' | 'false' | 'case' | 'default' }> {
  if (data?.mode === 'switch') {
    return [
      ...normalizeSwitchCases(data.cases).map(c => ({
        handle: `case_${c.id}`,
        label: c.label || c.value || `Caso ${c.id}`,
        tone: 'case' as const,
      })),
      { handle: 'default', label: 'Por defecto', tone: 'default' as const },
    ];
  }
  return [
    { handle: 'true', label: 'Sí', tone: 'true' as const },
    { handle: 'false', label: 'No', tone: 'false' as const },
  ];
}

// Shortens "{{nodo_abc.campo}}" to "campo" for compact rule previews on the canvas
export function shortExpression(value: string): string {
  const trimmed = (value || '').trim();
  const match = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (!match) return trimmed;
  const parts = match[1].split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : parts[0];
}

export function describeRule(rule: ConditionRule): string {
  const op = getOperator(rule.operator);
  const left = shortExpression(rule.left) || '?';
  if (op.unary) return `${left} ${op.label.toLowerCase()}`;
  return `${left} ${op.symbol} ${shortExpression(rule.right) || '""'}`;
}

// ── Retries and error policy (mirrors backend/src/engine/retry.ts) ──

export const HTTP_NODE_TYPES = ['httpGet', 'httpPost', 'httpRequest'];

/** Nodes that talk to the outside world and can fail transiently */
export const RETRYABLE_NODE_TYPES = [...HTTP_NODE_TYPES, 'scraping', 'query', 'oauth2Connector', 'aiChatCompletion'];

/** Control-flow nodes: continuing past a failure would leave the graph in an undefined state */
export const NO_CONTINUE_NODE_TYPES = ['start', 'forEach', 'forEachEnd', 'conditionalBranch'];

export const supportsRetries = (type?: string) => !!type && RETRYABLE_NODE_TYPES.includes(type);
export const supportsContinueOnError = (type?: string) => !!type && !NO_CONTINUE_NODE_TYPES.includes(type);

export interface NodeRetryConfig {
  retryCount: number | null;   // null = use the global default (HTTP) or 0
  retryDelayMs: number;
  retryBackoff: 'fixed' | 'exponential';
  onError: 'stop' | 'continue';
}

export function getNodeRetryConfig(data: Record<string, any> | undefined): NodeRetryConfig {
  const count = data?.retryCount;
  const parsed = count === undefined || count === null || count === '' ? null : Number(count);
  const delay = Number(data?.retryDelayMs);
  return {
    retryCount: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    retryDelayMs: Number.isFinite(delay) && data?.retryDelayMs !== '' && data?.retryDelayMs !== undefined ? delay : 1000,
    retryBackoff: data?.retryBackoff === 'fixed' ? 'fixed' : 'exponential',
    onError: data?.onError === 'continue' ? 'continue' : 'stop',
  };
}

/** Human description of the wait before each retry, e.g. "1s, 2s, 4s" */
export function describeRetryDelays(config: NodeRetryConfig, retries: number): string {
  const n = Math.min(Math.max(retries, 0), 4);
  const delays = Array.from({ length: n }, (_, i) =>
    Math.min(60000, config.retryBackoff === 'exponential' ? config.retryDelayMs * 2 ** i : config.retryDelayMs)
  );
  const fmt = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  return delays.map(fmt).join(', ') + (retries > 4 ? '…' : '');
}
