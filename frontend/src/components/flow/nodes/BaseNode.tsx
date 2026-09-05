import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Check, Loader2, X, Clock, FileSpreadsheet, Eye } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    icon: React.ElementType;
    color?: string;
    duration?: number;
    unit?: string;
    fileName?: string;
    format?: string;
    filePath?: string;
    [key: string]: any;
  };
  selected?: boolean;
  type: string;
}

export function BaseNode({ id, data, selected, type }: BaseNodeProps) {
  const executing = useAppSelector(state => state.flows.executingNodeIds.includes(id));
  const completed = useAppSelector(state => state.flows.completedNodeIds.includes(id));
  const hasError = useAppSelector(state => state.flows.errorNodeIds.includes(id));
  const nodeResult = useAppSelector(state => state.flows.nodeResults[id]);
  const progress = useAppSelector(state => state.flows.nodeProgress[id]);
  const timerState = useAppSelector(state => state.flows.nodeTimers[id]);

  const Icon = data.icon;

  const typeColors: Record<string, string> = {
    start: 'text-green-600',
    httpGet: 'text-blue-600',
    httpPost: 'text-indigo-600',
    httpRequest: 'text-blue-600',
    scraping: 'text-purple-600',
    export: 'text-orange-600',
    query: 'text-cyan-600',
    timer: 'text-amber-600',
    delay: 'text-amber-600',
    dataSource: 'text-emerald-600',
    fileSource: 'text-emerald-600',
  };

  const typeLabels: Record<string, string> = {
    start: 'Inicio',
    httpGet: 'HTTP Request',
    httpPost: 'HTTP Request',
    httpRequest: 'HTTP Request',
    scraping: 'Web Scraping',
    export: 'Exportar archivo',
    query: 'Consulta DB',
    timer: 'Pausa programada',
    delay: 'Pausa programada',
    dataSource: 'Obtener datos (Excel/CSV)',
    fileSource: 'Obtener datos (Excel/CSV)',
  };

  const formatTimerDuration = (seconds: number) => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs > 0 ? `${secs}s` : ''}`.trim();
    }
    return `${seconds}s`;
  };

  const onNodeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Export node double click -> quick preview modal
    if (type === 'export') {
      window.dispatchEvent(
        new CustomEvent('preview-export-node', {
          detail: {
            id,
            label: data.label || 'Exportar',
            result: nodeResult,
            completed,
            hasError,
            fileName: data.fileName,
            format: data.format
          }
        })
      );
      return;
    }

    // Data source node double click -> preview modal
    if (type === 'dataSource' || type === 'fileSource') {
      window.dispatchEvent(
        new CustomEvent('preview-data-source-node', {
          detail: {
            id,
            label: data.label || 'Obtener datos',
            filePath: data.filePath,
            fileName: data.fileName,
            format: data.format,
            sheetName: data.sheetName,
            sheets: data.sheets,
            sampleRows: data.sampleRows,
            totalRows: data.totalRows,
            result: nodeResult,
            completed
          }
        })
      );
      return;
    }

    // Default inspection for completed/error nodes
    if (completed || hasError) {
      window.dispatchEvent(
        new CustomEvent('inspect-node-result', {
          detail: { id, result: nodeResult, hasError, label: data.label }
        })
      );
    }
  };

  const handleClass = cn(
    '!w-3 !h-3 !rounded-full !border-2 !border-surface !bg-slate-400 dark:!bg-slate-500 transition-colors duration-150 z-20 cursor-crosshair',
    'hover:!bg-accent hover:!border-white hover:ring-2 hover:ring-accent/40',
    selected ? 'opacity-100 !bg-accent' : 'opacity-0 group-hover:opacity-100'
  );

  return (
    <div
      onDoubleClick={onNodeDoubleClick}
      className={cn(
        'bg-surface rounded-md border min-w-[210px] shadow-sm transition-all relative group cursor-pointer select-none',
        selected ? 'border-accent shadow-focus' : 'border-border hover:border-muted',
        executing && (type === 'timer' || type === 'delay')
          ? 'border-amber-500'
          : executing && 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/10',
        completed && !hasError && 'border-success',
        hasError && !executing && 'border-red-500 ring-2 ring-red-500/30 bg-red-50'
      )}
    >
      {/* Node Status Badge */}
      {executing && (
        <div className={cn(
          "absolute -top-3 -right-3 w-6 h-6 bg-surface border rounded-full flex items-center justify-center shadow-sm z-20",
          (type === 'timer' || type === 'delay') ? "border-amber-500 text-amber-600" : "border-blue-500 text-blue-500"
        )}>
          <Loader2 size={12} className="animate-spin" />
        </div>
      )}
      {completed && !executing && !hasError && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-success text-white rounded-full flex items-center justify-center shadow-sm z-20">
          <Check size={12} strokeWidth={3} />
        </div>
      )}
      {hasError && !executing && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm z-20">
          <X size={12} strokeWidth={3} />
        </div>
      )}

      {/* 4 Connection Points: Left, Right, Top, Bottom */}
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={handleClass}
      />

      {/* Content */}
      <div className="p-3 flex items-center gap-3">
        <div className={cn('p-2 rounded-sm bg-bg shrink-0', typeColors[type] || 'text-fg')}>
          {Icon ? <Icon size={18} /> : <FileSpreadsheet size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{data.label}</div>
          
          {/* Subtitle */}
          {(type === 'timer' || type === 'delay') ? (
            executing && timerState ? (
              <div className="text-xs text-amber-600 font-medium truncate flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                </span>
                <span>Pausa: {formatTimerDuration(timerState.remainingSeconds)} restante{timerState.remainingSeconds !== 1 ? 's' : ''}</span>
              </div>
            ) : (
              <div className="text-xs text-muted truncate">
                Pausa: {data.duration || 10} {data.unit === 'minutes' ? 'min' : data.unit === 'hours' ? 'h' : 's'}
              </div>
            )
          ) : (
            <div className="text-xs text-muted truncate">
              {typeLabels[type] || type}
            </div>
          )}

          {/* Progress bar for batch HTTP or iterative nodes */}
          {executing && progress && (
            <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-blue-500">
              <div className="flex-1 mr-2 bg-blue-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <span>{progress.current}/{progress.total}</span>
            </div>
          )}

          {/* Data Source file info */}
          {(type === 'dataSource' || type === 'fileSource') && (
            <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-muted">
              {data.fileName ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('preview-data-source-node', {
                          detail: {
                            id,
                            label: data.label || 'Obtener datos',
                            filePath: data.filePath,
                            fileName: data.fileName,
                            format: data.format,
                            sheetName: data.sheetName,
                            sheets: data.sheets,
                            sampleRows: data.sampleRows,
                            totalRows: data.totalRows,
                            result: nodeResult,
                            completed
                          }
                        })
                      );
                    }}
                    className="font-mono bg-bg hover:bg-emerald-500/10 hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300 px-1 py-0.5 rounded border border-border truncate max-w-[100px] cursor-pointer transition-colors"
                    title={`${data.fileName} (Clic para ver datos)`}
                  >
                    {data.fileName}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('preview-data-source-node', {
                          detail: {
                            id,
                            label: data.label || 'Obtener datos',
                            filePath: data.filePath,
                            fileName: data.fileName,
                            format: data.format,
                            sheetName: data.sheetName,
                            sheets: data.sheets,
                            sampleRows: data.sampleRows,
                            totalRows: data.totalRows,
                            result: nodeResult,
                            completed
                          }
                        })
                      );
                    }}
                    className="flex items-center gap-1 text-[9px] text-emerald-700 dark:text-emerald-300 font-semibold cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0 transition-colors"
                    title="Previsualizar tabla de datos"
                  >
                    <Eye size={10} />
                    <span>Ver datos</span>
                  </button>
                </>
              ) : (
                <span className="italic">Sin archivo configurado</span>
              )}
            </div>
          )}

          {/* Export node quick double-click hint */}
          {type === 'export' && (
            <div className="mt-1 text-[9px] text-muted/80 flex items-center gap-1">
              <span>Doble clic para previsualizar</span>
            </div>
          )}
        </div>
      </div>

      {/* Sleek bottom progress bar for timer node while executing */}
      {executing && (type === 'timer' || type === 'delay') && timerState && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-100/60 dark:bg-amber-950/40 rounded-b-md overflow-hidden">
          <div
            className="bg-amber-500 h-full transition-all duration-500 ease-linear"
            style={{
              width: `${Math.min(
                100,
                Math.max(
                  0,
                  ((timerState.totalSeconds - timerState.remainingSeconds) /
                    Math.max(1, timerState.totalSeconds)) *
                    100
                )
              )}%`
            }}
          />
        </div>
      )}
    </div>
  );
}
