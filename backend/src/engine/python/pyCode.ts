// Small helpers to emit readable Python source.

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
]);

// Builtins and names imported from orquesta_runtime that a step function must never shadow
const RESERVED = new Set([
  ...PY_KEYWORDS,
  'all', 'any', 'bool', 'dict', 'filter', 'float', 'format', 'id', 'input', 'int', 'iter', 'len', 'list', 'map',
  'max', 'min', 'next', 'object', 'open', 'print', 'range', 'set', 'sorted', 'str', 'sum', 'type', 'zip',
  'main', 'ctx', 'data', 'log', 'node', 'run', 'loop', 'resolve', 'ask', 'secret', 'pause', 'switch', 'condition',
  'start_flow', 'finish_flow', 'run_main', 'http_request', 'run_sql', 'export_file', 'export_sheets', 'read_table',
  'merge_sources', 'run_js', 'map_fields', 'webhook_payload', 'oauth2_token', 'ai_chat', 'set_variables',
  'file_input', 'loop_results', 'as_list', 'unwrap', 'today', 'month_start', 'now_ms', 'now_iso', 'ask_into', 'run_script',
]);

export function slugify(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function envKey(text: string): string {
  return slugify(text).toUpperCase() || 'NODO';
}

/** Unique snake_case function name derived from a node label */
export function pyIdentifier(label: string, used: Set<string>): string {
  let base = slugify(label) || 'paso';
  if (/^\d/.test(base)) base = `paso_${base}`;
  if (base.length > 40) base = base.slice(0, 40).replace(/_+$/, '');
  if (RESERVED.has(base)) base = `${base}_paso`;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
  used.add(name);
  return name;
}

/** Python string literal (JSON string syntax is valid Python) */
export function pyStr(text: string): string {
  return JSON.stringify(String(text ?? ''));
}

/** Text safe to place after a '#' comment marker */
export function pyComment(text: string): string {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').trim();
}

const INLINE_LIMIT = 72;

/** Python literal for JSON-like data, pretty-printed across lines when it is long */
export function pyLiteral(value: unknown, indent = 0): string {
  const inline = inlineLiteral(value);
  if (inline.length <= INLINE_LIMIT || (typeof value !== 'object' || value === null)) return inline;

  const pad = ' '.repeat(indent + 4);
  const close = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map(v => `${pad}${pyLiteral(v, indent + 4)},`).join('\n')}\n${close}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${pyStr(k)}: ${pyLiteral(v, indent + 4)},`).join('\n')}\n${close}}`;
}

function inlineLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return pyStr(value);
  if (Array.isArray(value)) return `[${value.map(inlineLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${pyStr(k)}: ${inlineLiteral(v)}`).join(', ')}}`;
  }
  return pyStr(String(value));
}

export type PyArg = string | [name: string, expr: string];

/**
 * Formats a call: on one line when it fits, otherwise one argument per line.
 * `indent` is the indentation of the statement; `prefix` is the text before the call on that
 * line (e.g. "return "), used only to decide whether the call fits on one line.
 */
export function pyCall(fn: string, args: PyArg[], indent = 0, prefix = ''): string {
  const parts = args.map(a => (typeof a === 'string' ? a : `${a[0]}=${a[1]}`));
  const oneLine = `${fn}(${parts.join(', ')})`;
  if (indent + prefix.length + oneLine.length <= 100 && !parts.some(p => p.includes('\n'))) return oneLine;
  const pad = ' '.repeat(indent + 4);
  return `${fn}(\n${parts.map(p => `${pad}${p},`).join('\n')}\n${' '.repeat(indent)})`;
}
