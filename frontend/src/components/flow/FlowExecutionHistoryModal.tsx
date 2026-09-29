import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  History,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Square,
  ChevronDown,
  Hand,
  Bug,
  CalendarClock,
  Radio,
  SkipForward,
  XCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';
import { getApiUrl, getFileUrl } from '../../lib/api';

interface ExportedFileInfo {
  fileName: string;
  downloadUrl: string;
  records?: number;
  format?: string;
  filePath?: string;
}

type RunStatus = 'running' | 'completed' | 'error' | 'cancelled';
type NodeTraceStatus = 'running' | 'completed' | 'error' | 'skipped' | 'continued';

interface NodeTraceEntry {
  nodeId: string;
  label: string;
  type: string;
  status: NodeTraceStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  runs: number;
  retries: number;
  error?: string;
  records?: number;
}

interface ExecutionLog {
  id: string;
  target_type: string;
  target_id: string;
  schedule_id?: string | null;
  status: RunStatus;
  trigger_type?: 'manual' | 'debug' | 'schedule' | 'webhook' | null;
  result?: string | null;
  error_message?: string | null;
  node_trace?: string | null;
  duration_ms?: number | null;
  record_count?: number | null;
  started_at: string;
  completed_at?: string | null;
}

interface StatusStat {
  status: RunStatus;
  count: number;
  avg_ms: number | null;
}

interface FlowExecutionHistoryModalProps {
  flow: { id: string; name: string } | null;
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 20;

const FILTERS: Array<{ value: '' | RunStatus; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'error', label: 'Con error' },
  { value: 'cancelled', label: 'Detenidas' },
];

const TRIGGERS: Record<string, { label: string; icon: React.ElementType }> = {
  manual: { label: 'Manual', icon: Hand },
  debug: { label: 'Debug', icon: Bug },
  schedule: { label: 'Programada', icon: CalendarClock },
  webhook: { label: 'Webhook', icon: Radio },
};

const TRACE_STATUS: Record<NodeTraceStatus, { icon: React.ElementType; className: string; label: string }> = {
  completed: { icon: CheckCircle2, className: 'text-success', label: 'Completado' },
  error: { icon: XCircle, className: 'text-danger', label: 'Error' },
  continued: { icon: AlertTriangle, className: 'text-amber-500', label: 'Falló y continuó' },
  skipped: { icon: SkipForward, className: 'text-muted', label: 'Omitido' },
  running: { icon: Loader2, className: 'text-accent animate-spin', label: 'En ejecución' },
};

function parseJson<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// SQLite datetime('now') is UTC without a zone marker
function parseDbDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function formatStartedAt(dateStr?: string | null) {
  const d = parseDbDate(dateStr);
  return d ? format(d, 'dd/MM/yyyy HH:mm:ss') : dateStr || 'Fecha desconocida';
}

function formatDuration(ms?: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function FlowExecutionHistoryModal({ flow, isOpen, onClose }: FlowExecutionHistoryModalProps) {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<StatusStat[]>([]);
  const [filter, setFilter] = useState<'' | RunStatus>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchLogs = useCallback(async (offset = 0) => {
    if (!flow?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filter) params.set('status', filter);
      const res = await fetch(getApiUrl(`/flows/${flow.id}/logs?${params}`));
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
      const data = await res.json();
      setLogs(prev => (offset === 0 ? data.data || [] : [...prev, ...(data.data || [])]));
      setTotal(data.total ?? (data.data || []).length);
      setStats(data.stats || []);
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar los registros de ejecución.');
    } finally {
      setLoading(false);
    }
  }, [flow?.id, filter]);

  useEffect(() => {
    if (isOpen && flow?.id) {
      setExpanded(null);
      fetchLogs(0);
    }
  }, [isOpen, flow?.id, fetchLogs]);

  const clearHistory = async () => {
    if (!flow?.id) return;
    await fetch(getApiUrl(`/flows/${flow.id}/logs`), { method: 'DELETE' });
    setConfirmClear(false);
    fetchLogs(0);
  };

  if (!isOpen || !flow) return null;

  const totalRuns = stats.reduce((acc, s) => acc + s.count, 0);
  const completedStat = stats.find(s => s.status === 'completed');
  const errorCount = stats.find(s => s.status === 'error')?.count ?? 0;
  // Runs stopped by the user are neither successes nor failures
  const decidedRuns = (completedStat?.count ?? 0) + errorCount;
  const successRate = decidedRuns > 0 ? Math.round(((completedStat?.count ?? 0) / decidedRuns) * 100) : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-fast">
      <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-fast">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-surface">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-accent-light text-accent flex items-center justify-center shrink-0">
              <History size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-fg">Historial de ejecuciones</h2>
              <p className="text-xs text-muted truncate">
                Registro de corridas para: <span className="font-medium text-fg">{flow.name}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="default" size="sm" onClick={() => fetchLogs(0)} disabled={loading} className="h-8 text-xs gap-1.5" title="Refrescar registros">
              <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refrescar</span>
            </Button>
            <button onClick={onClose} className="p-1 rounded text-muted hover:text-fg hover:bg-bg transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Stats + filters */}
        {totalRuns > 0 && (
          <div className="px-4 py-3 border-b border-border bg-bg/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-4 text-xs">
              <Stat label="Ejecuciones" value={totalRuns.toLocaleString()} />
              <Stat
                label="Éxito"
                value={successRate === null ? '—' : `${successRate}%`}
                tone={successRate === null ? undefined : successRate >= 90 ? 'good' : successRate >= 60 ? 'warn' : 'bad'}
              />
              <Stat label="Errores" value={String(errorCount)} tone={errorCount > 0 ? 'bad' : undefined} />
              <Stat label="Duración media" value={formatDuration(completedStat?.avg_ms ?? null)} />
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-bg rounded border border-border">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded font-medium transition-colors',
                    filter === f.value ? 'bg-surface text-accent shadow-sm' : 'text-muted hover:text-fg'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[240px]">
          {loading && logs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-xs">Cargando historial de ejecuciones...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded border border-danger/20 bg-danger/5 text-danger text-xs flex items-center gap-2">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center gap-2 text-muted border border-dashed border-border rounded">
              <Clock size={24} className="text-muted/60" />
              <p className="text-sm font-medium text-fg">
                {filter ? 'No hay ejecuciones con este estado' : 'No hay ejecuciones registradas'}
              </p>
              <p className="text-xs max-w-sm">
                {filter
                  ? 'Prueba con otro filtro.'
                  : 'Este flujo todavía no se ha ejecutado. Inicia una corrida desde el catálogo o desde el diseñador para ver los resultados aquí.'}
              </p>
            </div>
          ) : (
            <>
              {logs.map(log => (
                <RunCard
                  key={log.id}
                  log={log}
                  expanded={expanded === log.id}
                  onToggle={() => setExpanded(prev => (prev === log.id ? null : log.id))}
                />
              ))}
              {logs.length < total && (
                <button
                  type="button"
                  onClick={() => fetchLogs(logs.length)}
                  disabled={loading}
                  className="w-full py-2 text-xs text-accent font-medium border border-dashed border-border rounded hover:border-accent transition-colors flex items-center justify-center gap-1.5"
                >
                  {loading && <Loader2 size={12} className="animate-spin" />}
                  Cargar más ({total - logs.length} restantes)
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between shrink-0 bg-surface">
          {totalRuns > 0 ? (
            confirmClear ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-danger font-medium">¿Borrar todo el historial de este flujo?</span>
                <Button variant="default" size="sm" onClick={clearHistory} className="h-7 text-xs bg-danger text-white hover:bg-danger/90">
                  Sí, borrar
                </Button>
                <Button variant="default" size="sm" onClick={() => setConfirmClear(false)} className="h-7 text-xs">
                  Cancelar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="text-xs text-muted hover:text-danger flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={12} />
                Limpiar historial
              </button>
            )
          ) : (
            <span />
          )}
          <Button variant="default" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted uppercase tracking-wide">{label}</span>
      <span
        className={cn(
          'text-sm font-semibold',
          tone === 'good' && 'text-success',
          tone === 'warn' && 'text-amber-500',
          tone === 'bad' && 'text-danger',
          !tone && 'text-fg'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function RunCard({ log, expanded, onToggle }: { log: ExecutionLog; expanded: boolean; onToggle: () => void }) {
  const resultData = parseJson<{ exportedFiles?: ExportedFileInfo[]; warnings?: number; trigger?: string }>(log.result);
  const trace = parseJson<NodeTraceEntry[]>(log.node_trace) || [];
  const exportedFiles = Array.isArray(resultData?.exportedFiles) ? resultData!.exportedFiles! : [];

  const legacyCancelled = log.status === 'error' && /detenid|cancelad/i.test(log.error_message || '');
  const status: RunStatus = legacyCancelled ? 'cancelled' : log.status;
  const trigger = log.trigger_type || (log.schedule_id ? 'schedule' : resultData?.trigger === 'webhook' ? 'webhook' : null);
  const triggerInfo = trigger ? TRIGGERS[trigger] : null;

  const failedNode = trace.find(t => t.status === 'error');
  const warnings = trace.filter(t => t.status === 'continued').length || resultData?.warnings || 0;
  const totalRetries = trace.reduce((acc, t) => acc + (t.retries || 0), 0);
  const maxDuration = Math.max(1, ...trace.map(t => t.durationMs));

  return (
    <div
      className={cn(
        'rounded border bg-bg/50 transition-colors',
        status === 'error' ? 'border-danger/25' : 'border-border',
        expanded && 'bg-surface shadow-sm'
      )}
    >
      <div className="p-3.5 space-y-2.5">
        {/* Status & timing header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={status} />
            {triggerInfo && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-muted bg-surface border border-border px-1.5 py-0.5 rounded">
                <triggerInfo.icon size={10} />
                {triggerInfo.label}
              </span>
            )}
            <span className="text-xs text-muted">{formatStartedAt(log.started_at)}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted">
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-amber-600" title="Nodos que fallaron pero el flujo continuó">
                <AlertTriangle size={12} />
                {warnings}
              </span>
            )}
            {totalRetries > 0 && (
              <span className="flex items-center gap-1 text-amber-600" title="Reintentos realizados">
                <RotateCw size={12} />
                {totalRetries}
              </span>
            )}
            <span className="flex items-center gap-1" title="Duración de la ejecución">
              <Clock size={12} />
              {formatDuration(log.duration_ms)}
            </span>
            {log.record_count != null && (
              <span className="flex items-center gap-1" title="Registros procesados">
                <Layers size={12} />
                {log.record_count.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Error summary */}
        {(status === 'error' || status === 'cancelled') && log.error_message && (
          <div
            className={cn(
              'p-2.5 rounded text-xs break-words leading-relaxed',
              status === 'cancelled'
                ? 'bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400'
                : 'bg-danger/10 border border-danger/20 text-danger'
            )}
          >
            {failedNode && status === 'error' && (
              <span className="font-semibold">Falló en «{failedNode.label}»: </span>
            )}
            <span className="font-mono">{log.error_message}</span>
          </div>
        )}

        {/* Exported files */}
        {exportedFiles.length > 0 && (
          <div className="pt-1.5 border-t border-border/60 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-muted">Archivos exportados:</span>
            {exportedFiles.map((file, idx) => {
              const fileName = file?.fileName || `archivo_${idx + 1}`;
              const downloadUrl = file?.downloadUrl || '#';
              const isExcel = file?.format === 'Excel' || /\.xlsx?$/i.test(fileName);
              return (
                <a
                  key={idx}
                  href={downloadUrl.startsWith('http') ? downloadUrl : getFileUrl(downloadUrl)}
                  download={fileName}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent bg-accent-light hover:bg-accent/20 px-2.5 py-1 rounded transition-colors"
                >
                  {isExcel ? <FileSpreadsheet size={13} /> : <FileText size={13} />}
                  <span>{fileName}</span>
                  <Download size={11} className="opacity-70" />
                </a>
              );
            })}
          </div>
        )}

        {trace.length > 0 && (
          <button
            type="button"
            onClick={onToggle}
            className="text-[11px] text-accent font-medium flex items-center gap-1 hover:underline"
          >
            <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Ocultar detalle por nodo' : `Ver detalle por nodo (${trace.length})`}
          </button>
        )}
      </div>

      {/* Per-node timeline */}
      {expanded && trace.length > 0 && (
        <div className="border-t border-border divide-y divide-border/60">
          {trace.map(entry => {
            const st = TRACE_STATUS[entry.status] || TRACE_STATUS.completed;
            return (
              <div key={entry.nodeId} className="px-3.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <st.icon size={13} className={cn('shrink-0', st.className)} />
                  <span className="font-medium text-fg truncate" title={entry.nodeId}>{entry.label}</span>
                  {entry.runs > 1 && (
                    <span className="text-[10px] text-muted font-mono shrink-0" title="Ejecuciones dentro del bucle">×{entry.runs}</span>
                  )}
                  {entry.retries > 0 && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-0.5 shrink-0" title="Reintentos">
                      <RotateCw size={9} />
                      {entry.retries}
                    </span>
                  )}
                  <div className="flex-1 mx-2 h-1.5 bg-bg rounded-full overflow-hidden min-w-[40px]">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        entry.status === 'error' ? 'bg-danger/60' : entry.status === 'continued' ? 'bg-amber-400' : 'bg-accent/50'
                      )}
                      style={{ width: `${entry.status === 'skipped' ? 0 : Math.max(2, (entry.durationMs / maxDuration) * 100)}%` }}
                    />
                  </div>
                  {entry.records !== undefined && (
                    <span className="text-[10px] text-muted shrink-0">{entry.records.toLocaleString()} reg.</span>
                  )}
                  <span className="text-[10px] font-mono text-muted w-14 text-right shrink-0">
                    {entry.status === 'skipped' ? 'omitido' : formatDuration(entry.durationMs)}
                  </span>
                </div>
                {entry.error && (
                  <p className={cn('mt-1 ml-5 font-mono text-[10px] break-words', entry.status === 'continued' ? 'text-amber-600' : 'text-danger')}>
                    {entry.error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded">
        <CheckCircle2 size={12} />
        Completado
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
        <Square size={10} className="fill-current" />
        Detenido
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">
        <Loader2 size={12} className="animate-spin" />
        En ejecución
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-danger bg-danger/10 border border-danger/20 px-2 py-0.5 rounded">
      <AlertTriangle size={12} />
      Error
    </span>
  );
}
