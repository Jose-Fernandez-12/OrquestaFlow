import { parseArgs } from '../../../scripts/parseArgs';

/**
 * One argument of the "Ejecutar script" node (same shape the engine reads in data.argList):
 * flag "--tickets" / "-f" / "--modo=" / "" (positional), value with {{templates}}.
 * A row whose value resolves to nothing is not sent; 'switch' rows are options without a value.
 */
export interface ArgRow {
  flag: string;
  value: string;
  kind?: 'value' | 'switch';
  list?: 'comma' | 'separate';
  hint?: string;
  required?: boolean;
  /** Name of a positional argument detected in the script (positional rows have no flag) */
  name?: string;
  /** Default the script applies when the row is not sent (shown as a placeholder) */
  defaultValue?: string;
}

/** Argument declared by the script (GET /scripts/:id/arguments) */
export interface DetectedArg {
  flag: string;
  name: string;
  aliases: string[];
  help: string;
  required: boolean;
  kind: 'value' | 'switch';
  list: boolean;
  defaultValue?: string;
}

const isFlag = (token: string) => /^--?[A-Za-z]/.test(token);

/** Rows of a node: data.argList, or the command-line text of nodes created before rows existed */
export function argRowsOf(data: Record<string, any>): ArgRow[] {
  if (Array.isArray(data.argList)) return data.argList as ArgRow[];
  return legacyArgsToRows(String(data.args ?? ''));
}

/** "--tickets {{x}} --verbose -f "2026-10-16 08:00" pos" → one row per option with its value */
export function legacyArgsToRows(text: string): ArgRow[] {
  const tokens = parseArgs(text);
  const rows: ArgRow[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isFlag(token)) {
      rows.push({ flag: '', value: token });
    } else if (token.includes('=') && !token.endsWith('=')) {
      const at = token.indexOf('=');
      rows.push({ flag: token.slice(0, at + 1), value: token.slice(at + 1) });
    } else if (i + 1 < tokens.length && !isFlag(tokens[i + 1])) {
      rows.push({ flag: token, value: tokens[++i] });
    } else {
      rows.push({ flag: token, value: '', kind: 'switch' });
    }
  }
  return rows;
}

const sameArg = (row: ArgRow, arg: DetectedArg) =>
  arg.flag ? row.flag === arg.flag || arg.aliases.includes(row.flag) : !row.flag && row.name === arg.name;

/**
 * Adds the arguments the script declares: existing rows keep their values (and take the declared
 * help/kind), new ones are appended empty. A list argument (nargs="*") gets one value per element.
 */
export function mergeDetectedArgs(rows: ArgRow[], detected: DetectedArg[]): ArgRow[] {
  const result = rows.map(row => {
    const arg = detected.find(a => sameArg(row, a));
    return arg
      ? { ...row, flag: arg.flag || row.flag, hint: arg.help || arg.name, required: arg.required, kind: arg.kind, defaultValue: arg.defaultValue }
      : row;
  });
  for (const arg of detected) {
    if (result.some(row => sameArg(row, arg))) continue;
    result.push({
      flag: arg.flag,
      value: '',
      kind: arg.kind,
      ...(arg.list ? { list: 'separate' as const } : {}),
      hint: arg.help || arg.name,
      required: arg.required,
      ...(arg.defaultValue !== undefined ? { defaultValue: arg.defaultValue } : {}),
      ...(arg.flag ? {} : { name: arg.name }),
    });
  }
  return result;
}

/** Placeholder of the value field: the declared help and default, or a generic example */
export function valuePlaceholder(row: ArgRow): string {
  if (row.kind === 'switch') return 'Siempre (o {{condición}}: se envía si es verdadera)';
  if (row.defaultValue) return `Vacío = por defecto del script (${row.defaultValue})`;
  return row.required ? 'Obligatorio' : 'Vacío = no se envía';
}

/** All the text of the rows, to look for {{_inputFile}} */
export const argRowsText = (rows: ArgRow[]) => rows.map(r => `${r.flag} ${r.value}`).join(' ');
