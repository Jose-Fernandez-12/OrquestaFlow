/**
 * "Ejecutar script" node: pure helpers shared by the engine and its tests.
 *
 * The node runs a script from the Scripts section with:
 * - arguments typed like a command line, where each argument may hold {{templates}}
 *   (split first, resolved after: a value with spaces stays a single argument);
 * - optionally, the data of a previous node, written to a temporary file or to stdin;
 * - a temporary output file (ORQUESTA_OUTPUT_FILE) where the script may write its JSON result.
 */

export const RUN_SCRIPT_NODE_TYPE = 'runScript';

/** Template that receives the path of the temporary input file */
export const INPUT_FILE_VARIABLE = '_inputFile';

export type ScriptInputMode = 'none' | 'file' | 'stdin';
export type ScriptInputFormat = 'json' | 'lines';

/**
 * Splits a command-line style string into arguments: spaces separate them, and single or double
 * quotes group words ("dos tres" → one argument). A backslash only escapes a quote, a space or
 * another backslash, so Windows paths like C:\datos\a.csv are kept as typed.
 * Same rules as the Scripts console (frontend parseArgs).
 */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && quote !== "'" && /["'\\\s]/.test(input[i + 1] ?? '')) {
      current += input[++i];
      started = true;
    } else if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof v);

/**
 * Text of a value used as an argument: a list of plain values becomes "a,b,c" (one argument, readable
 * by any script), objects and lists of objects become JSON, null/undefined an empty argument.
 */
export function argText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value) && value.every(isPrimitive)) return value.map(v => (v === null ? '' : String(v))).join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Resolves the {{templates}} of one argument with `resolve` (path → value) */
export function resolveArg(token: string, resolve: (path: string) => unknown): string {
  const exact = token.trim().match(/^\{\{([^}]+)\}\}$/);
  if (exact) return argText(resolve(exact[1].trim()));
  return token.replace(/\{\{([^}]+)\}\}/g, (_m, p: string) => argText(resolve(p.trim())));
}

export function buildScriptArgs(raw: unknown, resolve: (path: string) => unknown): string[] {
  return splitArgs(String(raw ?? '')).map(token => resolveArg(token, resolve));
}

/**
 * One argument of the node, defined on its own row:
 * - flag: "--tickets", "-f", "--modo=" (joined to the value) or empty for a positional argument;
 * - value: text with {{templates}}; spaces need no quotes. If it resolves to nothing the row is not
 *   sent at all (an optional --fecha left empty disappears instead of sending "--fecha ''");
 * - kind 'switch': a flag without value (store_true); sent when the value is empty or resolves to true;
 * - list: how a list reaches the script: 'comma' → "a,b,c" (one argument), 'separate' → one argument
 *   per element (argparse nargs="*" / "+").
 */
export interface ScriptArgRow {
  flag?: string;
  value?: string;
  kind?: 'value' | 'switch';
  list?: 'comma' | 'separate';
  hint?: string;
}

const FALSY = new Set(['', 'false', '0', 'no', 'off', 'null', 'undefined']);

/** Value of a row before turning it into text: the raw data for "{{ruta}}", text otherwise */
function rowValue(value: string, resolve: (path: string) => unknown): unknown {
  const exact = value.trim().match(/^\{\{([^}]+)\}\}$/);
  return exact ? resolve(exact[1].trim()) : resolveArg(value, resolve);
}

export function buildArgsFromRows(rows: ScriptArgRow[], resolve: (path: string) => unknown): string[] {
  const argv: string[] = [];
  for (const row of rows) {
    const flag = String(row.flag ?? '').trim();
    const raw = String(row.value ?? '');

    if (row.kind === 'switch') {
      if (!flag) continue;
      const on = raw.trim() === '' || !FALSY.has(argText(rowValue(raw, resolve)).trim().toLowerCase());
      if (on) argv.push(flag);
      continue;
    }

    if (raw.trim() === '') continue;
    const value = rowValue(raw, resolve);
    const values = Array.isArray(value) && row.list === 'separate'
      ? value.map(argText).filter(v => v !== '')
      : [argText(value)].filter(v => v !== '');
    if (values.length === 0) continue;

    if (flag.endsWith('=')) argv.push(`${flag}${values.join(',')}`);
    else argv.push(...(flag ? [flag] : []), ...values);
  }
  return argv;
}

/** What each row turns into, for the debug preview: the arguments it sends, or nothing (skipped) */
export function explainScriptArgs(data: any, resolve: (path: string) => unknown): Array<{ flag: string; value: string; argv: string[] }> {
  const rows: ScriptArgRow[] = Array.isArray(data?.argList)
    ? data.argList
    : splitArgs(String(data?.args ?? '')).map(token => ({ flag: '', value: token }));
  return rows
    .filter(row => String(row.flag ?? '').trim() || String(row.value ?? '').trim())
    .map(row => ({ flag: String(row.flag ?? '').trim(), value: String(row.value ?? ''), argv: buildArgsFromRows([row], resolve) }));
}

/** Arguments of a node: its rows, or the command-line text of nodes created before the rows existed */
export function scriptNodeArgs(data: any, resolve: (path: string) => unknown): string[] {
  return Array.isArray(data?.argList)
    ? buildArgsFromRows(data.argList, resolve)
    : buildScriptArgs(data?.args, resolve);
}

/** Text of all the rows (or the legacy string), to look for {{_inputFile}} and similar */
export const scriptArgsText = (data: any): string =>
  Array.isArray(data?.argList) ? data.argList.map((r: ScriptArgRow) => `${r.flag ?? ''} ${r.value ?? ''}`).join(' ') : String(data?.args ?? '');

// ── Arguments declared by a Python script (argparse) ──

export interface DetectedScriptArg {
  flag: string;          // "--tickets", or "" for a positional argument
  name: string;          // "tickets"
  aliases: string[];     // ["-t", "--tickets"]
  help: string;
  required: boolean;
  kind: 'value' | 'switch';
  list: boolean;         // nargs * / + / number: accepts several values
  defaultValue?: string;
}

/** Splits the text inside a call by its top-level commas, skipping strings and brackets */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') current += text[++i] ?? '';
      else if (text.startsWith(quote, i)) {
        if (quote.length === 3) { current += text.slice(i + 1, i + 3); i += 2; }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      current += quote;
      i += quote.length - 1;
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Text of a Python string literal (or of several literals written one after another) */
function pyStringValue(expr: string): string | null {
  const literals = [...expr.matchAll(/[rRuUbBfF]{0,2}("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)];
  if (literals.length === 0) return null;
  return literals
    .map(m => {
      const lit = m[1];
      const body = lit.startsWith('"""') || lit.startsWith("'''") ? lit.slice(3, -3) : lit.slice(1, -1);
      return body.replace(/\\(["'\\])/g, '$1').replace(/\\n/g, ' ');
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Body of each add_argument(...) call, with nested parentheses and strings handled */
function addArgumentCalls(code: string): string[] {
  const calls: string[] = [];
  const re = /\.add_argument\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let quote: string | null = null;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (code.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
        continue;
      }
      if (ch === '#') { while (i < code.length && code[i] !== '\n') i++; continue; }
      if (ch === '"' || ch === "'") { quote = code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch; i += quote.length - 1; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    calls.push(code.slice(start, i - 1));
  }
  return calls;
}

/**
 * Arguments declared with argparse's add_argument() in a Python script, read from the source
 * without running it. Only what can be read statically: literal flags, help, nargs, required, action.
 */
export function detectScriptArguments(code: string): DetectedScriptArg[] {
  const found: DetectedScriptArg[] = [];
  for (const body of addArgumentCalls(code)) {
    const parts = splitTopLevel(body);
    const names: string[] = [];
    const kw: Record<string, string> = {};
    for (const part of parts) {
      const kv = part.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (kv) kw[kv[1]] = kv[2].trim();
      else {
        const s = pyStringValue(part);
        if (s !== null) names.push(s);
      }
    }
    if (names.length === 0) continue;

    const options = names.filter(n => n.startsWith('-'));
    const positional = options.length === 0;
    const flag = positional ? '' : options.find(o => o.startsWith('--')) ?? options[0];
    const dest = kw.dest ? pyStringValue(kw.dest) : null;
    const name = dest || (positional ? names[0] : flag.replace(/^-+/, '').replace(/-/g, '_'));
    const action = kw.action ? pyStringValue(kw.action) ?? '' : '';
    const nargs = kw.nargs ? (pyStringValue(kw.nargs) ?? kw.nargs) : '';
    const isSwitch = /^store_(true|false|const)$|^count$/.test(action);
    const required = positional ? !['*', '?'].includes(nargs) : /^True$/.test(kw.required ?? '');
    const defaultRaw = kw.default?.trim();

    found.push({
      flag,
      name,
      aliases: options,
      help: kw.help ? pyStringValue(kw.help) ?? '' : '',
      required,
      kind: isSwitch ? 'switch' : 'value',
      list: ['*', '+'].includes(nargs) || /^\d+$/.test(nargs) && Number(nargs) > 1 || action === 'append',
      defaultValue: defaultRaw && defaultRaw !== 'None' ? pyStringValue(defaultRaw) ?? defaultRaw : undefined,
    });
  }
  return found;
}

/**
 * Windows rejects command lines over 32 767 characters; this leaves margin for the interpreter path.
 * Long lists (thousands of tickets) must go in the input file instead.
 */
export const MAX_COMMAND_LINE_CHARS = 30_000;
export const commandLineLength = (argv: string[]) => argv.reduce((n, a) => n + a.length + 3, 0);

/** Rows inside the usual result shapes ({ rows }, { data }, { items }, transform { _data }) */
function unwrapRows(data: any): any {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data._data !== undefined && Array.isArray(data._logs)) return unwrapRows(data._data);
    for (const key of ['rows', 'data', 'items']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return data;
}

/**
 * Data sent to the script: 'json' as is; 'lines' one value per line (for lists of tickets, ids…):
 * with rows, the value of `field` or, without it, the first column of each row.
 */
export function serializeScriptInput(data: unknown, format: ScriptInputFormat, field?: string): string {
  if (format === 'json') return JSON.stringify(data === undefined ? null : unwrapRows(data), null, 2);

  const rows = unwrapRows(data);
  const list = Array.isArray(rows) ? rows : rows === undefined || rows === null ? [] : [rows];
  const key = String(field ?? '').trim();
  return list
    .map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const value = key ? row[key] : Object.values(row)[0];
        return argText(value);
      }
      return argText(row);
    })
    .filter(line => line !== '')
    .join('\n');
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Result of the script: the JSON written to ORQUESTA_OUTPUT_FILE; otherwise all of stdout when it is
 * JSON; otherwise its last line when that line is a JSON object or list (logs first, result at the end).
 * `undefined` when the script returned no JSON.
 */
export function parseScriptResult(stdout: string, outputFile?: string | null): unknown {
  if (outputFile && outputFile.trim()) {
    const parsed = tryJson(outputFile.trim());
    if (parsed.ok) return parsed.value;
    throw new Error('El script escribió en ORQUESTA_OUTPUT_FILE un contenido que no es JSON válido.');
  }
  const text = stdout.trim();
  if (!text) return undefined;
  const whole = tryJson(text);
  if (whole.ok && whole.value !== null && typeof whole.value === 'object') return whole.value;

  const last = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || '';
  if (/^[[{]/.test(last)) {
    const parsed = tryJson(last);
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}

/** Last part of a long text, for error messages */
export const tail = (text: string, max = 800) => (text.length > max ? `…${text.slice(-max)}` : text).trim();
