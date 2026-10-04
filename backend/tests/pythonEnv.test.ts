import { describe, it, expect } from 'vitest';
import { parseScriptMetadata, writeScriptMetadata, parseRequirementsText, pythonSatisfies, detectImports, moduleToPackage, requirementName } from '../src/engine/python/pep723';
import { parseDryRun, decideEnvironment, depsHash, summarizeScriptEnvironment, missingPackages } from '../src/engine/python/scriptEnv';
import { resolveInterpreter, runtimePaths, PythonNotReadyError, type PythonEnvStatus } from '../src/engine/python/environment';
import { buildSetupSteps, uvAssetName, validateRequirementSpec, withRequirement, withoutRequirement } from '../src/engine/python/setup';

describe('parseScriptMetadata (PEP 723)', () => {
  it('reads dependencies and requires-python from the script block', () => {
    const code = [
      '#!/usr/bin/env python',
      '# /// script',
      '# requires-python = ">=3.11"',
      '# dependencies = [',
      '#   "requests<3",',
      '#   "rich",',
      '# ]',
      '# ///',
      'import requests',
    ].join('\n');
    expect(parseScriptMetadata(code)).toEqual({ ok: true, metadata: { dependencies: ['requests<3', 'rich'], requiresPython: '>=3.11' } });
  });

  it('accepts CRLF line endings and empty comment lines', () => {
    const code = '# /// script\r\n#\r\n# dependencies = ["pandas"]\r\n# ///\r\nprint(1)';
    expect(parseScriptMetadata(code)).toEqual({ ok: true, metadata: { dependencies: ['pandas'], requiresPython: undefined } });
  });

  it('returns null without a script block and ignores other block types', () => {
    expect(parseScriptMetadata('import os\nprint(1)')).toEqual({ ok: true, metadata: null });
    expect(parseScriptMetadata('# /// pyproject\n# x = 1\n# ///\n')).toEqual({ ok: true, metadata: null });
  });

  it('explains invalid blocks', () => {
    const bad = parseScriptMetadata('# /// script\n# dependencies = ["pandas"\n# ///\n');
    expect(bad.ok).toBe(false);
    const wrongType = parseScriptMetadata('# /// script\n# dependencies = "pandas"\n# ///\n');
    expect(wrongType).toEqual({ ok: false, error: expect.stringMatching(/lista de textos/) });
    const twice = parseScriptMetadata('# /// script\n# dependencies = []\n# ///\n# /// script\n# dependencies = []\n# ///\n');
    expect(twice).toEqual({ ok: false, error: expect.stringMatching(/más de un bloque/) });
  });
});

describe('detectImports', () => {
  it('lists top-level modules from import and from-import, skipping relative imports and docstrings', () => {
    const code = [
      '"""Uso:',
      'import notamodule',
      '"""',
      'import os, sys as system',
      'import xml.etree.ElementTree as ET',
      'from pandas import DataFrame',
      'from . import utils',
      'from .local import helper',
      'def f():',
      '    import requests  # dentro de una función',
      "x = 'import fake'",
    ].join('\n');
    expect(detectImports(code).sort()).toEqual(['os', 'pandas', 'requests', 'sys', 'xml']);
  });

  it('maps import names to the package to install', () => {
    expect(moduleToPackage('sklearn')).toBe('scikit-learn');
    expect(moduleToPackage('PIL')).toBe('Pillow');
    expect(moduleToPackage('pandas')).toBe('pandas');
    expect(requirementName('Scikit_Learn[all]>=1.0; python_version>"3.9"')).toBe('scikit-learn');
  });
});

describe('resolveInterpreter', () => {
  const paths = runtimePaths('/rt');
  const status = (over: Partial<PythonEnvStatus> = {}): PythonEnvStatus => ({
    uv: null, venv: null, system: null, packages: [], stdlib: null, checkedAt: 1, ...over,
  });
  const uv = { path: '/rt/bin/uv', version: '0.12.23', managed: true };
  const venv = { python: paths.venvPython, version: '3.12.7' };
  const system = { command: 'python', args: [], version: '3.11.2' };
  const pep723 = '# /// script\n# dependencies = ["tabulate"]\n# ///\nimport tabulate\n';
  const plain = 'print("hola")\n';
  const opts = (s: PythonEnvStatus, env: NodeJS.ProcessEnv = {}, scriptEnv: { python?: string; pending: boolean } | null = null) =>
    ({ status: s, env, paths, scriptEnv });

  it('runs a script with its own environment when it has one', () => {
    const r = resolveInterpreter('/s/a.py', pep723, opts(status({ uv, venv }), {}, { python: '/rt/envs/s1/bin/python', pending: false }));
    expect(r).toMatchObject({ mode: 'propio', command: '/rt/envs/s1/bin/python', args: ['-u', '/s/a.py'] });
    expect(r.env.UV_CACHE_DIR).toBe(paths.cache);
    expect(r.metadata?.dependencies).toEqual(['tabulate']);
    expect(r.notice).toBeUndefined();
  });

  it('runs scripts with dependencies in the shared environment and warns when they were not prepared', () => {
    const shared = resolveInterpreter('/s/a.py', pep723, opts(status({ uv, venv }), {}, { pending: false }));
    expect(shared).toMatchObject({ mode: 'compartido', command: paths.venvPython });
    const pending = resolveInterpreter('/s/a.py', pep723, opts(status({ uv, venv }), {}, { pending: true }));
    expect(pending.notice).toMatch(/Preparar entorno/);
  });

  it('prefers PYTHON_PATH, then the shared venv, then the system Python for plain scripts', () => {
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ uv, venv, system }), { PYTHON_PATH: '/opt/py' })))
      .toMatchObject({ mode: 'manual', command: '/opt/py', args: ['-u', '/s/a.py'] });
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ uv, venv, system }))))
      .toMatchObject({ mode: 'compartido', command: paths.venvPython, args: ['-u', '/s/a.py'] });
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ system: { command: 'py', args: ['-3'], version: '3.11' } }))))
      .toMatchObject({ mode: 'sistema', command: 'py', args: ['-3', '-u', '/s/a.py'] });
  });

  it('lets PYTHON_PATH win over the script environment', () => {
    expect(resolveInterpreter('/s/a.py', pep723, opts(status({ venv }), { PYTHON_PATH: '/opt/py' }, { python: '/own', pending: false })).mode)
      .toBe('manual');
  });

  it('fails with a clear message when no Python is available', () => {
    expect(() => resolveInterpreter('/s/a.py', plain, opts(status()))).toThrow(PythonNotReadyError);
    expect(() => resolveInterpreter('/s/a.py', plain, opts(status()))).toThrow(/npm run python:setup/);
  });

  it('reports an invalid PEP 723 block instead of running the script', () => {
    expect(() => resolveInterpreter('/s/a.py', '# /// script\n# dependencies = 3\n# ///\n', opts(status({ uv }))))
      .toThrow(/lista de textos/);
  });
});

describe('setup', () => {
  const uv = { path: 'uv', version: '0.12.23', managed: true };

  it('plans only the missing steps', () => {
    const ids = (s: any, hasRequirements = true) => buildSetupSteps(s, { pythonVersion: '3.12', hasRequirements }).map(x => x.id);
    expect(ids({ uv: null, venv: null })).toEqual(['download-uv', 'install-python', 'create-venv', 'install-packages']);
    expect(ids({ uv, venv: { python: 'p', version: '3.12.7' } })).toEqual(['install-packages']);
    expect(ids({ uv, venv: { python: 'p', version: '3.12.7' } }, false)).toEqual([]);
    expect(ids({ uv, venv: { python: 'p', version: '3.11.9' } }, false)).toEqual(['install-python', 'create-venv']);
    expect(ids({ uv, venv: { python: 'p', version: '3.120.1' } }, false)).toEqual(['install-python', 'create-venv']);
  });

  it('picks the uv release asset for each platform', () => {
    expect(uvAssetName('win32', 'x64')).toBe('uv-x86_64-pc-windows-msvc.zip');
    expect(uvAssetName('linux', 'arm64')).toBe('uv-aarch64-unknown-linux-gnu.tar.gz');
    expect(uvAssetName('darwin', 'arm64')).toBe('uv-aarch64-apple-darwin.tar.gz');
    expect(() => uvAssetName('win32', 'ia32')).toThrow(/no soportada/);
  });

  it('accepts package specs and rejects pip options', () => {
    expect(validateRequirementSpec(' pandas==2.2.3 ')).toBe('pandas==2.2.3');
    expect(validateRequirementSpec('requests>=2.31,<3')).toBe('requests>=2.31,<3');
    expect(validateRequirementSpec('pandas[excel]')).toBe('pandas[excel]');
    for (const bad of ['--index-url http://x', '-r otro.txt', 'pandas; rm -rf /', '', 'git+https://x/y.git']) {
      expect(() => validateRequirementSpec(bad)).toThrow(/no es un paquete válido/);
    }
  });

  it('edits the requirements file keeping comments and line endings', () => {
    const text = '# comentario\r\npandas==2.0\r\n--index-url https://interno\r\n';
    expect(withRequirement(text, 'pandas==2.2.3')).toBe('# comentario\r\npandas==2.2.3\r\n--index-url https://interno\r\n');
    expect(withRequirement(text, 'requests')).toBe('# comentario\r\npandas==2.0\r\n--index-url https://interno\r\nrequests\r\n');
    expect(withRequirement('', 'rich')).toBe('rich\n');
    expect(withoutRequirement(text, 'Pandas')).toBe('# comentario\r\n--index-url https://interno\r\n');
  });
});

describe('writeScriptMetadata', () => {
  it('adds a header after the shebang, replaces it and removes it when empty', () => {
    const code = '#!/usr/bin/env python\nimport pandas\n';
    const added = writeScriptMetadata(code, { dependencies: ['pandas', 'openpyxl>=3'] });
    expect(added).toBe('#!/usr/bin/env python\n# /// script\n# dependencies = [ "pandas", "openpyxl>=3" ]\n# ///\n\nimport pandas\n');
    expect(parseScriptMetadata(added)).toEqual({ ok: true, metadata: { dependencies: ['pandas', 'openpyxl>=3'], requiresPython: undefined } });

    const replaced = writeScriptMetadata(added, { dependencies: ['pandas==2.2.3'], requiresPython: '>=3.11' });
    expect(parseScriptMetadata(replaced)).toEqual({ ok: true, metadata: { dependencies: ['pandas==2.2.3'], requiresPython: '>=3.11' } });
    expect(replaced.split('# /// script').length).toBe(2);

    expect(writeScriptMetadata(replaced, { dependencies: [] })).toBe(code);
  });

  it('keeps other keys of the block and CRLF line endings', () => {
    const code = '# /// script\r\n# dependencies = ["a"]\r\n# [tool.uv]\r\n# exclude-newer = "2024-01-01T00:00:00Z"\r\n# ///\r\nprint(1)\r\n';
    const out = writeScriptMetadata(code, { dependencies: ['b'] });
    expect(out).toContain('exclude-newer');
    expect(out.includes('\n') && !/[^\r]\n/.test(out)).toBe(true);
    expect(parseScriptMetadata(out)).toMatchObject({ ok: true, metadata: { dependencies: ['b'] } });
  });
});

describe('pythonSatisfies', () => {
  it('evaluates requires-python specifiers', () => {
    expect(pythonSatisfies('3.12.7', '>=3.11')).toBe(true);
    expect(pythonSatisfies('3.12.7', '>=3.11,<3.12')).toBe(false);
    expect(pythonSatisfies('3.12.7', '==3.12.*')).toBe(true);
    expect(pythonSatisfies('3.12.7', '!=3.12.*')).toBe(false);
    expect(pythonSatisfies('3.12.7', '~=3.10')).toBe(true);
    expect(pythonSatisfies('3.12.7', '~=3.10.1')).toBe(false);
    expect(pythonSatisfies('3.12.7', undefined)).toBe(true);
  });
});

describe('script environment decision', () => {
  const meta = (dependencies: string[], requiresPython?: string) => ({ dependencies, requiresPython });

  it('reads uv dry-run output', () => {
    const out = 'Resolved 2 packages in 3ms\nWould uninstall 1 package\nWould install 2 packages\n - tabulate==0.9.0\n + tabulate==0.8.10\n + wcwidth==0.2.13\n';
    expect(parseDryRun(out, 0)).toEqual({ ok: true, installs: ['tabulate==0.8.10', 'wcwidth==0.2.13'], removals: ['tabulate==0.9.0'] });
    expect(parseDryRun('Would make no changes\n', 0)).toEqual({ ok: true, installs: [], removals: [] });
    expect(parseDryRun('  × No solution found when resolving dependencies:\n  ╰─▶ Because foo==9 was not found...', 1).ok).toBe(false);
  });

  it('uses the shared environment when nothing or only new packages would be installed', () => {
    expect(decideEnvironment(meta(['tabulate']), '3.12.7', { ok: true, installs: [], removals: [] }))
      .toEqual({ mode: 'compartido', reason: null, install: [] });
    expect(decideEnvironment(meta(['requests']), '3.12.7', { ok: true, installs: ['requests==2.32.3'], removals: [] }))
      .toEqual({ mode: 'compartido', reason: null, install: ['requests==2.32.3'] });
  });

  it('gives the script its own environment when a shared version would change', () => {
    const d = decideEnvironment(meta(['tabulate==0.8.10']), '3.12.7', { ok: true, installs: ['tabulate==0.8.10'], removals: ['tabulate==0.9.0'] });
    expect(d.mode).toBe('propio');
    expect(d.reason).toMatch(/tabulate 0\.9\.0 → 0\.8\.10/);
  });

  it('gives its own environment for another Python version or unresolvable dependencies', () => {
    expect(decideEnvironment(meta([], '>=3.13'), '3.12.7', null)).toMatchObject({ mode: 'propio', reason: expect.stringMatching(/Python >=3\.13/) });
    expect(decideEnvironment(meta(['x']), '3.12.7', { ok: false, installs: [], removals: [], error: 'conflicto' }).mode).toBe('propio');
  });

  it('summarizes what the card shows', () => {
    const ready = { uv: { path: 'uv', version: '1', managed: true }, venv: { python: 'p', version: '3.12.7' }, system: null, packages: [], stdlib: null, checkedAt: 1 };
    const header = '# /// script\n# dependencies = ["tabulate"]\n# ///\n';
    const hash = depsHash({ dependencies: ['tabulate'] });
    const shared = JSON.stringify({ mode: 'compartido', hash, resolved: { tabulate: '0.9.0' }, reason: null, pythonVersion: '3.12.7', preparedAt: 1 });
    expect(summarizeScriptEnvironment('s', null, 'print(1)', ready).view).toBe('sin-dependencias');
    expect(summarizeScriptEnvironment('s', null, header, ready)).toMatchObject({ view: 'pendiente', stale: true });
    expect(summarizeScriptEnvironment('s', shared, header, ready)).toMatchObject({ view: 'compartido', stale: false });
    expect(summarizeScriptEnvironment('s', shared, header.replace('tabulate', 'tabulate==0.8'), ready).view).toBe('pendiente');
    expect(summarizeScriptEnvironment('s', shared, header, { ...ready, venv: null }).view).toBe('no-preparado');
    expect(summarizeScriptEnvironment('s', null, '# /// script\n# dependencies = 1\n# ///\n', ready).view).toBe('invalido');
  });
});

describe('parseRequirementsText', () => {
  it('reads requirements and explains what cannot go in the header', () => {
    const text = [
      '﻿# dependencias del reporte',
      'pandas==2.2.3  # fija',
      'openpyxl>=3.1 ; python_version >= "3.9"',
      'requests \\',
      '  >=2.31',
      'numpy==1.26.4 --hash=sha256:abc',
      '-r otros.txt',
      '--index-url https://interno/simple',
      './libs/propia',
      'https://x.org/paquete.whl',
      'mipaquete @ https://x.org/mipaquete-1.0.whl',
      'pandas==2.2.2',
      '',
    ].join('\r\n');
    const { specs, ignored } = parseRequirementsText(text);
    expect(specs).toEqual([
      'pandas==2.2.2',
      'openpyxl>=3.1 ; python_version >= "3.9"',
      'requests >=2.31',
      'numpy==1.26.4',
      'mipaquete @ https://x.org/mipaquete-1.0.whl',
    ]);
    expect(ignored.map(i => i.line)).toEqual(['-r otros.txt', '--index-url https://interno/simple', './libs/propia', 'https://x.org/paquete.whl']);
  });
});

describe('uv output with colors', () => {
  it('reads dry-run output that carries ANSI codes (FORCE_COLOR under concurrently)', () => {
    const colored = '\x1b[2mResolved \x1b[1m1 package\x1b[0m\x1b[0m\n \x1b[32m+\x1b[39m \x1b[1mtabulate\x1b[0m\x1b[2m==0.10.0\x1b[0m\n';
    expect(parseDryRun(colored, 0)).toEqual({ ok: true, installs: ['tabulate==0.10.0'], removals: [] });
  });

  it('lists declared packages that did not get installed', () => {
    expect(missingPackages(['tabulate>=0.9', 'Rich', 'colorama; sys_platform == "win32"'], { rich: '13.0' })).toEqual(['tabulate']);
  });
});
