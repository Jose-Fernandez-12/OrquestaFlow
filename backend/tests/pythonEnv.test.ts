import { describe, it, expect } from 'vitest';
import { parseScriptMetadata, detectImports, moduleToPackage, requirementName } from '../src/engine/python/pep723';
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
  const opts = (s: PythonEnvStatus, env: NodeJS.ProcessEnv = {}) => ({ status: s, env, paths, pythonVersion: '3.12' });

  it('runs PEP 723 scripts with uv in an isolated environment', () => {
    const r = resolveInterpreter('/s/a.py', pep723, opts(status({ uv, venv })));
    expect(r.mode).toBe('aislado');
    expect(r.command).toBe('/rt/bin/uv');
    expect(r.args).toEqual(['run', '--script', '--quiet', '--python', '3.12', '/s/a.py']);
    expect(r.env.UV_CACHE_DIR).toBe(paths.cache);
    expect(r.metadata?.dependencies).toEqual(['tabulate']);
  });

  it('lets requires-python choose the version and PYTHON_PATH override it', () => {
    const withRequires = '# /// script\n# requires-python = ">=3.13"\n# dependencies = []\n# ///\n';
    expect(resolveInterpreter('/s/a.py', withRequires, opts(status({ uv }))).args).toEqual(['run', '--script', '--quiet', '/s/a.py']);
    expect(resolveInterpreter('/s/a.py', pep723, opts(status({ uv }), { PYTHON_PATH: 'C:/Py/python.exe' })).args)
      .toEqual(['run', '--script', '--quiet', '--python', 'C:/Py/python.exe', '/s/a.py']);
  });

  it('prefers PYTHON_PATH, then the shared venv, then the system Python for plain scripts', () => {
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ uv, venv, system }), { PYTHON_PATH: '/opt/py' })))
      .toMatchObject({ mode: 'manual', command: '/opt/py', args: ['-u', '/s/a.py'] });
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ uv, venv, system }))))
      .toMatchObject({ mode: 'compartido', command: paths.venvPython, args: ['-u', '/s/a.py'] });
    expect(resolveInterpreter('/s/a.py', plain, opts(status({ system: { command: 'py', args: ['-3'], version: '3.11' } }))))
      .toMatchObject({ mode: 'sistema', command: 'py', args: ['-3', '-u', '/s/a.py'] });
  });

  it('warns when a script declares dependencies but uv is missing', () => {
    const r = resolveInterpreter('/s/a.py', pep723, opts(status({ venv })));
    expect(r.mode).toBe('compartido');
    expect(r.notice).toMatch(/uv no está disponible/);
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
