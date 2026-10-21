/**
 * Splits a command-line style string into arguments: spaces separate them, and single or double
 * quotes group words ("dos tres" → one argument). A backslash only escapes a quote, a space or
 * another backslash, so Windows paths like C:\datos\a.csv are kept as typed.
 */
const ESCAPABLE = /["'\\\s]/;

export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && quote !== "'" && ESCAPABLE.test(input[i + 1] ?? '')) {
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
