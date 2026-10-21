import { useEffect, useState } from 'react';
import { Terminal, Settings2, Wrench, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { envRequest, type PythonEnvState } from './pythonEnvApi';

interface EnvBaseBarProps {
  refreshKey: number;
  onManage: (startSetup: boolean) => void;
}

/** One line at the top of Scripts: is Python ready, how many shared packages and own environments */
export function EnvBaseBar({ refreshKey, onManage }: EnvBaseBarProps) {
  const [env, setEnv] = useState<PythonEnvState | null>(null);

  useEffect(() => {
    envRequest<PythonEnvState>('/').then(setEnv).catch(() => setEnv(null));
  }, [refreshKey]);

  if (!env) return null;
  const ready = Boolean(env.uv && env.venv);

  if (!ready) {
    return (
      <div className="mb-6 shrink-0 flex flex-wrap items-center gap-3 px-4 py-3 rounded-md border border-warn/40 bg-warn/10 text-sm">
        <AlertTriangle size={16} className="text-warn shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="font-medium">Python aún no está preparado.</span>{' '}
          <span className="text-muted text-xs">Se hace una sola vez: OrquestaFlow descarga uv y Python {env.pythonVersion} en su carpeta, sin instalar nada en el sistema.</span>
        </span>
        <Button variant="primary" size="sm" onClick={() => onManage(true)} className="h-8 min-h-0 gap-1.5 text-xs">
          <Wrench size={12} /> Preparar entorno base
        </Button>
      </div>
    );
  }

  const shared = env.packages.filter(p => p.usedBy.length > 0 || env.requirements.some(r => r.name === p.name.toLowerCase().replace(/[-_.]+/g, '-'))).length;
  return (
    <div className="mb-6 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 rounded-md border border-border bg-surface text-sm">
      <Terminal size={16} className="text-accent shrink-0" />
      <span><span className="font-medium">Entorno base</span> <span className="text-muted">· Python {env.venv!.version} · uv {env.uv!.version}</span></span>
      <span className="text-xs text-muted">{shared} paquete(s) compartidos · {env.ownEnvironments} entorno(s) propios</span>
      <span className="flex-1" />
      <Button variant="outline" size="sm" onClick={() => onManage(false)} className="h-8 min-h-0 gap-1.5 text-xs">
        <Settings2 size={12} /> Gestionar
      </Button>
    </div>
  );
}
