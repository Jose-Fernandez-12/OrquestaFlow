import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, Package, Loader2, CheckCircle2, AlertTriangle, RotateCw, Trash2, Plus, Wrench, X } from 'lucide-react';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConsoleOutput, type ConsoleChunk } from '../ui/ConsoleOutput';
import { envRequest, followEnvJob, type EnvJob, type PythonEnvState } from './pythonEnvApi';

function StatusCard({ label, value, detail, ok }: { label: string; value: string; detail?: string; ok: boolean }) {
  return (
    <div className="p-3 bg-surface rounded-md border border-border min-w-0">
      <div className="text-[11px] text-muted flex items-center gap-1.5">
        {ok ? <CheckCircle2 size={12} className="text-success" /> : <AlertTriangle size={12} className="text-warn" />}
        {label}
      </div>
      <div className="text-sm font-semibold mt-1 truncate">{value}</div>
      {detail && <div className="text-[11px] text-muted truncate" title={detail}>{detail}</div>}
    </div>
  );
}

interface PythonEnvPanelProps {
  /** Start the base setup as soon as the panel opens (from the «Preparar entorno base» button) */
  startSetup?: boolean;
  onClose: () => void;
  /** Something changed (setup, packages): the Scripts view refreshes its cards */
  onChanged: () => void;
}

/** Base environment: uv, the shared venv, its packages and which scripts use each one */
export function PythonEnvPanel({ startSetup = false, onClose, onChanged }: PythonEnvPanelProps) {
  const dispatch = useAppDispatch();
  const [env, setEnv] = useState<PythonEnvState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ConsoleChunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);
  const attached = useRef(false);

  const load = useCallback(async (refresh = false) => {
    try {
      setEnv(await envRequest<PythonEnvState>(refresh ? '/?refresh=1' : '/'));
      setError(null);
    } catch (err: any) {
      setError(err.message || 'No se pudo consultar el servidor');
    }
  }, []);

  const follow = useCallback(async (start: () => Promise<EnvJob>, doneMessage: string) => {
    setBusy(true);
    try {
      const job = await followEnvJob(start, setOutput);
      dispatch(showToast(job.status === 'completed' ? doneMessage : `Falló: ${job.error || 'revisa la consola'}`));
    } catch (err: any) {
      dispatch(showToast(err.message));
    } finally {
      setBusy(false);
      load();
      onChanged();
    }
  }, [dispatch, load, onChanged]);

  useEffect(() => { load(); }, [load]);

  // An operation started elsewhere keeps streaming here when the panel is opened
  useEffect(() => {
    if (!env?.activeJob || attached.current || busy) return;
    attached.current = true;
    const job = env.activeJob;
    follow(async () => job, 'Operación terminada');
  }, [env, busy, follow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const setup = useCallback(() => follow(() => envRequest<EnvJob>('/setup', 'POST'), 'Entorno base listo'), [follow]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!startSetup || autoStarted.current || !env || env.activeJob) return;
    autoStarted.current = true;
    if (!env.uv || !env.venv) setup();
  }, [startSetup, env, setup]);

  const add = () => {
    const clean = spec.trim();
    if (!clean) { setSpecError('Escribe el nombre del paquete, p. ej. pandas==2.2.3'); return; }
    if (clean.startsWith('-')) { setSpecError('Solo paquetes, no opciones de pip.'); return; }
    setSpec('');
    follow(() => envRequest<EnvJob>('/packages', 'POST', { spec: clean }), `«${clean}» instalado`);
  };

  const remove = (name: string, usedBy: string[]) => {
    const warning = usedBy.length
      ? `Lo usan: ${usedBy.join(', ')}. Esos scripts quedarán como «Falta preparar» y lo volverán a instalar al ejecutarlos.\n\n`
      : '';
    if (!window.confirm(`${warning}¿Quitar «${name}» del entorno compartido?`)) return;
    follow(() => envRequest<EnvJob>(`/packages/${encodeURIComponent(name)}`, 'DELETE'), `«${name}» quitado`);
  };

  const ready = Boolean(env?.uv && env?.venv && env.pendingSteps.length === 0);
  const base = new Map((env?.requirements || []).map(r => [r.name, r]));
  const normalize = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');
  const installed = new Set((env?.packages || []).map(p => normalize(p.name)));
  const pendingBase = (env?.requirements || []).filter(r => !installed.has(r.name));
  // Dependencies of other packages (numpy for pandas…) are listed apart to keep the list readable
  const direct = (env?.packages || []).filter(p => p.usedBy.length > 0 || base.has(normalize(p.name)));
  const indirect = (env?.packages || []).filter(p => p.usedBy.length === 0 && !base.has(normalize(p.name)));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-3xl max-h-[88vh] flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="p-2 bg-accent-light rounded-sm text-accent shrink-0"><Terminal size={16} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Entorno base de Python</h2>
            <p className="text-[11px] text-muted">Lo comparten todos los scripts; uno tiene entorno propio solo si necesita versiones distintas.</p>
          </div>
          <button type="button" onClick={() => load(true)} className="p-1.5 rounded text-muted hover:text-fg hover:bg-bg" title="Volver a comprobar"><RotateCw size={14} /></button>
          <Button variant="icon" size="icon" onClick={onClose} title="Cerrar (Esc)" disabled={busy}><X size={16} /></Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {error && <div className="text-xs text-danger">{error}</div>}

          {env && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <StatusCard label="uv" ok={!!env.uv} value={env.uv ? `uv ${env.uv.version}` : 'No instalado'} detail={env.uv ? (env.uv.managed ? 'Gestionado por OrquestaFlow' : 'Del sistema (PATH)') : `Se descargará uv ${env.uvVersion}`} />
              <StatusCard label="Entorno compartido" ok={!!env.venv} value={env.venv ? `Python ${env.venv.version}` : 'No creado'} detail={env.venv ? `${env.ownEnvironments} script(s) con entorno propio` : `Se creará con Python ${env.pythonVersion}`} />
              <StatusCard label="Python del sistema" ok={!!env.system} value={env.system ? `Python ${env.system.version}` : 'No encontrado'} detail={env.system ? 'Solo se usa si no hay entorno' : 'No hace falta'} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" size="sm" onClick={setup} disabled={busy || !env} className="h-8 min-h-0 gap-1.5 text-xs">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
              {ready ? (pendingBase.length ? 'Instalar paquetes pendientes' : 'Comprobar y actualizar') : 'Preparar entorno base'}
            </Button>
            {env && !ready && env.pendingSteps.length > 0 && (
              <span className="text-[11px] text-muted">Pendiente: {env.pendingSteps.map(s => s.label).join(' → ')}</span>
            )}
            {env && <span className="text-[11px] text-muted ml-auto">Python {env.pythonVersion} · se cambia en Configuración → General</span>}
          </div>

          {(output.length > 0 || busy) && <ConsoleOutput chunks={output} emptyText="Iniciando…" className="h-44 rounded-md" />}

          <div className="space-y-2">
            <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Package size={14} className="text-accent" /> Paquetes del entorno compartido
            </label>
            {env && direct.length === 0 && pendingBase.length === 0 && (
              <div className="text-xs text-muted">Todavía no hay paquetes. Se añaden al preparar los scripts o desde aquí.</div>
            )}
            {(direct.length > 0 || pendingBase.length > 0) && (
              <div className="bg-surface rounded-md border border-border divide-y divide-border">
                {direct.map(p => (
                  <div key={p.name} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-mono w-40 truncate">{p.name}</span>
                    <span className="font-mono text-muted w-20 shrink-0">{p.version}</span>
                    <span className="flex-1 min-w-0 flex flex-wrap gap-1">
                      {base.has(normalize(p.name)) && <span className="px-1.5 py-0.5 rounded bg-bg border border-border text-[10px]" title="En python-requirements.txt">base</span>}
                      {p.usedBy.map(s => <span key={s} className="px-1.5 py-0.5 rounded bg-accent-light text-accent text-[10px] truncate max-w-[160px]" title={s}>{s}</span>)}
                    </span>
                    <button type="button" onClick={() => remove(p.name, p.usedBy)} disabled={busy} className="p-1 rounded text-muted hover:text-danger disabled:opacity-40" title="Quitar paquete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {pendingBase.map(r => (
                  <div key={r.name} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-mono flex-1 truncate">{r.spec}</span>
                    <span className="text-warn text-[11px]">pendiente de instalar</span>
                  </div>
                ))}
              </div>
            )}
            {indirect.length > 0 && (
              <details className="text-[11px] text-muted">
                <summary className="cursor-pointer select-none">{indirect.length} paquete(s) instalados como dependencia de otros</summary>
                <div className="mt-1 font-mono leading-relaxed">{indirect.map(p => `${p.name} ${p.version}`).join(' · ')}</div>
              </details>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted">
              Paquetes base: se guardan en <code className="font-mono">backend/python-requirements.txt</code> (va en el repositorio) y se instalan
              al preparar el entorno en otra máquina.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={spec}
                onChange={e => { setSpec(e.target.value); setSpecError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder="pandas==2.2.3"
                className="h-8 min-h-0 text-xs font-mono flex-1"
                disabled={busy || !env?.venv}
              />
              <Button type="button" variant="default" size="sm" onClick={add} disabled={busy || !env?.venv} className="h-8 min-h-0 gap-1.5 text-xs">
                <Plus size={12} /> Agregar paquete base
              </Button>
            </div>
            {specError && <p className="text-[11px] text-danger">{specError}</p>}
            {env && !env.venv && <p className="text-[11px] text-muted">Prepara el entorno base antes de agregar paquetes.</p>}
          </div>

          <p className="text-[11px] text-muted leading-relaxed">
            Todo vive en <code className="font-mono break-all">{env?.runtimeDir || 'backend/.runtime'}</code>, sin tocar el sistema. Los paquetes se
            descargan de internet (PyPI) y pueden ejecutar código al instalarse: usa solo paquetes de confianza.
          </p>
        </div>
      </div>
    </div>
  );
}
