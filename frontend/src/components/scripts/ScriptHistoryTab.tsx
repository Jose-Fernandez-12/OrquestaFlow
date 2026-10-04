import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Square, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiRequest } from './pythonEnvApi';

interface ScriptLog {
  id: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  trigger_type: string | null;
  schedule_id: string | null;
  duration_ms: number | null;
  error_message: string | null;
  result: string | null;
  started_at: string;
}

const TRIGGER: Record<string, string> = { manual: 'Consola', api: 'API', schedule: 'Programación' };

function parseResult(raw: string | null): { stdout?: string; stderr?: string; args?: string[] } {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

/** Last runs of the script with their output */
export function ScriptHistoryTab({ scriptId, refreshKey }: { scriptId: string; refreshKey: number }) {
  const [logs, setLogs] = useState<ScriptLog[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<ScriptLog[]>(`/scripts/${scriptId}/logs`).then(setLogs).catch(() => setLogs([]));
  }, [scriptId, refreshKey]);

  if (!logs) return <div className="p-4 text-xs text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Cargando historial…</div>;
  if (logs.length === 0) return <div className="p-4 text-xs text-muted">Todavía no se ha ejecutado.</div>;

  return (
    <div className="divide-y divide-border text-xs">
      {logs.map(log => {
        const result = parseResult(log.result);
        const isOpen = open === log.id;
        const icon = log.status === 'completed' ? <CheckCircle2 size={13} className="text-success" />
          : log.status === 'running' ? <Loader2 size={13} className="animate-spin text-accent" />
          : log.status === 'cancelled' ? <Square size={13} className="text-muted" />
          : <AlertCircle size={13} className="text-danger" />;
        return (
          <div key={log.id}>
            <button type="button" onClick={() => setOpen(isOpen ? null : log.id)} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-bg text-left">
              <ChevronRight size={12} className={cn('text-muted transition-transform', isOpen && 'rotate-90')} />
              {icon}
              <span className="tabular-nums">{new Date(log.started_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>
              <span className="text-muted">{TRIGGER[log.trigger_type || ''] || (log.schedule_id ? 'Programación' : 'Ejecución')}</span>
              {result.args && result.args.length > 0 && <span className="font-mono text-muted truncate">{result.args.join(' ')}</span>}
              <span className="ml-auto text-muted tabular-nums">{log.duration_ms != null ? `${(log.duration_ms / 1000).toFixed(1)} s` : ''}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-3 space-y-2">
                {log.error_message && <div className="text-danger">{log.error_message}</div>}
                {result.stdout && <pre className="bg-fg text-surface/90 rounded p-2 font-mono text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto">{result.stdout}</pre>}
                {result.stderr && <pre className="bg-fg text-red-400 rounded p-2 font-mono text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto">{result.stderr}</pre>}
                {!result.stdout && !result.stderr && !log.error_message && <div className="text-muted">Sin salida.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
