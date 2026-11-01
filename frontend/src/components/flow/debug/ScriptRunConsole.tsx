import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { SOCKET_URL } from '../../../lib/api';
import { cn } from '../../../lib/utils';
import { ConsoleOutput, type ConsoleChunk } from '../../ui/ConsoleOutput';
import { apiRequest } from '../../scripts/pythonEnvApi';

type RunStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'timeout';

interface ScriptRunConsoleProps {
  /** Run started by the node (flow-progress 'scriptRun'); followed live over Socket.IO */
  runId?: string;
  /** Output of the node result, when the run is no longer in the server's memory */
  result?: { stdout?: string; stderr?: string; exitCode?: number | null; error?: string } | null;
  className?: string;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Ejecutando…',
  completed: 'Terminó',
  error: 'Falló',
  cancelled: 'Detenido',
  timeout: 'Tiempo límite superado',
};

/**
 * Console of an "Ejecutar script" node: live output while the script runs (same events as the
 * Scripts console), then the buffered output; falls back to the stdout/stderr of the node result.
 * Render it with key={runId} so a new run starts from an empty console.
 */
export function ScriptRunConsole({ runId, result, className }: ScriptRunConsoleProps) {
  const [chunks, setChunks] = useState<ConsoleChunk[]>([]);
  const [status, setStatus] = useState<{ status: RunStatus; exitCode: number | null } | null>(null);
  const [known, setKnown] = useState(false);
  const pending = useRef<Array<ConsoleChunk & { ts: number }> | null>([]);

  useEffect(() => {
    if (!runId) return;
    pending.current = [];
    let cancelled = false;

    // Socket first, so nothing printed between the snapshot and the subscription is lost
    const socket = io(SOCKET_URL);
    socket.on('script-output', (data: ConsoleChunk & { runId: string; ts: number }) => {
      if (data.runId !== runId) return;
      if (pending.current) pending.current.push(data);
      else setChunks(prev => [...prev, { stream: data.stream, text: data.text, ts: data.ts }]);
    });
    socket.on('script-exit', (data: { runId: string; status: RunStatus; exitCode: number | null }) => {
      if (data.runId === runId) setStatus({ status: data.status, exitCode: data.exitCode });
    });

    apiRequest<{ status: RunStatus; exitCode: number | null; output: Array<ConsoleChunk & { ts: number }> }>(`/scripts/runs/${runId}`)
      .then(run => {
        if (cancelled) return;
        const lastTs = run.output.length ? run.output[run.output.length - 1].ts : 0;
        const missed = (pending.current || []).filter(c => c.ts > lastTs);
        pending.current = null;
        setChunks([...run.output, ...missed]);
        setStatus(prev => prev ?? { status: run.status, exitCode: run.exitCode });
        setKnown(true);
      })
      .catch(() => {
        // Finished more than 10 minutes ago or the server restarted: the node result has the output
        if (cancelled) return;
        pending.current = null;
        setKnown(false);
      });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [runId]);

  const fallback = useMemo<ConsoleChunk[]>(() => {
    if (!result) return [];
    const out: ConsoleChunk[] = [];
    if (result.stdout) out.push({ stream: 'stdout', text: result.stdout });
    if (result.stderr) out.push({ stream: 'stderr', text: result.stderr });
    if (!result.stdout && !result.stderr && result.error) out.push({ stream: 'stderr', text: result.error });
    return out;
  }, [result]);

  const shown = known ? chunks : chunks.length > 0 ? chunks : fallback;
  const current: { status: RunStatus; exitCode: number | null } | null =
    status ?? (result ? { status: result.error ? 'error' : 'completed', exitCode: result.exitCode ?? null } : null);

  return (
    <div className={cn('flex flex-col min-h-0 rounded-sm border border-border overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-bg border-b border-border text-[11px]">
        <span className="font-medium text-fg">Consola del script</span>
        {current && (
          <span
            className={cn(
              'flex items-center gap-1',
              current.status === 'running' ? 'text-accent' : current.status === 'completed' ? 'text-emerald-600' : 'text-danger'
            )}
          >
            {current.status === 'running' ? <Loader2 size={11} className="animate-spin" />
              : current.status === 'completed' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
            {STATUS_LABEL[current.status]}
            {current.status !== 'running' && current.exitCode !== null && current.exitCode !== undefined && ` · código ${current.exitCode}`}
          </span>
        )}
      </div>
      <ConsoleOutput
        chunks={shown}
        emptyText={runId ? 'Esperando salida del script…' : 'Ejecuta el flujo (o «Probar nodo») para ver aquí lo que imprime el script.'}
        className="flex-1 min-h-[160px]"
      />
    </div>
  );
}
