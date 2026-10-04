import { useCallback, useEffect, useState } from 'react';
import { Package, Check, AlertTriangle, HelpCircle, Loader2, Copy, Plus, Settings } from 'lucide-react';
import { getApiUrl } from '../../lib/api';
import { cn } from '../../lib/utils';
import { envRequest, followEnvJob, type EnvJob } from '../settings/pythonEnvApi';

type Mode = 'aislado' | 'manual' | 'compartido' | 'sistema' | 'no-preparado' | 'invalido';

interface ScriptRequirements {
  mode: Mode;
  metadata: { dependencies: string[]; requiresPython?: string } | null;
  metadataError: string | null;
  imports: Array<{ module: string; package: string; covered: boolean | null }>;
  environmentReady: boolean;
}

const MODE_LABEL: Record<Mode, { label: string; className: string; title: string }> = {
  aislado: { label: 'Entorno aislado (PEP 723)', className: 'bg-accent-light text-accent', title: 'Declara sus dependencias en la cabecera: uv le arma un entorno propio' },
  compartido: { label: 'Entorno compartido', className: 'bg-success/10 text-success', title: 'Usa los paquetes de python-requirements.txt' },
  manual: { label: 'PYTHON_PATH', className: 'bg-bg text-fg', title: 'El servidor usa el intérprete indicado en PYTHON_PATH' },
  sistema: { label: 'Python del sistema', className: 'bg-warn/15 text-fg', title: 'No hay entorno preparado: se usa el Python instalado en el servidor' },
  'no-preparado': { label: 'Python no preparado', className: 'bg-danger/10 text-danger', title: 'Prepara el entorno en Configuración → Entorno Python' },
  invalido: { label: 'Cabecera inválida', className: 'bg-danger/10 text-danger', title: 'El bloque # /// script no es válido' },
};

function pep723Header(packages: string[]): string {
  return ['# /// script', `# dependencies = [${packages.map(p => `"${p}"`).join(', ')}]`, '# ///', ''].join('\n');
}

/** What a Python script needs and whether the environment that will run it has it */
export function ScriptDependencies({ scriptId, refreshKey, onOpenSettings }: { scriptId: string; refreshKey: number; onOpenSettings: () => void }) {
  const [info, setInfo] = useState<ScriptRequirements | null | undefined>(undefined);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl(`/scripts/${scriptId}/requirements`));
      const json = await res.json();
      setInfo(res.ok ? json.data : null);
    } catch {
      setInfo(null);
    }
  }, [scriptId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // undefined = loading, null = .js script or unavailable: nothing to show
  if (!info) return null;

  const mode = MODE_LABEL[info.mode];
  const missing = info.imports.filter(i => i.covered === false);
  const thirdParty = info.imports.map(i => i.package);

  const install = async (pkg: string) => {
    setInstalling(pkg);
    setMessage(null);
    try {
      const job = await followEnvJob(() => envRequest<EnvJob>('/packages', 'POST', { spec: pkg }), () => {});
      setMessage(job.status === 'completed' ? `«${pkg}» instalado en el entorno compartido.` : `No se pudo instalar «${pkg}»: ${job.error || 'revisa Configuración → Entorno Python'}`);
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setInstalling(null);
      load();
    }
  };

  const copyHeader = async () => {
    const deps = info.metadata?.dependencies.length ? [...new Set([...info.metadata.dependencies, ...missing.map(m => m.package)])] : thirdParty;
    try {
      await navigator.clipboard.writeText(pep723Header(deps));
      setMessage('Cabecera copiada: pégala al inicio del script para que corra en su propio entorno.');
    } catch {
      setMessage(pep723Header(deps));
    }
  };

  return (
    <div className="px-4 py-2 border-b border-border text-[11px] space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Package size={12} className="text-muted" />
        <span className={cn('px-1.5 py-0.5 rounded font-medium', mode.className)} title={mode.title}>{mode.label}</span>
        {info.metadata?.requiresPython && <span className="text-muted font-mono">python {info.metadata.requiresPython}</span>}
        {info.metadata?.dependencies.map(d => (
          <span key={d} className="px-1.5 py-0.5 rounded border border-border font-mono">{d}</span>
        ))}
        {info.imports.filter(i => !info.metadata || i.covered !== true).map(i => (
          <span
            key={i.module}
            className={cn('px-1.5 py-0.5 rounded border font-mono flex items-center gap-1', i.covered === false ? 'border-warn text-fg' : 'border-border')}
            title={i.covered === null ? 'No se puede comprobar con el Python del sistema' : i.module !== i.package ? `import ${i.module} → paquete ${i.package}` : undefined}
          >
            {i.covered === true && <Check size={10} className="text-success" />}
            {i.covered === false && <AlertTriangle size={10} className="text-warn" />}
            {i.covered === null && <HelpCircle size={10} className="text-muted" />}
            {i.package}
          </span>
        ))}
        {info.imports.length === 0 && !info.metadata && <span className="text-muted">Sin paquetes externos</span>}
      </div>

      {info.metadataError && <div className="text-danger">{info.metadataError}</div>}

      {missing.length > 0 && info.mode === 'compartido' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted">Faltan en el entorno compartido:</span>
          {missing.map(m => (
            <button key={m.package} type="button" onClick={() => install(m.package)} disabled={!!installing}
              className="px-1.5 py-0.5 rounded border border-border hover:border-accent hover:text-accent flex items-center gap-1 disabled:opacity-50">
              {installing === m.package ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Instalar {m.package}
            </button>
          ))}
          <button type="button" onClick={copyHeader} className="px-1.5 py-0.5 rounded border border-border hover:border-accent hover:text-accent flex items-center gap-1">
            <Copy size={10} /> Copiar cabecera PEP 723
          </button>
        </div>
      )}
      {missing.length > 0 && info.mode === 'aislado' && (
        <div className="text-warn">
          Importa {missing.map(m => m.package).join(', ')} pero no lo declara en «dependencies».{' '}
          <button type="button" onClick={copyHeader} className="underline">Copiar cabecera corregida</button>
        </div>
      )}
      {(info.mode === 'no-preparado' || (info.mode === 'sistema' && !info.environmentReady)) && (
        <button type="button" onClick={onOpenSettings} className="flex items-center gap-1 text-accent hover:underline">
          <Settings size={11} /> Preparar el entorno Python
        </button>
      )}
      {message && <div className="text-muted break-words whitespace-pre-wrap">{message}</div>}
    </div>
  );
}
