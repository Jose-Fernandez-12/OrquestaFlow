import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, Package, Loader2, CheckCircle2, AlertTriangle, RotateCw, Trash2, Plus, Wrench } from 'lucide-react';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConsoleOutput, type ConsoleChunk } from '../ui/ConsoleOutput';
import { cn } from '../../lib/utils';
import { envRequest, followEnvJob, type EnvJob, type PythonEnvState } from './pythonEnvApi';

const PYTHON_VERSIONS = ['3.10', '3.11', '3.12', '3.13'];

interface PythonEnvSettingsProps {
  pythonVersion: string;
  savedPythonVersion: string;
  onPythonVersionChange: (version: string) => void;
}

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

/** Managed Python environment: uv, the shared venv and the packages of python-requirements.txt */
export function PythonEnvSettings({ pythonVersion, savedPythonVersion, onPythonVersionChange }: PythonEnvSettingsProps) {
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
    }
  }, [dispatch, load]);

  useEffect(() => { load(); }, [load]);

  // A setup started elsewhere (CLI excluded) keeps streaming here when the tab is reopened
  useEffect(() => {
    if (!env?.activeJob || attached.current || busy) return;
    attached.current = true;
    const job = env.activeJob;
    follow(async () => job, 'Operación terminada');
  }, [env, busy, follow]);

  const setup = () => follow(() => envRequest<EnvJob>('/setup', 'POST'), 'Entorno Python listo');

  const add = () => {
    const clean = spec.trim();
    if (!clean) { setSpecError('Escribe el nombre del paquete, p. ej. pandas==2.2.3'); return; }
    if (clean.startsWith('-')) { setSpecError('Solo paquetes, no opciones de pip.'); return; }
    setSpec('');
    follow(() => envRequest<EnvJob>('/packages', 'POST', { spec: clean }), `«${clean}» instalado`);
  };

  const remove = (name: string) => {
    if (!window.confirm(`¿Quitar «${name}» del entorno compartido y de python-requirements.txt?`)) return;
    follow(() => envRequest<EnvJob>(`/packages/${encodeURIComponent(name)}`, 'DELETE'), `«${name}» quitado`);
  };

  const ready = Boolean(env?.uv && env?.venv && env.pendingSteps.length === 0);
  const pendingPackages = env?.requirements.some(r => !r.installed) ?? false;
  const versionChanged = pythonVersion !== savedPythonVersion;

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-bg rounded-md border border-border space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Terminal size={14} className="text-accent" />
              Entorno Python de los scripts
            </label>
            <p className="text-[11px] text-muted leading-relaxed">
              OrquestaFlow instala su propio Python con <code className="font-mono">uv</code> dentro de{' '}
              <code className="font-mono break-all">{env?.runtimeDir || 'backend/.runtime'}</code>, sin tocar el sistema ni pedir
              permisos de administrador. Los scripts <code className="font-mono">.js</code> no usan este entorno.
            </p>
          </div>
          <button type="button" onClick={() => load(true)} className="p-1.5 rounded text-muted hover:text-fg hover:bg-surface transition-colors shrink-0" title="Volver a comprobar">
            <RotateCw size={13} />
          </button>
        </div>

        {error && <div className="text-xs text-danger">{error}</div>}

        {env && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatusCard label="uv" ok={!!env.uv} value={env.uv ? `uv ${env.uv.version}` : 'No instalado'} detail={env.uv ? (env.uv.managed ? 'Gestionado por OrquestaFlow' : 'Del sistema (PATH)') : `Se descargará uv ${env.uvVersion}`} />
            <StatusCard label="Entorno compartido" ok={!!env.venv} value={env.venv ? `Python ${env.venv.version}` : 'No creado'} detail={env.venv ? 'backend/.runtime/venv' : `Se creará con Python ${env.pythonVersion}`} />
            <StatusCard label="Python del sistema" ok={!!env.system} value={env.system ? `Python ${env.system.version}` : 'No encontrado'} detail={env.system ? 'Solo se usa si no hay entorno' : 'No hace falta'} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={setup} disabled={busy || !env} className="h-8 min-h-0 gap-1.5 text-xs">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
            {ready ? (pendingPackages ? 'Instalar paquetes pendientes' : 'Comprobar y actualizar') : 'Preparar entorno'}
          </Button>
          <label className="text-xs text-muted flex items-center gap-1.5">
            Versión de Python
            <select
              value={pythonVersion}
              onChange={e => onPythonVersionChange(e.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
              disabled={busy}
            >
              {[...new Set([...PYTHON_VERSIONS, pythonVersion])].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {env && !ready && env.pendingSteps.length > 0 && (
            <span className="text-[11px] text-muted">Pendiente: {env.pendingSteps.map(s => s.label).join(' → ')}</span>
          )}
        </div>
        {versionChanged && (
          <p className="text-[11px] text-warn">Guarda la configuración y luego pulsa «Preparar entorno» para recrear el entorno con Python {pythonVersion}.</p>
        )}

        {(output.length > 0 || busy) && (
          <ConsoleOutput chunks={output} emptyText="Iniciando…" className="h-48 rounded-md" />
        )}
      </div>

      <div className="p-3.5 bg-bg rounded-md border border-border space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
            <Package size={14} className="text-accent" />
            Paquetes del entorno compartido
          </label>
          <p className="text-[11px] text-muted leading-relaxed">
            Se guardan en <code className="font-mono">backend/python-requirements.txt</code>, que va en el repositorio: quien lo clone
            obtiene los mismos paquetes al preparar el entorno. Un script también puede declarar los suyos en su cabecera (PEP 723) y
            correr aislado.
          </p>
        </div>

        {env && env.requirements.length === 0 && <div className="text-xs text-muted">Todavía no hay paquetes.</div>}
        {env && env.requirements.length > 0 && (
          <div className="bg-surface rounded-md border border-border divide-y divide-border">
            {env.requirements.map(r => (
              <div key={r.name} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="font-mono flex-1 truncate">{r.spec}</span>
                <span className={cn('text-[11px]', r.installed ? 'text-success' : 'text-warn')}>
                  {r.installed ? `instalado ${r.installed}` : 'pendiente de instalar'}
                </span>
                <button type="button" onClick={() => remove(r.name)} disabled={busy || !env.venv} className="p-1 rounded text-muted hover:text-danger disabled:opacity-40" title="Quitar paquete">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1">
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
              <Plus size={12} /> Agregar
            </Button>
          </div>
          {specError && <p className="text-[11px] text-danger">{specError}</p>}
          {env && !env.venv && <p className="text-[11px] text-muted">Prepara el entorno antes de agregar paquetes.</p>}
        </div>

        <p className="text-[11px] text-muted leading-relaxed">
          Los paquetes se descargan de internet (PyPI) y pueden ejecutar código al instalarse: agrega solo paquetes de confianza.
        </p>
      </div>
    </div>
  );
}
