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
import type { Script } from '../../store/scriptSlice';
import { parseArgs } from './parseArgs';

type Stream = 'stdout' | 'stderr' | 'stdin' | 'system';
type RunStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'timeout';

interface Chunk { stream: Stream; text: string; ts: number }
interface RunState { runId: string; status: RunStatus; exitCode: number | null; durationMs: number | null }
interface ScriptContent { content: string; language: string; truncated: boolean; fileName: string }

interface ScriptConsoleModalProps {
  script: Script;
  /** Start a run as soon as the console opens (unless one is already running) */
  autoRun?: boolean;
  onClose: () => void;
  onFinished?: () => void;
}

const STREAM_STYLES: Record<Stream, string> = {
  stdout: 'text-surface/90',
  stderr: 'text-red-400',
  stdin: 'text-sky-300',
  system: 'text-surface/50 italic',
};

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

function StatusBadge({ run }: { run: RunState | null }) {
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

export function ScriptConsoleModal({ script, autoRun = false, onClose, onFinished }: ScriptConsoleModalProps) {
  const [code, setCode] = useState<ScriptContent | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [argsText, setArgsText] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [output, setOutput] = useState<Chunk[]>([]);
  const [inputText, setInputText] = useState('');
  const [ready, setReady] = useState(false);

  const runIdRef = useRef<string | null>(null);
  // Events that arrive while a snapshot of the run is being fetched, merged afterwards by timestamp
  const earlyEventsRef = useRef<Array<Chunk & { runId: string }> | null>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const running = run?.status === 'running';
  const append = (chunk: Chunk) => setOutput(prev => [...prev, chunk]);

  const start = useCallback(async () => {
    const runId = uuidv4();
    runIdRef.current = runId;
    stickToBottomRef.current = true;
    setOutput([]);
    setRun({ runId, status: 'running', exitCode: null, durationMs: null });
    try {
      await request(`/scripts/${script.id}/runs`, { args: parseArgs(argsText), runId });
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (err: any) {
      append({ stream: 'system', text: `${err.message}\n`, ts: Date.now() });
      setRun({ runId, status: 'error', exitCode: null, durationMs: null });
    }
  }, [script.id, argsText]);

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
      onFinishedRef.current?.();
    });
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    request<ScriptContent>(`/scripts/${script.id}/content`)
      .then(data => { if (!cancelled) setCode(data); })
      .catch(err => { if (!cancelled) setCodeError(err.message); });

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
  }, [script.id]);

  // Auto-run once the latest run is known, so an already running script is reattached instead
  const autoRunDone = useRef(false);
  useEffect(() => {
    if (!ready || !autoRun || autoRunDone.current) return;
    autoRunDone.current = true;
    if (run?.status !== 'running') start();
  }, [ready, autoRun, run, start]);

  useEffect(() => {
    const el = consoleRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [output]);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const extensions = useMemo(() => (code?.language === 'javascript' ? [javascript()] : []), [code?.language]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-6xl h-[85vh] flex flex-col min-h-0">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="p-2 bg-accent-light rounded-sm text-accent shrink-0"><Code size={16} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate">{script.name}</h2>
            <div className="text-[11px] text-muted font-mono truncate">{code?.fileName || script.file_path}</div>
          </div>
          <StatusBadge run={run} />
          <Button variant="icon" size="icon" onClick={() => setShowCode(v => !v)} title={showCode ? 'Ocultar código' : 'Mostrar código'}>
            {showCode ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </Button>
          <Button variant="icon" size="icon" onClick={onClose} title="Cerrar (Esc)"><X size={16} /></Button>
        </div>

        <div className={cn('flex-1 min-h-0 grid grid-cols-1', showCode && 'md:grid-cols-2')}>
          {/* Source code */}
          {showCode && (
            <div className="min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-border">
              <div className="px-4 py-2 text-[11px] text-muted border-b border-border flex items-center justify-between">
                <span>Código (solo lectura)</span>
                {code?.truncated && <span className="text-warn">Mostrando el primer MB</span>}
              </div>
              <div className="flex-1 min-h-0 overflow-auto text-xs">
                {codeError ? (
                  <div className="p-4 text-xs text-danger">{codeError}</div>
                ) : !code ? (
                  <div className="p-4 text-xs text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Cargando código…</div>
                ) : (
                  <CodeMirror value={code.content} extensions={extensions} editable={false} readOnly theme="light" basicSetup={{ foldGutter: false, highlightActiveLine: false }} />
                )}
              </div>
            </div>
          )}

          {/* Console */}
          <div className="min-h-0 flex flex-col">
            <div className="p-3 border-b border-border flex items-center gap-2">
              <Input
                value={argsText}
                onChange={e => setArgsText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !running) start(); }}
                placeholder='Argumentos, p. ej.: 10 "C:\Mis datos\entrada.csv"'
                className="h-8 min-h-0 text-xs font-mono flex-1"
                disabled={running}
              />
              {running ? (
                <Button variant="default" size="sm" onClick={stop} className="h-8 min-h-0 gap-1.5 text-xs text-danger">
                  <Square size={12} /> Detener
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={start} className="h-8 min-h-0 gap-1.5 text-xs" disabled={!ready}>
                  <Play size={12} /> {run ? 'Ejecutar de nuevo' : 'Ejecutar'}
                </Button>
              )}
              <Button variant="icon" size="icon" onClick={() => setOutput([])} title="Limpiar consola"><Eraser size={14} /></Button>
            </div>

            <div
              ref={consoleRef}
              onScroll={e => {
                const el = e.currentTarget;
                stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              onClick={() => { if (running && !window.getSelection()?.toString()) inputRef.current?.focus(); }}
              className="flex-1 min-h-0 overflow-auto bg-fg p-3 font-mono text-xs leading-relaxed"
            >
              {output.length === 0 ? (
                <div className="text-surface/40">
                  {running ? 'Esperando salida…' : 'Pulsa «Ejecutar» para iniciar el script. Lo que imprima aparecerá aquí en vivo.'}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">
                  {output.map((c, i) => (
                    <span key={i} className={STREAM_STYLES[c.stream]}>{c.stream === 'stdin' ? `› ${c.text}` : c.text}</span>
                  ))}
                </pre>
              )}
            </div>

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
