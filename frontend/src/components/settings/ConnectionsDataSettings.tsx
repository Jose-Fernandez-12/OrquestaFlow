import { useCallback, useEffect, useState } from 'react';
import { Database, KeyRound, HardDrive, Trash2, Loader2, CheckCircle2, AlertTriangle, RotateCw } from 'lucide-react';
import { getApiUrl } from '../../lib/api';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface CredentialStatus {
  id: string;
  name: string;
  host: string;
  database: string | null;
  source: 'connection' | 'env' | 'missing';
  key: string;
  variables: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const SOURCE_LABEL: Record<CredentialStatus['source'], string> = {
  connection: 'Guardadas en la conexión',
  env: 'Desde backend/.env',
  missing: 'Faltan credenciales',
};

/** Where each SQL Server connection takes its credentials from, and the results saved for partial runs. */
export function ConnectionsDataSettings() {
  const dispatch = useAppDispatch();
  const [credentials, setCredentials] = useState<CredentialStatus[] | null>(null);
  const [cache, setCache] = useState<{ flows: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [credRes, cacheRes] = await Promise.all([
        fetch(getApiUrl('/settings/credentials')),
        fetch(getApiUrl('/settings/run-cache')),
      ]);
      if (!credRes.ok || !cacheRes.ok) throw new Error('El servidor no respondió');
      setCredentials((await credRes.json()).data);
      setCache((await cacheRes.json()).data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'No se pudo consultar el servidor');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clearCache = async () => {
    if (!window.confirm('¿Eliminar los resultados guardados de todos los flujos? Para volver a usar "Desde aquí" o "Ejecutar selección" tendrás que ejecutar cada flujo completo una vez.')) return;
    setClearing(true);
    try {
      const res = await fetch(getApiUrl('/settings/run-cache'), { method: 'DELETE' });
      if (!res.ok) throw new Error(res.statusText);
      dispatch(showToast('Resultados guardados eliminados'));
      await load();
    } catch (err: any) {
      dispatch(showToast(`No se pudieron eliminar: ${err.message}`));
    } finally {
      setClearing(false);
    }
  };

  const missing = credentials?.filter(c => c.source === 'missing') ?? [];

  return (
    <div className="space-y-4">
      {/* Database credentials */}
      <div className="p-3.5 bg-bg rounded-md border border-border space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <KeyRound size={14} className="text-accent" />
              Credenciales de base de datos
            </label>
            <p className="text-[11px] text-muted leading-relaxed">
              Cada conexión SQL Server usa el usuario y la contraseña guardados en ella o, si no tiene, los de{' '}
              <code className="font-mono">backend/.env</code> según su clave de credenciales. Al exportar un flujo nunca se incluyen.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="p-1.5 rounded text-muted hover:text-fg hover:bg-surface transition-colors shrink-0"
            title="Volver a consultar"
          >
            <RotateCw size={13} />
          </button>
        </div>

        <pre className="p-2.5 bg-surface rounded border border-border text-[11px] font-mono text-fg leading-relaxed">
{`# backend/.env  (una pareja por clave; varias conexiones pueden compartirla)
SQLSERVER_USER=usuario
SQLSERVER_PASSWORD=contraseña`}
        </pre>

        {error && <p className="text-[11px] text-rose-600">{error}</p>}
        {!credentials && !error && (
          <p className="text-[11px] text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Consultando conexiones…</p>
        )}
        {credentials && credentials.length === 0 && (
          <p className="text-[11px] text-muted italic">No hay conexiones SQL Server registradas.</p>
        )}
        {credentials && credentials.length > 0 && (
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-left text-[11px]">
              <tbody>
                {credentials.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-b-0 bg-surface align-top">
                    <td className="p-2">
                      <div className="font-semibold text-fg flex items-center gap-1.5">
                        <Database size={12} className="text-muted shrink-0" />
                        {c.name}
                      </div>
                      <div className="text-muted truncate font-mono text-[10px]">{c.database || c.host}</div>
                    </td>
                    <td className="p-2 text-right">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium whitespace-nowrap',
                          c.source === 'missing'
                            ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                            : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                        )}
                      >
                        {c.source === 'missing' ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                        {SOURCE_LABEL[c.source]}
                      </span>
                      {c.variables.length > 0 && (
                        <div className={cn('mt-1 font-mono text-[10px]', c.source === 'missing' ? 'text-rose-600' : 'text-muted')}>
                          {c.source === 'missing' ? 'Define ' : ''}
                          {c.variables.join(' · ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missing.length > 0 && (
          <p className="text-[11px] text-rose-600">
            Los flujos que usen {missing.length === 1 ? 'esa conexión' : 'esas conexiones'} fallarán hasta configurar sus credenciales
            en Conexiones o en <code className="font-mono">backend/.env</code> (reinicia el backend después de editarlo).
          </p>
        )}
      </div>

      {/* Saved results for partial runs */}
      <div className="p-3.5 bg-bg rounded-md border border-border flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
            <HardDrive size={14} className="text-accent" />
            Resultados guardados de ejecuciones
          </label>
          <p className="text-[11px] text-muted leading-relaxed">
            Se guarda el resultado de cada nodo en la última ejecución de cada flujo para que "Probar nodo", "Desde aquí" y
            "Ejecutar selección" no tengan que repetir los pasos anteriores. Pueden incluir tokens o datos de las respuestas.
          </p>
          <p className="text-[11px] font-mono text-fg">
            {cache ? `${cache.flows} ${cache.flows === 1 ? 'flujo' : 'flujos'} · ${formatBytes(cache.bytes)}` : '—'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearCache}
          disabled={clearing || !cache || cache.flows === 0}
          className="h-8 text-xs gap-1.5 shrink-0"
        >
          {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Eliminar
        </Button>
      </div>
    </div>
  );
}
