import { parse } from 'acorn';

// Debug instrumentation for the JavaScript of transform nodes.
//
// The script runs synchronously inside `vm`, so it cannot really stop half way. Instead, when a
// debug session asks for it, every breakpoint line and every statement-level console call gets a
// call that snapshots the variables in scope at that moment. The UI then walks those stops in
// order, which behaves like stepping through the script (it has no side effects to replay).
//
// All inserted code stays on the line it belongs to, so line numbers in stack traces and in the
// recorded stops still match the editor.

export interface BreakpointResolution {
  requested: number;
  resolved: number | null;
}

export interface InstrumentResult {
  code: string;
  breakpoints: BreakpointResolution[];
}

type AnyNode = Record<string, any>;

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// Single-statement bodies that need braces around the inserted call. Labeled statements are left
// out: wrapping the loop behind a label would break `continue label`.
const LOOP_BODY_KEYS: Record<string, string[]> = {
  IfStatement: ['consequent', 'alternate'],
  ForStatement: ['body'],
  ForInStatement: ['body'],
  ForOfStatement: ['body'],
  WhileStatement: ['body'],
  DoWhileStatement: ['body'],
  WithStatement: ['body'],
};
// Names that are always visible to the script (parameters of the wrapper function)
const ROOT_NAMES = ['data', 'item', 'index'];

function isNode(v: any): v is AnyNode {
  return v && typeof v === 'object' && typeof v.type === 'string';
}

function patternNames(p: AnyNode | null | undefined, out: Set<string>) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'ArrayPattern': p.elements.forEach((e: AnyNode) => patternNames(e, out)); break;
    case 'ObjectPattern':
      p.properties.forEach((prop: AnyNode) => patternNames(prop.type === 'RestElement' ? prop : prop.value, out));
      break;
  }
}

// Every name declared inside a function body (or the top level), without entering nested functions.
// Block scoping is ignored on purpose: a name that is not reachable at runtime is skipped by the
// try/catch around each read in the snapshot.
function declaredNames(fn: AnyNode): Set<string> {
  const out = new Set<string>();
  if (fn.params) fn.params.forEach((p: AnyNode) => patternNames(p, out));
  const visit = (n: AnyNode) => {
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d: AnyNode) => patternNames(d.id, out));
    else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) out.add(n.id.name);
    else if (n.type === 'CatchClause' && n.param) patternNames(n.param, out);
    if (FUNCTION_TYPES.has(n.type) && n !== fn) return;
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(c => isNode(c) && visit(c));
      else if (isNode(v)) visit(v);
    }
  };
  visit(fn.type === 'Program' ? fn : fn.body);
  return out;
}

function isConsoleCall(stmt: AnyNode): boolean {
  const e = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
  return Boolean(
    e && e.type === 'CallExpression' && e.callee.type === 'MemberExpression' &&
    e.callee.object.type === 'Identifier' && e.callee.object.name === 'console'
  );
}

function snapshotFn(names: string[]): string {
  const reads = names
    .filter(n => !n.startsWith('__'))
    .map(n => `try{__s[${JSON.stringify(n)}]=${n}}catch(__e){}`)
    .join('');
  return `function(){var __s={};${reads}return __s;}`;
}

/**
 * Inserts `__bp(line, snapshot)` before the statements on the requested lines and
 * `__vars(line, snapshot)` before statement-level console calls. A breakpoint on a line where
 * no statement starts moves to the next one, like editor debuggers do.
 * Returns the code untouched when it does not parse (the runtime then reports the syntax error).
 */
export function instrumentTransformCode(body: string, breakpointLines: number[]): InstrumentResult {
  const requested = Array.from(new Set(breakpointLines.filter(l => Number.isInteger(l) && l > 0))).sort((a, b) => a - b);
  let ast: AnyNode;
  try {
    ast = parse(body, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, locations: true }) as AnyNode;
  } catch {
    return { code: body, breakpoints: requested.map(r => ({ requested: r, resolved: null })) };
  }

  // Statement positions where a stop can be inserted, with the names visible there
  const sites: Array<{ stmt: AnyNode; scope: string[]; wrap: boolean }> = [];
  const walk = (n: AnyNode, scopes: string[][]) => {
    let inner = scopes;
    if (n.type === 'Program' || FUNCTION_TYPES.has(n.type)) {
      inner = [...scopes, Array.from(declaredNames(n))];
    }
    const visible = () => Array.from(new Set(inner.flat()));
    const lists = n.type === 'SwitchCase' ? n.consequent : (n.type === 'Program' || n.type === 'BlockStatement' || n.type === 'StaticBlock') ? n.body : null;
    if (lists) lists.forEach((s: AnyNode) => sites.push({ stmt: s, scope: visible(), wrap: false }));
    for (const key of LOOP_BODY_KEYS[n.type] || []) {
      const s = n[key];
      if (isNode(s) && s.type !== 'BlockStatement') sites.push({ stmt: s, scope: visible(), wrap: true });
    }
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(c => isNode(c) && walk(c, inner));
      else if (isNode(v)) walk(v, inner);
    }
  };
  walk(ast, [ROOT_NAMES]);

  // First statement starting on each line (outermost wins, it runs first)
  const byLine = new Map<number, (typeof sites)[number]>();
  for (const site of sites.sort((a, b) => a.stmt.start - b.stmt.start)) {
    const line = site.stmt.loc.start.line;
    if (!byLine.has(line)) byLine.set(line, site);
  }
  const lines = Array.from(byLine.keys()).sort((a, b) => a - b);

  const inserts: Array<{ pos: number; text: string }> = [];
  const claimed = new Set<number>();
  const breakpoints = requested.map(req => {
    const resolved = lines.find(l => l >= req) ?? null;
    if (resolved !== null && !claimed.has(resolved)) {
      claimed.add(resolved);
      const site = byLine.get(resolved)!;
      const call = `__bp(${resolved},${snapshotFn(site.scope)});`;
      if (site.wrap) {
        inserts.push({ pos: site.stmt.start, text: `{${call}` }, { pos: site.stmt.end, text: '}' });
      } else {
        inserts.push({ pos: site.stmt.start, text: call });
      }
    }
    return { requested: req, resolved };
  });

  for (const site of sites) {
    if (!isConsoleCall(site.stmt)) continue;
    const call = `__vars(${site.stmt.loc.start.line},${snapshotFn(site.scope)});`;
    if (site.wrap) inserts.push({ pos: site.stmt.start, text: `{${call}` }, { pos: site.stmt.end, text: '}' });
    else inserts.push({ pos: site.stmt.start, text: call });
  }

  // Apply from the end so earlier offsets stay valid; at the same offset keep insertion order
  let code = body;
  inserts
    .map((ins, i) => ({ ...ins, i }))
    .sort((a, b) => b.pos - a.pos || b.i - a.i)
    .forEach(ins => { code = code.slice(0, ins.pos) + ins.text + code.slice(ins.pos); });
  return { code, breakpoints };
}
