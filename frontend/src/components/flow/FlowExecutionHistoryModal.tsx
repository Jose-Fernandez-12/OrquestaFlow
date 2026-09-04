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
  Square
} from 'lucide-react';
import { Button } from '../ui/button';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';

interface ExportedFileInfo {
  fileName: string;
  downloadUrl: string;
  records?: number;
  format?: string;
  filePath?: string;
}

interface ExecutionLog {
  id: string;
  target_type: string;
  target_id: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  result?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  record_count?: number | null;
  started_at: string;
  completed_at?: string | null;
}

interface FlowExecutionHistoryModalProps {
  flow: { id: string; name: string } | null;
  isOpen: boolean;
  onClose: () => void;
}

export function FlowExecutionHistoryModal({
  flow,
  isOpen,
  onClose
}: FlowExecutionHistoryModalProps) {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!flow?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/api/flows/${flow.id}/logs`);
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      setLogs(data.data || []);
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar los registros de ejecución.');
    } finally {
      setLoading(false);
    }
  }, [flow?.id]);

  useEffect(() => {
    if (isOpen && flow?.id) {
      fetchLogs();
    }
  }, [isOpen, flow?.id, fetchLogs]);

  if (!isOpen || !flow) return null;

  const parseResult = (raw?: string | null): { exportedFiles?: ExportedFileInfo[]; nodeCount?: number; recordCount?: number } | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const formatStartedAt = (dateStr?: string | null) => {
    if (!dateStr) return 'Fecha desconocida';
    try {
      const isoStr = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return dateStr;
      return format(d, 'dd/MM/yyyy HH:mm:ss');
    } catch {
      return dateStr;
    }
  };

  const formatDuration = (ms?: number | null) => {
    if (ms == null) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-fast">
      <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-fast">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-surface">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-accent-light text-accent flex items-center justify-center shrink-0">
              <History size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-fg">
                Historial de ejecuciones
              </h2>
              <p className="text-xs text-muted">
                Registro de corridas para: <span className="font-medium text-fg">{flow.name}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={fetchLogs}
              disabled={loading}
              className="h-8 text-xs gap-1.5"
              title="Refrescar registros"
            >
              <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refrescar</span>
            </Button>
            <button
              onClick={onClose}
              className="p-1 rounded text-muted hover:text-fg hover:bg-bg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

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
              <p className="text-sm font-medium text-fg">No hay ejecuciones registradas</p>
              <p className="text-xs max-w-sm">
                Este flujo todavía no se ha ejecutado. Inicia una corrida desde el catálogo o desde el diseñador para ver los resultados aquí.
              </p>
            </div>
          ) : (
            logs.map((log) => {
              const resultData = parseResult(log.result);
              const exportedFiles = Array.isArray(resultData?.exportedFiles) ? resultData.exportedFiles : [];
              const isCompleted = log.status === 'completed';
              const isCancelled = log.status === 'cancelled' || (log.status === 'error' && (log.error_message?.toLowerCase().includes('detenid') || log.error_message?.toLowerCase().includes('cancelad')));
              const isError = log.status === 'error' && !isCancelled;
              const isRunning = log.status === 'running';

              return (
                <div
                  key={log.id}
                  className="p-3.5 rounded border border-border bg-bg/50 hover:bg-bg transition-colors space-y-2.5"
                >
                  {/* Status & Timing Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isCompleted && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded">
                          <CheckCircle2 size={12} />
                          Completado
                        </span>
                      )}
                      {isCancelled && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                          <Square size={10} className="fill-current" />
                          Detenido
                        </span>
                      )}
                      {isError && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-danger bg-danger/10 border border-danger/20 px-2 py-0.5 rounded">
                          <AlertTriangle size={12} />
                          Error
                        </span>
                      )}
                      {isRunning && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">
                          <Loader2 size={12} className="animate-spin" />
                          En ejecución
                        </span>
                      )}

                      <span className="text-xs text-muted">
                        {formatStartedAt(log.started_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted">
                      <div className="flex items-center gap-1" title="Duración de la ejecución">
                        <Clock size={12} />
                        <span>{formatDuration(log.duration_ms)}</span>
                      </div>

                      {log.record_count != null && (
                        <div className="flex items-center gap-1" title="Registros procesados">
                          <Layers size={12} />
                          <span>{log.record_count.toLocaleString()} registros</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error / Cancelled Message Details */}
                  {(isError || isCancelled) && log.error_message && (
                    <div className={cn(
                      "p-2.5 rounded text-xs font-mono break-words leading-relaxed",
                      isCancelled
                        ? "bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400"
                        : "bg-danger/10 border border-danger/20 text-danger"
                    )}>
                      {log.error_message}
                    </div>
                  )}

                  {/* Exported Files */}
                  {exportedFiles.length > 0 && (
                    <div className="pt-1.5 border-t border-border/60 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-muted">Archivos exportados:</span>
                      {exportedFiles.map((file, idx) => {
                        const fileName = file?.fileName || `archivo_${idx + 1}`;
                        const downloadUrl = file?.downloadUrl || '#';
                        const isExcel = file?.format === 'Excel' || fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');

                        return (
                          <a
                            key={idx}
                            href={downloadUrl.startsWith('http') ? downloadUrl : `http://localhost:3001${downloadUrl}`}
                            download={fileName}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent bg-accent-light hover:bg-accent/20 px-2.5 py-1 rounded transition-colors"
                          >
                            {isExcel ? (
                              <FileSpreadsheet size={13} />
                            ) : (
                              <FileText size={13} />
                            )}
                            <span>{fileName}</span>
                            <Download size={11} className="opacity-70" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex justify-end shrink-0 bg-surface">
          <Button variant="default" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
