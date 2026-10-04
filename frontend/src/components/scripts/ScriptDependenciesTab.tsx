import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Wrench, RefreshCw, Loader2, ScanSearch, Terminal, Info, FileUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import type { ScriptEnvSummary } from '../../store/scriptSlice';
import { apiRequest } from './pythonEnvApi';
import { ENV_VIEW } from './envLabels';

interface ScriptRequirements extends ScriptEnvSummary {
  imports: Array<{ module: string; package: string; declared: boolean; sharedVersion: string | null }>;
  sharedPythonVersion: string | null;
  ownEnvironmentPath: string | null;
}

interface ScriptDependenciesTabProps {
  scriptId: string;
  refreshKey: number;
  /** An environment operation is running (preparing this script, or anything else) */
  busy: boolean;
  /** Prepares the environment, streaming the output into the console */
  onPrepare: () => Promise<void>;
  /** The header of the file changed or the environment was removed */
  onChanged: () => void;
  onOpenBaseEnv: () => void;
}

const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
const specName = (spec: string) => spec.trim().split(/[\s<>=!~;[(@]/)[0];

/** Dependencies of a Python script, kept in its PEP 723 header, and the environment it runs in */
export function ScriptDependenciesTab({ scriptId, refreshKey, busy, onPrepare, onChanged, onOpenBaseEnv }: ScriptDependenciesTabProps) {
  const [info, setInfo] = useState<ScriptRequirements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState('');
  const [python, setPython] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [editingPython, setEditingPython] = useState(false);
  const [ignored, setIgnored] = useState<Array<{ line: string; reason: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    setSaving(true);
    setMessage(null);
    setIgnored([]);
    try {
      const result = await apiRequest<{ imported: number; ignored: Array<{ line: string; reason: string }> }>(
        `/scripts/${scriptId}/dependencies/import`, 'POST', { text: await file.text(), mode: replaceOnImport ? 'replace' : 'merge' },
      );
      setIgnored(result.ignored);
      setMessage(`${result.imported} paquete(s) importados de ${file.name}. Se instalarán al preparar el entorno o al ejecutarlo.`);
      onChanged();
      await load();
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<ScriptRequirements | null>(`/scripts/${scriptId}/requirements`);
      setInfo(data);
      setPython(data?.requiresPython || '');
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [scriptId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const save = async (dependencies: string[], requiresPython = info?.requiresPython || '') => {
    setSaving(true);
    setMessage(null);
    try {
      await apiRequest(`/scripts/${scriptId}/dependencies`, 'PUT', { dependencies, requiresPython });
      setMessage('Guardado en la cabecera del script. Se instalarán al preparar el entorno o al ejecutarlo.');
      onChanged();
      await load();
      return true;
    } catch (err: any) {
      setMessage(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="p-4 text-xs text-danger">{error}</div>;
  if (!info) return <div className="p-4 text-xs text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Cargando dependencias…</div>;

  const view = ENV_VIEW[info.view];
  const deps = info.dependencies;
  const resolved = info.state && !info.stale ? info.state.resolved : {};
  const missingImports = info.imports.filter(i => !i.declared);
  const where = info.state?.mode === 'propio' && !info.stale ? 'propio' : 'compartido';
  const pythonVersion = info.state?.mode === 'propio' && !info.stale ? info.state.pythonVersion : info.sharedPythonVersion;

  const add = async () => {
    const clean = spec.trim();
    if (!clean) { setMessage('Escribe un paquete, p. ej. pandas o pandas==2.2.3'); return; }
    if (deps.some(d => normalize(specName(d)) === normalize(specName(clean)))) {
      if (await save(deps.map(d => (normalize(specName(d)) === normalize(specName(clean)) ? clean : d)))) setSpec('');
      return;
    }
    if (await save([...deps, clean])) setSpec('');
  };

  return (
    <div className="p-4 space-y-4 text-xs">
      {/* Environment */}
      <div className="p-3 rounded-md border border-border bg-bg space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('px-2 py-0.5 rounded font-medium', view.className)}>{view.label}</span>
          {pythonVersion && info.view !== 'no-preparado' && <span className="text-muted">Python {pythonVersion}</span>}
          {info.state && !info.stale && <span className="text-muted ml-auto">Preparado {new Date(info.state.preparedAt).toLocaleString()}</span>}
        </div>
        <p className="text-muted leading-relaxed">{info.state?.mode === 'propio' && !info.stale && info.state.reason ? info.state.reason : view.hint}</p>
        {info.metadataError && <p className="text-danger">{info.metadataError}</p>}
        {info.ownEnvironmentPath && !info.stale && <p className="text-[11px] text-muted font-mono break-all">{info.ownEnvironmentPath}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          {info.view === 'no-preparado' ? (
            <Button variant="primary" size="sm" onClick={onOpenBaseEnv} className="h-7 min-h-0 gap-1.5 text-xs">
              <Terminal size={12} /> Preparar entorno base
            </Button>
          ) : (
            <Button variant={info.view === 'pendiente' ? 'primary' : 'default'} size="sm" onClick={() => onPrepare().then(load)} disabled={busy || info.view === 'invalido'} className="h-7 min-h-0 gap-1.5 text-xs">
              {busy ? <Loader2 size={12} className="animate-spin" /> : info.view === 'pendiente' ? <Wrench size={12} /> : <RefreshCw size={12} />}
              {info.view === 'pendiente' ? 'Preparar entorno' : 'Reconstruir'}
            </Button>
          )}
          {info.state?.mode === 'propio' && (
            <Button variant="outline" size="sm" disabled={busy}
              onClick={async () => {
                if (!window.confirm('¿Eliminar el entorno propio de este script? Se volverá a crear al prepararlo.')) return;
                await apiRequest(`/scripts/${scriptId}/environment`, 'DELETE').catch(e => setMessage(e.message));
                onChanged();
                load();
              }}
              className="h-7 min-h-0 gap-1.5 text-xs">
              <Trash2 size={12} /> Eliminar entorno propio
            </Button>
          )}
        </div>
      </div>

      {/* Dependency list */}
      <div className="space-y-2">
        <div className="font-semibold text-fg">Paquetes que necesita</div>
        {deps.length === 0 ? (
          <p className="text-muted">No declara paquetes. Importa su requirements.txt, agrégalos uno a uno o detéctalos a partir de sus <code className="font-mono">import</code>.</p>
        ) : (
          <div className="rounded-md border border-border divide-y divide-border">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 px-3 py-1.5 text-[11px] text-muted">
              <span>Paquete</span><span>Pide</span><span>Usará</span><span />
            </div>
            {deps.map(d => {
              const name = specName(d);
              const constraint = d.trim().slice(name.length).trim();
              const version = resolved[normalize(name)];
              return (
                <div key={d} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 px-3 py-2 items-center">
                  <span className="font-mono truncate" title={d}>{name}</span>
                  <span className={cn('font-mono truncate', !constraint && 'text-muted font-sans')}>{constraint || 'cualquiera'}</span>
                  <span>
                    {version
                      ? <span className={cn('px-1.5 py-0.5 rounded text-[11px]', where === 'propio' ? 'bg-accent-light text-accent' : 'bg-success/10 text-success')}>{where} {version}</span>
                      : <span className="text-muted">sin instalar</span>}
                  </span>
                  <button type="button" onClick={() => save(deps.filter(x => x !== d))} disabled={saving || busy} className="p-1 rounded text-muted hover:text-danger disabled:opacity-40" title="Quitar">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={spec}
            onChange={e => setSpec(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="pandas  ·  pandas==2.2.3  ·  requests>=2.31"
            className="h-8 min-h-0 text-xs font-mono flex-1"
            disabled={saving}
          />
          <Button variant="default" size="sm" onClick={add} disabled={saving} className="h-8 min-h-0 gap-1.5 text-xs">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Agregar
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={saving} className="h-8 min-h-0 gap-1.5 text-xs">
            <FileUp size={12} /> Importar requirements.txt
          </Button>
          {deps.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input type="checkbox" checked={replaceOnImport} onChange={e => setReplaceOnImport(e.target.checked)} />
              Reemplazar la lista actual
            </label>
          )}
        </div>
        {ignored.length > 0 && (
          <div className="p-2.5 rounded-md border border-warn/40 bg-warn/10 text-[11px] space-y-0.5">
            <div className="font-medium">No se importaron:</div>
            {ignored.map(i => <div key={i.line}><code className="font-mono">{i.line}</code> <span className="text-muted">— {i.reason}</span></div>)}
          </div>
        )}
        <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
          <Info size={12} className="shrink-0 mt-0.5" />
          Sin versión fija usa la que ya esté en el entorno compartido. Con una versión fija que choque con la compartida, el script recibe su propio entorno.
        </p>
      </div>

      {missingImports.length > 0 && (
        <div className="p-3 rounded-md border border-warn/40 bg-warn/10 space-y-2">
          <div>
            El código importa <span className="font-mono">{missingImports.map(i => i.package).join(', ')}</span>, que no está en la lista.
          </div>
          <Button variant="default" size="sm" onClick={() => save([...deps, ...missingImports.map(i => i.package)])} disabled={saving} className="h-7 min-h-0 gap-1.5 text-xs">
            <ScanSearch size={12} /> Agregar a la lista
          </Button>
        </div>
      )}

      {/* Python version: only shown when the script asks for one or the user wants to change it */}
      {info.requiresPython || editingPython ? (
        <div className="space-y-1">
          <div className="font-semibold text-fg">Versión de Python</div>
          <div className="flex items-center gap-2">
            <Input value={python} onChange={e => setPython(e.target.value)} placeholder=">=3.11" className="h-8 min-h-0 text-xs font-mono flex-1" disabled={saving} autoFocus={editingPython} />
            <Button variant="default" size="sm" onClick={async () => { if (await save(deps, python.trim())) setEditingPython(false); }} disabled={saving || python.trim() === (info.requiresPython || '')} className="h-8 min-h-0 text-xs">
              Guardar
            </Button>
            {info.requiresPython ? (
              <Button variant="ghost" size="sm" onClick={async () => { setPython(''); if (await save(deps, '')) setEditingPython(false); }} disabled={saving} className="h-8 min-h-0 text-xs">
                Usar la del entorno base
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => { setPython(''); setEditingPython(false); }} className="h-8 min-h-0 text-xs">Cancelar</Button>
            )}
          </div>
          <p className="text-[11px] text-muted">Una versión distinta de la del entorno base ({info.sharedPythonVersion || '—'}) hace que el script tenga su propio entorno.</p>
        </div>
      ) : (
        <div className="text-[11px] text-muted">
          Python {info.sharedPythonVersion || 'del entorno base'} ·{' '}
          <button type="button" onClick={() => setEditingPython(true)} className="text-accent hover:underline">usar otra versión</button>
        </div>
      )}

      {message && <p className="text-muted whitespace-pre-wrap break-words">{message}</p>}
    </div>
  );
}
