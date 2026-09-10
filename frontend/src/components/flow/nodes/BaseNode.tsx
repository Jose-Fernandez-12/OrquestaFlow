import React from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Check,
  Loader2,
  X,
  Clock,
  FileSpreadsheet,
  Eye,
  Pause,
  Play,
  Globe,
  FileOutput,
  Code,
  Database,
  List,
  Repeat,
  Square,
  GitFork,
  Braces,
  Radio,
  KeyRound,
  Bot
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';

interface BaseNodeProps {
  id: string;
  data: {
    label?: string;
    icon?: React.ElementType;
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

const typeIcons: Record<string, React.ElementType> = {
  start: Play,
  httpGet: Globe,
  httpPost: Globe,
  httpRequest: Globe,
  scraping: Code,
  export: FileOutput,
  query: Database,
  timer: Clock,
  delay: Clock,
  dataSource: FileSpreadsheet,
  fileSource: FileSpreadsheet,
  dataList: List,
  forEach: Repeat,
  forEachEnd: Square,
  conditionalBranch: GitFork,
  jsonTransform: Braces,
  webhookTrigger: Radio,
  oauth2Connector: KeyRound,
  aiChatCompletion: Bot,
};

function BaseNodeComponent({ id, data, selected, type }: BaseNodeProps) {
  const executing = useAppSelector(state => state.flows.executingNodeIds.includes(id));
  const completed = useAppSelector(state => state.flows.completedNodeIds.includes(id));
  const hasError = useAppSelector(state => state.flows.errorNodeIds.includes(id));
  const paused = useAppSelector(state => state.flows.pausedNodeIds.includes(id));
  const nodeResult = useAppSelector(state => state.flows.nodeResults[id]);
  const progress = useAppSelector(state => state.flows.nodeProgress[id]);
  const timerState = useAppSelector(state => state.flows.nodeTimers[id]);

  const Icon = data?.icon || typeIcons[type] || FileSpreadsheet;

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
    dataList: 'text-violet-600',
    forEach: 'text-sky-600',
    forEachEnd: 'text-sky-600',
    conditionalBranch: 'text-amber-500',
    jsonTransform: 'text-teal-600',
    webhookTrigger: 'text-pink-600',
    oauth2Connector: 'text-indigo-600',
    aiChatCompletion: 'text-fuchsia-600',
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
    dataList: 'Lista de datos',
    forEach: 'Inicio de bucle',
    forEachEnd: 'Fin de bucle',
    conditionalBranch: 'Bifurcación',
    jsonTransform: 'Transformar JSON',
    webhookTrigger: 'Disparador Webhook',
    oauth2Connector: 'Conector OAuth2',
    aiChatCompletion: 'Inteligencia Artificial',
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
    if (completed || hasError || paused) {
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
        paused && 'border-amber-400 ring-2 ring-amber-400/50 bg-amber-50/20',
        executing && !paused && (type === 'timer' || type === 'delay')
          ? 'border-amber-500'
          : executing && !paused && (type === 'forEach' || type === 'forEachEnd')
            ? 'border-sky-500 ring-2 ring-sky-500/30'
            : executing && !paused && 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/10',
        completed && !hasError && 'border-success',
        hasError && !executing && 'border-red-500 ring-2 ring-red-500/30 bg-red-50'
      )}
    >
      {/* Node Status Badge */}
      {paused && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-amber-100 border border-amber-400 text-amber-600 rounded-full flex items-center justify-center shadow-sm z-20 animate-pulse">
          <Pause size={12} className="fill-amber-600" />
        </div>
      )}
      {executing && !paused && (
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

      {/* Connection Handles: specialized for conditionalBranch, universal for others */}
      {type === 'conditionalBranch' ? (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            isConnectable={true}
            isConnectableStart={true}
            isConnectableEnd={true}
            className={handleClass}
          />
          {data?.mode === 'switch' ? (
            <>
              {(data.cases || [{ id: '1', caseId: 'case_1' }]).map((c: any, idx: number) => (
                <Handle
                  key={c.caseId || idx}
                  type="source"
                  position={Position.Right}
                  id={c.caseId || `case_${c.id}`}
                  style={{ top: `${28 + idx * 24}px` }}
                  className={cn(handleClass, "!bg-amber-500 !opacity-100")}
                  title={`Caso: ${c.value || c.caseId || idx + 1}`}
                />
              ))}
              <Handle
                type="source"
                position={Position.Right}
                id="default"
                style={{ bottom: '12px' }}
                className={cn(handleClass, "!bg-muted-foreground !opacity-100")}
                title="Por defecto (Default)"
              />
            </>
          ) : (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="true"
                style={{ top: '32%' }}
                className={cn(handleClass, "!bg-green-500 !opacity-100")}
                title="Verdadero (True / Si)"
              />
              <Handle
                type="source"
                position={Position.Right}
                id="false"
                style={{ top: '68%' }}
                className={cn(handleClass, "!bg-red-500 !opacity-100")}
                title="Falso (False / No)"
              />
              <div className="absolute right-3 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none text-[8px] font-bold select-none">
                <span className="text-green-600">SI</span>
                <span className="text-red-500">NO</span>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            isConnectable={true}
            isConnectableStart={true}
            isConnectableEnd={true}
            className={handleClass}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            isConnectable={true}
            isConnectableStart={true}
            isConnectableEnd={true}
            className={handleClass}
          />
          <Handle
            type="source"
            position={Position.Top}
            id="top"
            isConnectable={true}
            isConnectableStart={true}
            isConnectableEnd={true}
            className={handleClass}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            isConnectableStart={true}
            isConnectableEnd={true}
            className={handleClass}
          />
        </>
      )}

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
              ) : data.mode === 'merge' ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="italic flex items-center gap-1 text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Modo Unificador
                  </span>
                  {completed && nodeResult && Array.isArray(nodeResult) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(
                          new CustomEvent('preview-data-source-node', {
                            detail: {
                              id,
                              label: data.label || 'Obtener datos',
                              format: 'Unificado',
                              result: nodeResult,
                              totalRows: nodeResult.length,
                              completed
                            }
                          })
                        );
                      }}
                      className="flex items-center gap-1 text-[9px] text-emerald-700 dark:text-emerald-300 font-semibold cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0 transition-colors"
                      title="Previsualizar tabla de datos unificados"
                    >
                      <Eye size={10} />
                      <span>Ver datos ({nodeResult.length})</span>
                    </button>
                  )}
                </div>
              ) : (
                <span className="italic">Sin archivo configurado</span>
              )}
            </div>
          )}

          {/* DataList item count */}
          {type === 'dataList' && (
            <div className="mt-1 text-[10px] text-muted">
              {data.items ? (
                <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border">
                  {(() => { try { return JSON.parse(data.items).length; } catch { return 0; } })()} elementos
                </span>
              ) : (
                <span className="italic">Sin datos configurados</span>
              )}
            </div>
          )}

          {/* ForEach progress info */}
          {type === 'forEach' && executing && progress && (
            <div className="mt-1 text-[10px] text-sky-600 font-medium">
              Iteracion {progress.current} de {progress.total}
            </div>
          )}

          {/* Export node quick double-click hint */}
          {type === 'export' && (
            <div className="mt-1 text-[9px] text-muted/80 flex items-center gap-1">
              <span>Doble clic para previsualizar</span>
            </div>
          )}

          {/* Conditional Branch preview */}
          {type === 'conditionalBranch' && (
            <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-muted">
              <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border inline-block truncate max-w-[150px]">
                {data.mode === 'switch' ? `Switch: ${data.switchField || 'campo'}` : `If: ${data.operator || 'equals'}`}
              </span>
              {completed && nodeResult?.selectedBranch && (
                <span className="text-amber-600 font-semibold">
                  Rama: {String(nodeResult.selectedBranch)}
                </span>
              )}
            </div>
          )}

          {/* JSON Transform preview */}
          {type === 'jsonTransform' && (
            <div className="mt-1 text-[10px] text-muted">
              <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border">
                {data.transformType === 'pick' ? 'Seleccionar campos' : 'JavaScript seguro'}
              </span>
            </div>
          )}

          {/* Webhook Trigger preview */}
          {type === 'webhookTrigger' && (
            <div className="mt-1 text-[10px] text-muted truncate">
              <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border">
                {data.webhookId ? `/${data.webhookId}` : 'Sin Webhook ID'}
              </span>
            </div>
          )}

          {/* OAuth2 Connector preview */}
          {type === 'oauth2Connector' && (
            <div className="mt-1 text-[10px] text-muted">
              <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border">
                {data.grantType === 'password' ? 'Password' : 'Client Creds'}
              </span>
              {completed && nodeResult?.access_token && (
                <span className="ml-1 text-emerald-600 font-medium">Token OK</span>
              )}
            </div>
          )}

          {/* AI Chat Completion preview */}
          {type === 'aiChatCompletion' && (
            <div className="mt-1 text-[10px] text-muted truncate">
              <span className="font-mono bg-bg px-1 py-0.5 rounded border border-border">
                {String(data.model || 'gpt-4o-mini')}
              </span>
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

export const BaseNode = React.memo(BaseNodeComponent);
