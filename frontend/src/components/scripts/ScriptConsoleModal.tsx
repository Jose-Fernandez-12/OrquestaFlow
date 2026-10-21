import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import {
  X, Play, Square, Send, Loader2, CheckCircle2, AlertCircle, Code, PanelLeftClose, PanelLeftOpen, Eraser, CornerDownLeft,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { getApiUrl, SOCKET_URL } from '../../lib/api';
import type { Script, ScriptEnvView } from '../../store/scriptSlice';
import { parseArgs } from './parseArgs';
import { ConsoleOutput, type ConsoleStream } from '../ui/ConsoleOutput';
import { ScriptDependenciesTab } from './ScriptDependenciesTab';
import { ScriptHistoryTab } from './ScriptHistoryTab';
import { ENV_VIEW } from './envLabels';
import { apiRequest, followEnvJob, type EnvJob } from './pythonEnvApi';

type RunStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'timeout';
type LeftTab = 'code' | 'deps' | 'history';

interface Chunk { stream: ConsoleStream; text: string; ts: number }
interface RunState { runId: string; status: RunStatus; exitCode: number | null; durationMs: number | null }
interface ScriptContent { content: string; language: string; truncated: boolean; fileName: string }

interface ScriptConsoleModalProps {
  script: Script;
  /** Start a run as soon as the console opens (unless one is already running) */
  autoRun?: boolean;
  /** Tab shown first on the left */
  initialTab?: LeftTab;
  onClose: () => void;
  /** A run ended or the dependencies/environment changed: the cards refresh */
  onFinished?: () => void;
  onOpenBaseEnv: () => void;
}

async function request<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(getApiUrl(path), body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || `Error ${res.status}`);
  return json.data;
}

function StatusBadge({ run, preparing }: { run: RunState | null; preparing: boolean }) {
  if (preparing) return <span className="flex items-center gap-1.5 text-xs font-medium text-accent"><Loader2 size={12} className="animate-spin" />Preparando entorno</span>;
  if (!run) return <span className="text-xs text-muted">Sin ejecutar</span>;
  const seconds = run.durationMs != null ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : '';
  const variants: Record<RunStatus, { icon: React.ReactNode; label: string; className: string }> = {
    running: { icon: <Loader2 size={12} className="animate-spin" />, label: 'En ejecución', className: 'text-accent' },
    completed: { icon: <CheckCircle2 size={12} />, label: `Completado${seconds}`, className: 'text-success' },
    error: { icon: <AlertCircle size={12} />, label: `Error${run.exitCode != null ? ` (código ${run.exitCode})` : ''}${seconds}`, className: 'text-danger' },
    cancelled: { icon: <Square size={12} />, label: `Detenido${seconds}`, className: 'text-muted' },
    timeout: { icon: <AlertCircle size={12} />, label: 'Tiempo agotado', className: 'text-danger' },
  };
  const v = variants[run.status];
  return <span className={cn('flex items-center gap-1.5 text-xs font-medium', v.className)}>{v.icon}{v.label}</span>;
}

export function ScriptConsoleModal({ script, autoRun = false, initialTab = 'code', onClose, onFinished, onOpenBaseEnv }: ScriptConsoleModalProps) {
  const isPython = /\.py$/i.test(script.file_path);
  const [code, setCode] = useState<ScriptContent | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  const [leftTab, setLeftTab] = useState<LeftTab>(isPython ? initialTab : initialTab === 'deps' ? 'code' : initialTab);
  const [argsText, setArgsText] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [output, setOutput] = useState<Chunk[]>([]);
  const [inputText, setInputText] = useState('');
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [envView, setEnvView] = useState<ScriptEnvView | null>(script.env?.view ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [codeKey, setCodeKey] = useState(0);

  const runIdRef = useRef<string | null>(null);
  // Events that arrive while a snapshot of the run is being fetched, merged afterwards by timestamp
  const earlyEventsRef = useRef<Array<Chunk & { runId: string }> | null>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const running = run?.status === 'running';
  const busy = running || preparing;
  const append = (chunk: Chunk) => setOutput(prev => [...prev, chunk]);

  const refreshEnv = useCallback(async () => {
    if (!isPython) return;
    try {
      const info = await apiRequest<{ view: ScriptEnvView } | null>(`/scripts/${script.id}/requirements`);
      setEnvView(info?.view ?? null);
    } catch { /* keep the last known state */ }
  }, [isPython, script.id]);

  const changed = useCallback(() => {
    setRefreshKey(k => k + 1);
    refreshEnv();
    onFinishedRef.current?.();
  }, [refreshEnv]);

  /** Installs the script's dependencies, showing uv's output in the console. Returns whether it worked. */
  const prepare = useCallback(async (): Promise<boolean> => {
    setPreparing(true);
    runIdRef.current = null;
    setRun(null);
    setOutput([]);
    try {
      const job = await followEnvJob(() => apiRequest<EnvJob>(`/scripts/${script.id}/environment`, 'POST'), chunks => setOutput(chunks.map(c => ({ ...c, ts: c.ts ?? Date.now() }))));
      return job.status === 'completed';
    } catch (err: any) {
      append({ stream: 'system', text: `${err.message}\n`, ts: Date.now() });
      return false;
    } finally {
      setPreparing(false);
      changed();
    }
  }, [script.id, changed]);

  const start = useCallback(async () => {
    // Dependencies not installed yet (or changed): prepare first, then run in the same console
    let keepOutput = false;
    if (isPython && envView === 'pendiente') {
      if (!(await prepare())) return;
      keepOutput = true;
    }
    const runId = uuidv4();
    runIdRef.current = runId;
    if (keepOutput) append({ stream: 'system', text: '\n──────── Ejecución ────────\n', ts: Date.now() });
    else setOutput([]);
    setRun({ runId, status: 'running', exitCode: null, durationMs: null });
    try {
      await request(`/scripts/${script.id}/runs`, { args: parseArgs(argsText), runId });
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (err: any) {
      append({ stream: 'system', text: `${err.message}\n`, ts: Date.now() });
      setRun({ runId, status: 'error', exitCode: null, durationMs: null });
    }
  }, [script.id, argsText, isPython, envView, prepare]);

  // Socket first, so nothing printed between the snapshot and the subscription is lost
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socket.on('script-output', (data: Chunk & { runId: string }) => {
      if (data.runId !== runIdRef.current) {
        earlyEventsRef.current?.push(data);
        return;
      }
      append({ stream: data.stream, text: data.text, ts: data.ts });
    });
    socket.on('script-exit', (data: { runId: string; status: RunStatus; exitCode: number | null; durationMs: number }) => {
      if (data.runId !== runIdRef.current) return;
      setRun({ runId: data.runId, status: data.status, exitCode: data.exitCode, durationMs: data.durationMs });
      setRefreshKey(k => k + 1);
      onFinishedRef.current?.();
    });
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    request<ScriptContent>(`/scripts/${script.id}/content`)
      .then(data => { if (!cancelled) { setCode(data); setCodeError(null); } })
      .catch(err => { if (!cancelled) setCodeError(err.message); });
    return () => { cancelled = true; };
  }, [script.id, codeKey]);

  useEffect(() => {
    let cancelled = false;
    refreshEnv();
    request<any>(`/scripts/${script.id}/runs/latest`)
      .then(latest => {
        if (cancelled) return;
        if (latest) {
          runIdRef.current = latest.runId;
          const lastTs = latest.output.length ? latest.output[latest.output.length - 1].ts : 0;
          const missed = (earlyEventsRef.current || []).filter(e => e.runId === latest.runId && e.ts > lastTs);
          setOutput([...latest.output, ...missed]);
          setArgsText(latest.args.map((a: string) => (/\s|^$/.test(a) ? `"${a}"` : a)).join(' '));
          setRun({
            runId: latest.runId,
            status: latest.status,
            exitCode: latest.exitCode,
            durationMs: latest.finishedAt ? latest.finishedAt - latest.startedAt : null,
          });
        }
        earlyEventsRef.current = null;
        setReady(true);
      })
      .catch(() => { earlyEventsRef.current = null; setReady(true); });
    return () => { cancelled = true; };
  }, [script.id, refreshEnv]);

  // Auto-run once the latest run is known, so an already running script is reattached instead
  const autoRunDone = useRef(false);
  useEffect(() => {
    if (!ready || !autoRun || autoRunDone.current) return;
    autoRunDone.current = true;
    if (run?.status !== 'running') start();
  }, [ready, autoRun, run, start]);

  const sendInput = async (eof = false) => {
    if (!run || !running) return;
    const text = inputText;
    setInputText('');
    try {
      await request(`/scripts/runs/${run.runId}/input`, { text, eof });
    } catch (err: any) {
      append({ stream: 'system', text: `${err.message}\n`, ts: Date.now() });
    }
  };

  const stop = async () => {
    if (run) await request(`/scripts/runs/${run.runId}/stop`, {}).catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !preparing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, preparing]);

  const extensions = useMemo(() => (code?.language === 'javascript' ? [javascript()] : []), [code?.language]);
  const tabs: Array<{ id: LeftTab; label: string }> = [
    { id: 'code', label: 'Código' },
    ...(isPython ? [{ id: 'deps' as const, label: 'Dependencias' }] : []),
    { id: 'history', label: 'Historial' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget && !preparing) onClose(); }}>
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-6xl h-[85vh] flex flex-col min-h-0">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="p-2 bg-accent-light rounded-sm text-accent shrink-0"><Code size={16} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate">{script.name}</h2>
            <div className="text-[11px] text-muted font-mono truncate">{code?.fileName || script.file_path}</div>
          </div>
          {isPython && envView && (
            <button type="button" onClick={() => { setShowLeft(true); setLeftTab('deps'); }} className={cn('px-2 py-0.5 rounded text-[11px] font-medium', ENV_VIEW[envView].className)} title={ENV_VIEW[envView].hint}>
              {ENV_VIEW[envView].label}
            </button>
          )}
          <StatusBadge run={run} preparing={preparing} />
          <Button variant="icon" size="icon" onClick={() => setShowLeft(v => !v)} title={showLeft ? 'Ocultar panel' : 'Mostrar panel'}>
            {showLeft ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </Button>
          <Button variant="icon" size="icon" onClick={onClose} title="Cerrar (Esc)" disabled={preparing}><X size={16} /></Button>
        </div>

        <div className={cn('flex-1 min-h-0 grid grid-cols-1', showLeft && 'md:grid-cols-2')}>
          {/* Left: code, dependencies, history */}
          {showLeft && (
            <div className="min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-border">
              <div className="px-4 flex items-center gap-4 border-b border-border shrink-0">
                {tabs.map(t => (
                  <button key={t.id} type="button" onClick={() => setLeftTab(t.id)}
                    className={cn('py-2 text-xs border-b-2 -mb-px transition-colors', leftTab === t.id ? 'border-accent text-accent font-semibold' : 'border-transparent text-muted hover:text-fg')}>
                    {t.label}
                  </button>
                ))}
                {leftTab === 'code' && code?.truncated && <span className="ml-auto text-[11px] text-warn">Mostrando el primer MB</span>}
                {leftTab === 'code' && !code?.truncated && <span className="ml-auto text-[11px] text-muted">Solo lectura</span>}
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {leftTab === 'code' && (
                  codeError ? (
                    <div className="p-4 text-xs text-danger">{codeError}</div>
                  ) : !code ? (
                    <div className="p-4 text-xs text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Cargando código…</div>
                  ) : (
                    <div className="text-xs">
                      <CodeMirror value={code.content} extensions={extensions} editable={false} readOnly theme="light" basicSetup={{ foldGutter: false, highlightActiveLine: false }} />
                    </div>
                  )
                )}
                {leftTab === 'deps' && isPython && (
                  <ScriptDependenciesTab
                    scriptId={script.id}
                    refreshKey={refreshKey}
                    busy={busy}
                    onPrepare={async () => { await prepare(); }}
                    onChanged={() => { setCodeKey(k => k + 1); changed(); }}
                    onOpenBaseEnv={onOpenBaseEnv}
                  />
                )}
                {leftTab === 'history' && <ScriptHistoryTab scriptId={script.id} refreshKey={refreshKey} />}
              </div>
            </div>
          )}

          {/* Console */}
          <div className="min-h-0 flex flex-col">
            <div className="p-3 border-b border-border flex items-center gap-2">
              <Input
                value={argsText}
                onChange={e => setArgsText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !busy) start(); }}
                placeholder='Argumentos, p. ej.: 10 "C:\Mis datos\entrada.csv"'
                className="h-8 min-h-0 text-xs font-mono flex-1"
                disabled={busy}
              />
              {running ? (
                <Button variant="default" size="sm" onClick={stop} className="h-8 min-h-0 gap-1.5 text-xs text-danger">
                  <Square size={12} /> Detener
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={start} className="h-8 min-h-0 gap-1.5 text-xs" disabled={!ready || preparing}>
                  {preparing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {run ? 'Ejecutar de nuevo' : 'Ejecutar'}
                </Button>
              )}
              <Button variant="icon" size="icon" onClick={() => setOutput([])} title="Limpiar consola" disabled={preparing}><Eraser size={14} /></Button>
            </div>

            <ConsoleOutput
              chunks={output}
              emptyText={running ? 'Esperando salida…' : 'Pulsa «Ejecutar» para iniciar el script. Lo que imprima aparecerá aquí en vivo.'}
              onClick={() => { if (running && !window.getSelection()?.toString()) inputRef.current?.focus(); }}
              className="flex-1 min-h-0"
            />

            {/* stdin */}
            <div className="p-3 border-t border-border flex items-center gap-2">
              <Input
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); sendInput(false); }
                  else if (e.key === 'd' && e.ctrlKey) { e.preventDefault(); sendInput(true); }
                }}
                placeholder={running ? 'Escribe la respuesta y pulsa Enter (Ctrl+D = fin de la entrada)' : 'La entrada se habilita mientras el script se ejecuta'}
                className="h-8 min-h-0 text-xs font-mono flex-1"
                disabled={!running}
              />
              <Button variant="default" size="sm" onClick={() => sendInput(false)} disabled={!running} className="h-8 min-h-0 gap-1.5 text-xs" title="Enviar línea (Enter)">
                <Send size={12} /> Enviar
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendInput(true)} disabled={!running} className="h-8 min-h-0 gap-1.5 text-xs" title="Enviar y cerrar la entrada (Ctrl+D)">
                <CornerDownLeft size={12} /> EOF
              </Button>
            </div>
            {running && (
              <div className="px-3 pb-2 -mt-1 text-[10px] text-muted">
                Si cierras esta ventana el script sigue ejecutándose; al volver a abrirla verás su salida.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
