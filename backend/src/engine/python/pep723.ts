import { parse as parseToml } from 'smol-toml';

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
