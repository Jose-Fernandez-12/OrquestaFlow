// Debug previews that show how a node's request is built from its configuration and the flow context:
// which {{references}} it uses and what each one resolved to, and for SQL queries the final statement.

export interface ResolvedReference {
  expression: string;
  value: any;
  missing: boolean;
  masked?: boolean;
}

export interface QueryParamPreview {
  name: string;
  template: string | null;
  value: any;
  missing: boolean;
}

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;
// Same detection the SQL engines use for #param_name
const SQL_PARAM = /(?:^|[\s(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

// Field names whose resolved value must never be shown
const SECRET_FIELD = /token|password|secret|apikey|api_key|authorization/i;

function truncate(value: any): any {
  const text = JSON.stringify(value ?? null);
  return text && text.length > 2000 ? `${text.slice(0, 2000)}…` : value;
}

function collectStrings(value: unknown, key: string, out: Array<{ text: string; key: string }>) {
  if (typeof value === 'string') out.push({ text: value, key });
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) collectStrings(v, k, out);
  }
}

/**
 * Every {{reference}} found in the given configuration fields, with the value it resolves to.
 * References in secret fields (tokens, passwords) are reported but their value is masked.
 */
export function resolveReferences(
  data: Record<string, any> | undefined,
  fields: string[],
  resolve: (expression: string) => any
): ResolvedReference[] {
  const strings: Array<{ text: string; key: string }> = [];
  for (const field of fields) collectStrings(data?.[field], field, strings);

  const seen = new Map<string, ResolvedReference>();
  for (const { text, key } of strings) {
    for (const match of text.matchAll(TEMPLATE)) {
      const expression = match[1].trim();
      if (seen.has(expression)) continue;
      const value = resolve(`{{${expression}}}`);
      const missing = value === undefined || value === null || value === '';
      const masked = SECRET_FIELD.test(key) && !missing;
      seen.set(expression, { expression, value: masked ? '••••••••' : truncate(value), missing, ...(masked ? { masked } : {}) });
    }
  }
  return [...seen.values()];
}

/** Names of the #param_ parameters a SQL statement uses, in order of appearance. */
export function sqlParamNames(sql: string): string[] {
  return [...new Set([...sql.matchAll(SQL_PARAM)].map(m => m[1]))];
}

function toList(value: any): any[] | null {
  if (Array.isArray(value)) return value;
  // The engines also accept "'a','b'" text as a list
  if (typeof value === 'string' && value.includes(',') && (value.includes("'") || value.includes('"'))) {
    return value.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  return null;
}

function sqlLiteral(value: any): string {
  if (value === null || value === undefined) return "''";
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * The statement with each #param_ replaced by the value that will be bound, written as a SQL literal.
 * For reading only: the engines bind parameters, they never run this text. Mirrors their rules:
 * a missing value is sent as '', a list becomes a comma-separated list, and '%#param_x%' becomes a LIKE pattern.
 */
export function buildSqlPreview(sql: string, params: Record<string, any>): string {
  let text = sql.replace(/'(%?)#param_([a-zA-Z0-9_]+)(%?)'/g, (_m, leading, name, trailing) => {
    const value = params[name];
    const raw = value === null || value === undefined ? '' : String(value);
    return `'${leading}${raw.replace(/'/g, "''")}${trailing}'`;
  });
  text = text.replace(/(^|[\s(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (_m, prefix, name) => {
    const value = params[name];
    const list = toList(value);
    return prefix + (list ? list.map(sqlLiteral).join(', ') : sqlLiteral(value));
  });
  return text;
}

/**
 * Parameters of a query node: each #param_ of the statement with the template configured for it in the
 * node and the value it resolved to. A parameter with no value runs as '' (the engines' fallback).
 */
export function describeQueryParams(
  sql: string,
  templates: Record<string, any>,
  resolved: Record<string, any>
): QueryParamPreview[] {
  return sqlParamNames(sql).map(name => {
    const value = resolved[name];
    const template = templates[name];
    return {
      name,
      template: template === undefined ? null : typeof template === 'string' ? template : JSON.stringify(template),
      value: truncate(value),
      missing: value === undefined || value === null || value === '',
    };
  });
}
