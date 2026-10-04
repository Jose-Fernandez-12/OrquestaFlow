import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

/**
 * Inline script metadata (PEP 723): a script may declare its own dependencies in a comment block
 *
 *   # /// script
 *   # requires-python = ">=3.11"
 *   # dependencies = ["pandas>=2.2", "openpyxl"]
 *   # ///
 *
 * and is then run with `uv run --script` in an isolated, cached environment.
 */

export interface ScriptMetadata {
  dependencies: string[];
  requiresPython?: string;
}

export type MetadataResult =
  | { ok: true; metadata: ScriptMetadata | null }
  | { ok: false; error: string };

// Reference regex from the specification
const BLOCK_RE = /^# \/\/\/ ([a-zA-Z0-9-]+)[ \t]*\r?\n((?:^#(?:| .*)\r?\n)*?)^# \/\/\/[ \t]*$/gm;

export function parseScriptMetadata(code: string): MetadataResult {
  const blocks = [...String(code || '').matchAll(BLOCK_RE)].filter(m => m[1] === 'script');
  if (blocks.length === 0) return { ok: true, metadata: null };
  if (blocks.length > 1) return { ok: false, error: 'El script tiene más de un bloque "# /// script".' };

  const toml = blocks[0][2]
    .split(/\r?\n/)
    .map(line => (line.startsWith('# ') ? line.slice(2) : line.slice(1)))
    .join('\n');

  let data: any;
  try {
    data = parseToml(toml);
  } catch (e: any) {
    return { ok: false, error: `Bloque "# /// script" inválido: ${e?.message || e}` };
  }

  const deps = data.dependencies ?? [];
  if (!Array.isArray(deps) || deps.some((d: unknown) => typeof d !== 'string')) {
    return { ok: false, error: '"dependencies" debe ser una lista de textos, p. ej. ["pandas>=2.2"].' };
  }
  if (data['requires-python'] !== undefined && typeof data['requires-python'] !== 'string') {
    return { ok: false, error: '"requires-python" debe ser un texto, p. ej. ">=3.11".' };
  }
  return { ok: true, metadata: { dependencies: deps.map((d: string) => d.trim()).filter(Boolean), requiresPython: data['requires-python'] } };
}

/**
 * Returns the code with its "# /// script" block set to these dependencies (other keys of an existing
 * block are kept). With no dependencies and no requires-python the block is removed.
 */
export function writeScriptMetadata(code: string, metadata: ScriptMetadata): string {
  const source = String(code || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const match = [...source.matchAll(BLOCK_RE)].find(m => m[1] === 'script');

  let extra: Record<string, unknown> = {};
  if (match) {
    const parsed = parseScriptMetadata(source);
    if (!parsed.ok) throw new Error(parsed.error);
    try {
      const toml = match[2].split(/\r?\n/).map(l => (l.startsWith('# ') ? l.slice(2) : l.slice(1))).join('\n');
      const { dependencies: _d, 'requires-python': _r, ...rest } = parseToml(toml) as Record<string, unknown>;
      extra = rest;
    } catch { /* validated above */ }
  }

  const deps = metadata.dependencies.map(d => d.trim()).filter(Boolean);
  const requires = metadata.requiresPython?.trim();
  const empty = deps.length === 0 && !requires && Object.keys(extra).length === 0;

  let block = '';
  if (!empty) {
    const data: Record<string, unknown> = {};
    if (requires) data['requires-python'] = requires;
    data.dependencies = deps;
    Object.assign(data, extra);
    const body = stringifyToml(data).trim().split('\n').map(l => (l ? `# ${l}` : '#'));
    block = ['# /// script', ...body, '# ///'].join(eol);
  }

  if (match) {
    const start = match.index!;
    let end = start + match[0].length;
    if (!block) {
      // Drop the line break after the removed block and a blank line that only separated it
      const after = source.slice(end).match(/^(\r?\n){1,2}/);
      if (after) end += after[0].length;
    }
    return source.slice(0, start) + block + source.slice(end);
  }
  if (!block) return source;

  // After a shebang / encoding line, which must stay first
  const lines = source.split(/\r?\n/);
  let insertAt = 0;
  while (insertAt < lines.length && insertAt < 2 && /^#(!|.*coding[:=])/.test(lines[insertAt])) insertAt++;
  const head = lines.slice(0, insertAt);
  const rest = lines.slice(insertAt);
  return [...head, block, ...(rest.length && rest[0].trim() !== '' ? [''] : []), ...rest].join(eol);
}

function versionTuple(v: string): number[] {
  return v.split('.').map(n => parseInt(n, 10) || 0);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Whether a Python version such as "3.12.7" satisfies a requires-python specifier like ">=3.11,<3.14" */
export function pythonSatisfies(version: string, spec: string | undefined): boolean {
  if (!spec || !spec.trim()) return true;
  const v = versionTuple(version);
  return spec.split(',').map(s => s.trim()).filter(Boolean).every(clause => {
    const m = clause.match(/^(~=|===|==|!=|<=|>=|<|>)\s*([\d.]+)(\.\*)?$/);
    if (!m) return false;
    const [, op, raw, wildcard] = m;
    const target = versionTuple(raw);
    const prefixMatch = () => target.every((n, i) => v[i] === n);
    switch (op) {
      case '==': case '===': return wildcard ? prefixMatch() : compareVersions(v, target) === 0;
      case '!=': return wildcard ? !prefixMatch() : compareVersions(v, target) !== 0;
      case '>=': return compareVersions(v, target) >= 0;
      case '<=': return compareVersions(v, target) <= 0;
      case '>': return compareVersions(v, target) > 0;
      case '<': return compareVersions(v, target) < 0;
      case '~=': {
        // ~=3.11 → >=3.11, ==3.*   ~=3.11.2 → >=3.11.2, ==3.11.*
        if (target.length < 2 || compareVersions(v, target) < 0) return false;
        return target.slice(0, -1).every((n, i) => v[i] === n);
      }
      default: return false;
    }
  });
}

/**
 * Reads a requirements.txt: one requirement per line, comments and continuation lines allowed.
 * pip options (-r, -e, --index-url…), local paths and bare URLs cannot go in a PEP 723 header, so
 * they are returned as ignored with the reason. A package listed twice keeps its last line.
 */
export function parseRequirementsText(text: string): { specs: string[]; ignored: Array<{ line: string; reason: string }> } {
  const ignored: Array<{ line: string; reason: string }> = [];
  const byName = new Map<string, string>();
  const joined = String(text || '').replace(/^﻿/, '').replace(/\\\r?\n/g, ' ');

  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('-')) {
      ignored.push({ line, reason: 'Opción de pip: no se admite en las dependencias del script' });
      continue;
    }
    const spec = line.replace(/\s--hash[=\s]\S+/g, '').replace(/\s+/g, ' ').trim();
    if (/^(\.|\/|[A-Za-z]:[\\/])/.test(spec) || (/:\/\//.test(spec) && !/\s@\s/.test(spec))) {
      ignored.push({ line, reason: 'Ruta local o URL sin nombre de paquete' });
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*/.test(spec)) {
      ignored.push({ line, reason: 'No parece un paquete' });
      continue;
    }
    byName.set(requirementName(spec), spec);
  }
  return { specs: [...byName.values()], ignored };
}

/** Top-level module names imported by the script (relative imports and docstrings ignored) */
export function detectImports(code: string): string[] {
  const found = new Set<string>();
  let inString: string | null = null;

  for (const rawLine of String(code || '').split(/\r?\n/)) {
    let line = rawLine;
    // Skip triple-quoted blocks (docstrings) spanning lines
    if (inString) {
      const end = line.indexOf(inString);
      if (end === -1) continue;
      line = line.slice(end + 3);
      inString = null;
    }
    const opener = line.match(/("""|''')/);
    if (opener && line.indexOf(opener[1], (opener.index ?? 0) + 3) === -1) {
      line = line.slice(0, opener.index);
      inString = opener[1];
    }
    line = line.replace(/#.*$/, '');

    const from = line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/);
    if (from) {
      found.add(from[1].split('.')[0]);
      continue;
    }
    const imp = line.match(/^\s*import\s+(.+)$/);
    if (imp) {
      for (const part of imp[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim().split('.')[0];
        if (/^[A-Za-z_]\w*$/.test(name)) found.add(name);
      }
    }
  }
  return [...found];
}

// Import names that differ from the package to install
const MODULE_TO_PACKAGE: Record<string, string> = {
  sklearn: 'scikit-learn',
  cv2: 'opencv-python',
  PIL: 'Pillow',
  yaml: 'PyYAML',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  dateutil: 'python-dateutil',
  docx: 'python-docx',
  pptx: 'python-pptx',
  win32com: 'pywin32',
  Crypto: 'pycryptodome',
  jwt: 'PyJWT',
  magic: 'python-magic',
  serial: 'pyserial',
  usb: 'pyusb',
  attr: 'attrs',
  google: 'google-api-python-client',
};

export function moduleToPackage(name: string): string {
  return MODULE_TO_PACKAGE[name] || name;
}

/** Normalised distribution name (PEP 503), to compare "Scikit_Learn" with "scikit-learn" */
export const normalizePackageName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** Name part of a requirement such as "pandas[excel]>=2.2; python_version>'3.9'" */
export function requirementName(spec: string): string {
  return normalizePackageName(String(spec).trim().split(/[\s<>=!~;[(@]/)[0]);
}

// Used when no Python is available to ask for sys.stdlib_module_names
export const FALLBACK_STDLIB = new Set([
  '__future__', 'abc', 'argparse', 'array', 'ast', 'asyncio', 'base64', 'binascii', 'bisect', 'builtins', 'bz2',
  'calendar', 'cmath', 'codecs', 'collections', 'concurrent', 'configparser', 'contextlib', 'copy', 'csv', 'ctypes',
  'dataclasses', 'datetime', 'decimal', 'difflib', 'email', 'enum', 'errno', 'fnmatch', 'fractions', 'ftplib',
  'functools', 'gc', 'getpass', 'glob', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'importlib',
  'inspect', 'io', 'ipaddress', 'itertools', 'json', 'locale', 'logging', 'lzma', 'math', 'mimetypes',
  'multiprocessing', 'numbers', 'operator', 'os', 'pathlib', 'pickle', 'platform', 'pprint', 'queue', 'random', 're',
  'secrets', 'select', 'shlex', 'shutil', 'signal', 'smtplib', 'socket', 'sqlite3', 'ssl', 'statistics', 'string',
  'struct', 'subprocess', 'sys', 'tarfile', 'tempfile', 'textwrap', 'threading', 'time', 'timeit', 'tkinter',
  'traceback', 'types', 'typing', 'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'weakref',
  'winreg', 'xml', 'zipfile', 'zlib', 'zoneinfo',
]);
