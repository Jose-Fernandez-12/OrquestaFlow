import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Node, Edge } from '@xyflow/react';
import {
  Pause,
  StepForward,
  PlayCircle,
  Eye,
  Copy,
  Check,
  Search,
  Table as TableIcon,
  Code2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  X,
  FastForward,
  Globe,
  CornerDownRight,
  Clock,
  Send,
  Loader2,
  Repeat,
  ArrowLeft,
  ArrowRight,
  History
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useAppDispatch } from '../../store/hooks';
import { resumeDebugNode, type IterationDebugRecord, type NodeDebugPreview } from '../../store/flowSlice';
import { cn } from '../../lib/utils';

export interface HttpRequestPreview {
  method: string;
  endpoint: string;
  headers?: Record<string, string>;
  body?: any;
  params?: any;
  iteration?: {
    current: number;
    total: number;
  };
  item?: any;
}

export interface HttpResponsePreview {
  status: number;
  statusText: string;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string>;
  data: any;
  iteration?: {
    current: number;
    total: number;
  };
}

interface DebugContextViewerProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  flowId: string;
  context: Record<string, any>;
  requestPreview?: HttpRequestPreview | null;
  responsePreview?: HttpResponsePreview | null;
  iterationHistory?: IterationDebugRecord[];
  allNodePreviews?: Record<string, NodeDebugPreview>;
}

type ModalTab = 'request' | 'response' | 'input';

export function DebugContextViewer({
  node,
  nodes,
  edges,
  flowId,
  context,
  requestPreview,
  responsePreview,
  iterationHistory = [],
  allNodePreviews = {}
}: DebugContextViewerProps) {
  const dispatch = useAppDispatch();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('request');
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [isDetailsCollapsed, setIsDetailsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Track active iteration and total iterations
  const activeIterationNumber = useMemo(() => {
    if (requestPreview?.iteration?.current) return requestPreview.iteration.current;
    if (responsePreview?.iteration?.current) return responsePreview.iteration.current;
    if (iterationHistory.length > 0) {
      return Math.max(...iterationHistory.map(h => h.iterationIndex));
    }
    return 1;
  }, [requestPreview?.iteration?.current, responsePreview?.iteration?.current, iterationHistory]);

  const totalIterations = useMemo(() => {
    if (requestPreview?.iteration?.total) return requestPreview.iteration.total;
    if (responsePreview?.iteration?.total) return responsePreview.iteration.total;
    if (iterationHistory.length > 0) {
      const maxInHist = Math.max(...iterationHistory.map(h => h.iterationIndex));
      const totalFromHist = iterationHistory[0]?.requestPreview?.iteration?.total || iterationHistory[0]?.responsePreview?.iteration?.total;
      return totalFromHist || maxInHist;
    }
    return 1;
  }, [requestPreview?.iteration?.total, responsePreview?.iteration?.total, iterationHistory]);

  // Selected iteration index to view in modal
  const [selectedIterNum, setSelectedIterNum] = useState<number | null>(null);

  // Sync selected iteration to current active when active updates
  useEffect(() => {
    setSelectedIterNum(activeIterationNumber);
  }, [activeIterationNumber]);

  const viewingIterNum = selectedIterNum ?? activeIterationNumber;
  const isViewingActiveIter = viewingIterNum === activeIterationNumber;

  const currentHistRecord = useMemo(() => {
    return iterationHistory.find(h => h.iterationIndex === viewingIterNum) || null;
  }, [iterationHistory, viewingIterNum]);

  // Effective request and response to display
  const effectiveRequest: HttpRequestPreview | null = useMemo(() => {
    if (isViewingActiveIter && requestPreview) return requestPreview;
    if (currentHistRecord?.requestPreview) return currentHistRecord.requestPreview;
    return requestPreview || null;
  }, [isViewingActiveIter, requestPreview, currentHistRecord]);

  const effectiveResponse: HttpResponsePreview | null = useMemo(() => {
    if (isViewingActiveIter && responsePreview) return responsePreview;
    if (currentHistRecord?.responsePreview) return currentHistRecord.responsePreview;
    return responsePreview || null;
  }, [isViewingActiveIter, responsePreview, currentHistRecord]);

  // Sync default modal tab when preview updates
  useEffect(() => {
    if (responsePreview) {
      setIsSending(false);
      setActiveTab('response');
    } else if (requestPreview) {
      setActiveTab('request');
    } else {
      setActiveTab('input');
    }
  }, [responsePreview, requestPreview]);

  // STRICT GRAPH ISOLATION:
  // Traverse backwards along incoming edges to find ONLY real ancestor nodes that lead into this node
  const upstreamAncestorNodes = useMemo(() => {
    if (!edges || !nodes || !context) return [];

    const ancestorIds = new Set<string>();
    const queue = [node.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const incomingEdges = edges.filter(e => e.target === current);
      for (const edge of incomingEdges) {
        if (!ancestorIds.has(edge.source)) {
          ancestorIds.add(edge.source);
          queue.push(edge.source);
        }
      }
    }

    return nodes
      .filter(n => ancestorIds.has(n.id) && (context[n.id] !== undefined || (n.type === 'forEach' && context._item !== undefined)) && n.type !== 'start')
      .map(n => ({
        id: n.id,
        label: (n.data?.label as string) || n.type,
        type: n.type,
        data: context[n.id] !== undefined ? context[n.id] : context._item
      }));
  }, [node.id, edges, nodes, context]);

  // Selected source from this node's ancestors only
  const [selectedSourceId, setSelectedSourceId] = useState<string>('auto');

  const activeSourceId = useMemo(() => {
    if (selectedSourceId !== 'auto' && upstreamAncestorNodes.some(n => n.id === selectedSourceId)) {
      return selectedSourceId;
    }
    if (upstreamAncestorNodes.length > 0) {
      return upstreamAncestorNodes[0].id;
    }
    return '';
  }, [selectedSourceId, upstreamAncestorNodes]);

  const activeInputData = useMemo(() => {
    if (!context || !activeSourceId) return null;
    return context[activeSourceId];
  }, [context, activeSourceId]);

  // Data to display in the current active tab
  const currentTabData = useMemo(() => {
    if (activeTab === 'response') return effectiveResponse?.data;
    if (activeTab === 'request') return effectiveRequest?.body;
    return activeInputData;
  }, [activeTab, effectiveResponse?.data, effectiveRequest?.body, activeInputData]);

  // Detect if active data is tabular (array of objects)
  const isCurrentDataTabular = useMemo(() => {
    let candidate = currentTabData;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (Array.isArray(candidate.data)) candidate = candidate.data;
      else if (Array.isArray(candidate.rows)) candidate = candidate.rows;
      else if (Array.isArray(candidate.items)) candidate = candidate.items;
      else if (Array.isArray(candidate.result)) candidate = candidate.result;
    }
    return Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === 'object' && candidate[0] !== null;
  }, [currentTabData]);

  const [viewMode, setViewMode] = useState<'table' | 'structured' | 'raw'>('table');

  useEffect(() => {
    setViewMode(isCurrentDataTabular ? 'table' : 'structured');
    setPage(1);
    setSearchTerm('');
  }, [activeTab, isCurrentDataTabular]);

  const tabularRows = useMemo(() => {
    if (!isCurrentDataTabular) return [];
    let candidate = currentTabData;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (Array.isArray(candidate.data)) candidate = candidate.data;
      else if (Array.isArray(candidate.rows)) candidate = candidate.rows;
      else if (Array.isArray(candidate.items)) candidate = candidate.items;
      else if (Array.isArray(candidate.result)) candidate = candidate.result;
    }
    return Array.isArray(candidate) ? candidate : [];
  }, [currentTabData, isCurrentDataTabular]);

  const tabularColumns = useMemo(() => {
    if (tabularRows.length === 0) return [];
    const sample = tabularRows.slice(0, 10);
    const keys = new Set<string>();
    sample.forEach(row => {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [tabularRows]);

  const filteredTabularRows = useMemo(() => {
    if (!searchTerm) return tabularRows;
    const lower = searchTerm.toLowerCase();
    return tabularRows.filter(row => {
      return Object.values(row).some(v => String(v ?? '').toLowerCase().includes(lower));
    });
  }, [tabularRows, searchTerm]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCollapse = (path: string) => {
    setCollapsedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const openModalWithTab = (tab: ModalTab) => {
    setActiveTab(tab);
    setIsModalOpen(true);
  };

  const activeSourceInfo = upstreamAncestorNodes.find(n => n.id === activeSourceId);

  // Formatted string representation of request body/payload
  const formattedRequestBody = useMemo(() => {
    if (!effectiveRequest?.body) return null;
    if (typeof effectiveRequest.body === 'string') {
      try {
        const parsed = JSON.parse(effectiveRequest.body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return effectiveRequest.body;
      }
    }
    return JSON.stringify(effectiveRequest.body, null, 2);
  }, [effectiveRequest?.body]);

  // Formatted string representation of response data
  const formattedResponseBody = useMemo(() => {
    if (!effectiveResponse?.data) return null;
    if (typeof effectiveResponse.data === 'string') {
      try {
        const parsed = JSON.parse(effectiveResponse.data);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return effectiveResponse.data;
      }
    }
    return JSON.stringify(effectiveResponse.data, null, 2);
  }, [effectiveResponse?.data]);

  // Clean, native theme structured data renderer
  const renderStructuredData = (val: any, path: string = 'root', depth: number = 0): React.ReactNode => {
    if (val === null) {
      return <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-bg border border-border text-danger font-medium">null</span>;
    }
    if (val === undefined) {
      return <span className="font-mono text-xs text-muted">undefined</span>;
    }
    if (typeof val === 'boolean') {
      return <span className="font-mono text-xs text-warn font-semibold">{val ? 'true' : 'false'}</span>;
    }
    if (typeof val === 'number') {
      return <span className="font-mono text-xs text-accent font-semibold">{val}</span>;
    }
    if (typeof val === 'string') {
      return <span className="font-mono text-xs text-success break-all leading-relaxed">"{val}"</span>;
    }

    const isArray = Array.isArray(val);
    const isCollapsed = collapsedPaths[path] ?? (depth > 0);
    const keys = Object.keys(val);

    const filteredKeys = searchTerm
      ? keys.filter(k => {
          const keyMatches = k.toLowerCase().includes(searchTerm.toLowerCase());
          const valMatches = typeof val[k] === 'object' ? true : String(val[k]).toLowerCase().includes(searchTerm.toLowerCase());
          return keyMatches || valMatches;
        })
      : keys;

    return (
      <div className="w-full flex flex-col gap-1 my-0.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleCollapse(path)}
            className="flex items-center gap-1.5 text-xs font-mono text-fg hover:text-accent font-medium select-none bg-bg hover:bg-surface px-2 py-0.5 rounded border border-border transition-colors cursor-pointer"
          >
            {isCollapsed ? <ChevronRight size={12} className="text-muted" /> : <ChevronDown size={12} className="text-muted" />}
            <span>{isArray ? `Array [${val.length}]` : `Object {${keys.length}}`}</span>
          </button>
        </div>

        {!isCollapsed && (
          <div className="pl-3 ml-1.5 border-l border-border flex flex-col gap-0.5 py-0.5">
            {filteredKeys.length === 0 && (
              <span className="text-xs text-muted italic py-0.5">Sin coincidencias</span>
            )}
            {filteredKeys.map(k => {
              const childPath = `${path}.${k}`;
              const childVal = val[k];
              const isChildObject = childVal !== null && typeof childVal === 'object';

              return (
                <div
                  key={k}
                  className={cn(
                    "text-xs font-mono py-1 px-1.5 rounded transition-colors hover:bg-bg",
                    isChildObject ? "flex flex-col gap-1" : "flex items-baseline justify-between gap-2"
                  )}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-fg font-medium">{k}:</span>
                  </div>
                  <div className="flex-1 min-w-0 text-right">
                    {renderStructuredData(childVal, childPath, depth + 1)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const currentIteration = responsePreview?.iteration || requestPreview?.iteration || (totalIterations > 1 ? { current: activeIterationNumber, total: totalIterations } : undefined);

  return (
    <>
      {/* Sleek, Integrated Debug Sidebar Banner */}
      <div className={cn(
        "rounded-md border p-3 space-y-2.5 transition-all text-xs shadow-xs",
        responsePreview && !responsePreview.ok
          ? "border-rose-500/30 bg-rose-500/5"
          : responsePreview && responsePreview.ok
            ? "border-emerald-500/30 bg-emerald-500/5"
            : requestPreview
              ? "border-blue-500/30 bg-blue-500/5"
              : "border-amber-500/30 bg-amber-500/5"
      )}>
        {/* Header with status pill and action icons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border",
              responsePreview && !responsePreview.ok
                ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                : responsePreview && responsePreview.ok
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
            )}>
              {responsePreview && !responsePreview.ok ? (
                <AlertCircle size={13} />
              ) : responsePreview && responsePreview.ok ? (
                <CheckCircle2 size={13} />
              ) : (
                <Pause size={11} className="fill-amber-600" />
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="font-semibold text-xs text-fg">
                {isSending
                  ? 'Enviando petición...'
                  : responsePreview
                    ? responsePreview.ok
                      ? 'Respuesta OK'
                      : 'Error HTTP'
                    : requestPreview
                      ? 'Petición lista'
                      : 'Pausado'}
              </span>

              {responsePreview && (
                <span className={cn(
                  "px-1.5 py-0.2 rounded text-[10px] font-bold font-mono",
                  responsePreview.ok
                    ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/25"
                    : "bg-rose-500/15 text-rose-600 border border-rose-500/25"
                )}>
                  {responsePreview.status} {responsePreview.statusText || (responsePreview.ok ? 'OK' : 'Error')}
                </span>
              )}

              {requestPreview && !responsePreview && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold font-mono uppercase bg-blue-500/15 text-blue-600 border border-blue-500/25">
                  {requestPreview.method}
                </span>
              )}

              {responsePreview && (
                <span className="text-[10px] font-mono text-muted flex items-center gap-0.5">
                  <Clock size={10} />
                  {responsePreview.durationMs}ms
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {currentIteration && (
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-surface text-accent border border-border">
                {currentIteration.total > 1
                  ? `${currentIteration.current}/${currentIteration.total}`
                  : '1/1'}
              </span>
            )}
            <button
              type="button"
              onClick={() => openModalWithTab(responsePreview ? 'response' : requestPreview ? 'request' : 'input')}
              className="p-1 rounded text-muted hover:text-accent hover:bg-surface border border-transparent hover:border-border transition-colors cursor-pointer"
              title="Abrir inspección completa en ventana modal"
            >
              <Eye size={13} />
            </button>
          </div>
        </div>

        {/* Quick Action Toolbar */}
        <div className="flex items-center gap-1.5 pt-1">
          {responsePreview ? (
            <>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
                className="flex-1 text-xs h-7 gap-1 font-medium bg-surface border-border hover:bg-bg text-fg shadow-2xs"
                title="Continuar al paso siguiente"
              >
                <StepForward size={12} className="text-accent" />
                <span>Paso siguiente</span>
              </Button>

              {responsePreview.iteration && responsePreview.iteration.total > responsePreview.iteration.current && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'continue_node' }))}
                  className="text-xs h-7 px-2 font-medium bg-surface border-border hover:bg-bg text-fg shadow-2xs"
                  title="Enviar todas las peticiones restantes de este bucle sin pausar"
                >
                  <FastForward size={12} className="text-accent" />
                  <span>Restantes ({responsePreview.iteration.total - responsePreview.iteration.current})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
                className="text-xs h-7 px-3 gap-1 font-medium bg-accent text-white hover:bg-accent-hover shadow-2xs"
                title="Continuar ejecución completa del flujo"
              >
                <PlayCircle size={12} />
                <span>Continuar</span>
              </Button>
            </>
          ) : requestPreview ? (
            <>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isSending}
                onClick={() => {
                  setIsSending(true);
                  dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }));
                }}
                className="flex-1 text-xs h-7 gap-1 font-medium bg-surface border-border hover:bg-bg text-fg shadow-2xs"
                title="Enviar esta petición y pausar al recibir respuesta"
              >
                {isSending ? (
                  <>
                    <Loader2 size={12} className="animate-spin text-accent" />
                    <span>Enviando...</span>
                  </>
                ) : (
                  <>
                    <Send size={12} className="text-accent" />
                    <span>Enviar petición</span>
                  </>
                )}
              </Button>

              {requestPreview.iteration && requestPreview.iteration.total > requestPreview.iteration.current && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'continue_node' }))}
                  className="text-xs h-7 px-2 font-medium bg-surface border-border hover:bg-bg text-fg shadow-2xs"
                  title="Enviar todas las peticiones restantes sin pausar"
                >
                  <FastForward size={12} className="text-accent" />
                  <span>Restantes ({requestPreview.iteration.total - requestPreview.iteration.current + 1})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
                className="text-xs h-7 px-3 gap-1 font-medium bg-accent text-white hover:bg-accent-hover shadow-2xs"
                title="Continuar ejecución completa"
              >
                <PlayCircle size={12} />
                <span>Continuar</span>
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 w-full">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
                className="flex-1 text-xs h-7 gap-1.5 font-medium border-border hover:bg-bg text-fg"
                title="Ejecutar solo este nodo"
              >
                <StepForward size={12} className="text-accent" />
                <span>Paso siguiente</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
                className="flex-1 text-xs h-7 gap-1.5 font-medium bg-accent text-white hover:bg-accent-hover"
                title="Continuar ejecución completa del flujo"
              >
                <PlayCircle size={12} />
                <span>Continuar</span>
              </Button>
            </div>
          )}
        </div>

        {/* Compact Diagnostic Strip (No large JSON cluttering the sidebar) */}
        <div className="pt-2 border-t border-border/30 flex flex-col gap-1.5 text-[11px]">
          {requestPreview && !responsePreview && (
            <div className="flex items-center justify-between gap-2 text-muted">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-fg shrink-0 uppercase font-semibold">
                  {requestPreview.method}
                </span>
                <span className="truncate font-mono text-[10px] text-fg/80" title={requestPreview.endpoint}>
                  {requestPreview.endpoint}
                </span>
              </div>
              <button
                type="button"
                onClick={() => openModalWithTab('request')}
                className="text-accent hover:underline text-[10px] shrink-0 font-medium cursor-pointer flex items-center gap-1"
                title="Ver payload y encabezados completos"
              >
                <Eye size={11} />
                <span>Ver petición</span>
              </button>
            </div>
          )}

          {responsePreview && (
            <div className="flex items-center justify-between gap-2 text-muted">
              <span className="truncate text-fg/80">
                {responsePreview.ok ? 'Respuesta completada con éxito' : 'Respuesta con error del servidor'}
              </span>
              <button
                type="button"
                onClick={() => openModalWithTab('response')}
                className="text-accent hover:underline text-[10px] shrink-0 font-medium cursor-pointer flex items-center gap-1"
                title="Ver respuesta JSON completa"
              >
                <Eye size={11} />
                <span>Ver respuesta</span>
              </button>
            </div>
          )}

          {upstreamAncestorNodes.length > 0 && (
            <div className="flex items-center justify-between text-muted border-t border-border/20 pt-1">
              <span className="truncate max-w-[180px]">
                Origen: <strong className="text-fg font-medium">{activeSourceInfo?.label || upstreamAncestorNodes[0].label}</strong>
              </span>
              <button
                type="button"
                onClick={() => openModalWithTab('input')}
                className="text-accent hover:underline font-mono text-[10px] cursor-pointer"
              >
                Ver datos ({upstreamAncestorNodes.length})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Spacious, Multi-Tab Inspection Modal */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-surface rounded-lg shadow-raised border border-border w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 bg-bg border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20">
                  <Pause size={16} className="fill-amber-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-fg">
                      Inspección de Depuración
                    </h2>
                    <span className="text-xs font-mono bg-surface text-muted px-2 py-0.5 rounded border border-border">
                      {(node.data?.label as string) || node.type}
                    </span>
                    {effectiveResponse && (
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded border font-mono",
                        effectiveResponse.ok
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-600 border-rose-500/20"
                      )}>
                        Respuesta {effectiveResponse.status}
                      </span>
                    )}
                    {totalIterations > 1 && (
                      <span className="text-[10px] bg-accent/10 text-accent font-semibold px-2 py-0.5 rounded border border-accent/20 font-mono">
                        Iteración {viewingIterNum} de {totalIterations}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {effectiveResponse
                      ? 'Inspecciona la petición enviada, la respuesta del servicio y los datos de entrada'
                      : 'Inspecciona la petición configurada y los datos recibidos de los nodos anteriores'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    const dataToCopy =
                      activeTab === 'request' ? (formattedRequestBody || effectiveRequest?.endpoint) :
                      activeTab === 'response' ? formattedResponseBody :
                      JSON.stringify(activeInputData, null, 2);
                    if (dataToCopy) handleCopy(dataToCopy);
                  }}
                  className="gap-1.5 text-xs h-8"
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  <span>{copied ? 'Copiado al portapapeles' : 'Copiar datos de pestaña'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 hover:bg-muted rounded-md text-muted hover:text-fg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Iteration Stepper & History Ribbon */}
            {totalIterations > 1 && (
              <div className="px-4 py-2 bg-surface/80 border-b border-border flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1 text-xs font-semibold text-fg">
                    <Repeat size={13} className="text-accent" />
                    <span>Peticiones ({totalIterations}):</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {Array.from({ length: totalIterations }, (_, i) => i + 1).map(iterNum => {
                      const hist = iterationHistory.find(h => h.iterationIndex === iterNum);
                      const isCurrentActive = iterNum === activeIterationNumber;
                      const isSelected = iterNum === viewingIterNum;
                      const resp = hist?.responsePreview || (isCurrentActive ? responsePreview : null);
                      const hasResp = !!resp;
                      const isRespOk = resp?.ok;
                      const isPending = isCurrentActive && !hasResp;

                      return (
                        <button
                          key={iterNum}
                          type="button"
                          onClick={() => {
                            setSelectedIterNum(iterNum);
                            if (hasResp) {
                              setActiveTab('response');
                            } else {
                              setActiveTab('request');
                            }
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer border",
                            isSelected
                              ? "bg-accent/15 border-accent text-accent font-bold shadow-xs"
                              : "bg-bg hover:bg-surface border-border text-muted hover:text-fg",
                            isCurrentActive && !isSelected && "ring-1 ring-accent/40"
                          )}
                          title={`Ver petición y respuesta de la iteración #${iterNum}`}
                        >
                          {hasResp ? (
                            isRespOk ? (
                              <CheckCircle2 size={12} className="text-emerald-500" />
                            ) : (
                              <AlertCircle size={12} className="text-rose-500" />
                            )
                          ) : isPending ? (
                            <Pause size={10} className="fill-amber-500 text-amber-500" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-border inline-block" />
                          )}
                          <span>#{iterNum}</span>
                          {hasResp && resp && (
                            <span className={cn(
                              "text-[10px] font-bold px-1 rounded",
                              isRespOk ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                            )}>
                              {resp.status}
                            </span>
                          )}
                          {isPending && (
                            <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1 rounded font-sans">
                              Pendiente
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted shrink-0">
                  <button
                    type="button"
                    disabled={viewingIterNum <= 1}
                    onClick={() => {
                      const prev = Math.max(1, viewingIterNum - 1);
                      setSelectedIterNum(prev);
                      const hist = iterationHistory.find(h => h.iterationIndex === prev);
                      if (hist?.responsePreview) setActiveTab('response');
                      else setActiveTab('request');
                    }}
                    className="p-1 rounded hover:bg-bg border border-border disabled:opacity-40 disabled:cursor-not-allowed text-fg"
                    title="Iteración anterior"
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <span className="font-mono text-xs">
                    {viewingIterNum} / {totalIterations}
                  </span>
                  <button
                    type="button"
                    disabled={viewingIterNum >= totalIterations}
                    onClick={() => {
                      const next = Math.min(totalIterations, viewingIterNum + 1);
                      setSelectedIterNum(next);
                      const hist = iterationHistory.find(h => h.iterationIndex === next);
                      if (hist?.responsePreview) setActiveTab('response');
                      else setActiveTab('request');
                    }}
                    className="p-1 rounded hover:bg-bg border border-border disabled:opacity-40 disabled:cursor-not-allowed text-fg"
                    title="Siguiente iteración"
                  >
                    <ArrowRight size={13} />
                  </button>

                  {!isViewingActiveIter && (
                    <button
                      type="button"
                      onClick={() => setSelectedIterNum(activeIterationNumber)}
                      className="ml-2 text-xs font-sans text-accent hover:underline flex items-center gap-1 cursor-pointer font-medium"
                    >
                      <span>Ir a la activa (#{activeIterationNumber})</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Main Tabs Navigation */}
            <div className="px-4 bg-bg border-b border-border flex items-center gap-2">
              {effectiveRequest && (
                <button
                  type="button"
                  onClick={() => setActiveTab('request')}
                  className={cn(
                    "px-3.5 py-2.5 text-xs font-medium border-b-2 flex items-center gap-2 transition-colors cursor-pointer",
                    activeTab === 'request'
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted hover:text-fg"
                  )}
                >
                  <Globe size={14} />
                  <span>Petición HTTP</span>
                  <span className={cn(
                    "text-[10px] font-mono px-1.5 py-0.2 rounded font-bold uppercase",
                    effectiveRequest.method === 'GET' ? "bg-blue-500/10 text-blue-600" :
                    effectiveRequest.method === 'POST' ? "bg-emerald-500/10 text-emerald-600" :
                    "bg-amber-500/10 text-amber-600"
                  )}>
                    {effectiveRequest.method}
                  </span>
                </button>
              )}

              {(effectiveResponse || (isSending && isViewingActiveIter)) && (
                <button
                  type="button"
                  onClick={() => setActiveTab('response')}
                  className={cn(
                    "px-3.5 py-2.5 text-xs font-medium border-b-2 flex items-center gap-2 transition-colors cursor-pointer",
                    activeTab === 'response'
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted hover:text-fg"
                  )}
                >
                  {isSending && isViewingActiveIter && !effectiveResponse ? (
                    <Loader2 size={14} className="animate-spin text-accent" />
                  ) : (
                    <CornerDownRight size={14} />
                  )}
                  <span>Respuesta del Servidor</span>
                  {effectiveResponse ? (
                    <span className={cn(
                      "text-[10px] font-mono px-1.5 py-0.2 rounded font-bold",
                      effectiveResponse.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                    )}>
                      {effectiveResponse.status}
                    </span>
                  ) : isSending ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded font-medium bg-accent/10 text-accent">
                      Enviando...
                    </span>
                  ) : null}
                </button>
              )}

              {upstreamAncestorNodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('input')}
                  className={cn(
                    "px-3.5 py-2.5 text-xs font-medium border-b-2 flex items-center gap-2 transition-colors cursor-pointer",
                    activeTab === 'input'
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted hover:text-fg"
                  )}
                >
                  <TableIcon size={14} />
                  <span>Datos de Entrada</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface border border-border text-muted">
                    {upstreamAncestorNodes.length} origen{upstreamAncestorNodes.length > 1 ? 'es' : ''}
                  </span>
                </button>
              )}
            </div>

            {/* TAB 1: HTTP REQUEST (URL, Headers, Query Params, Full Payload) */}
            {activeTab === 'request' && effectiveRequest && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
                {/* Endpoint & Method Bar */}
                <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg">Destino de la Petición</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(effectiveRequest.endpoint)}
                      className="text-xs text-muted hover:text-fg px-2 py-0.5 rounded border border-border hover:bg-bg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Copy size={12} />
                      <span>{copied ? 'Copiado' : 'Copiar URL completa'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-bold font-mono uppercase shrink-0",
                      effectiveRequest.method === 'GET' ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" :
                      effectiveRequest.method === 'POST' ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                      "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                    )}>
                      {effectiveRequest.method}
                    </span>
                    <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text break-all flex-1">
                      {effectiveRequest.endpoint}
                    </div>
                  </div>
                </div>

                {/* Headers & Query Parameters Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Headers */}
                  <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg">Encabezados (Headers)</span>
                      {effectiveRequest.headers && (
                        <span className="text-[10px] font-mono text-muted">
                          {Object.keys(effectiveRequest.headers).length} encabezados
                        </span>
                      )}
                    </div>
                    {effectiveRequest.headers && Object.keys(effectiveRequest.headers).length > 0 ? (
                      <div className="bg-bg rounded border border-border overflow-hidden">
                        <table className="w-full text-left text-xs font-mono">
                          <tbody>
                            {Object.entries(effectiveRequest.headers).map(([k, v]) => (
                              <tr key={k} className="border-b border-border last:border-b-0 hover:bg-surface/50">
                                <td className="p-2 text-muted border-r border-border font-medium w-1/3 truncate">{k}</td>
                                <td className="p-2 text-fg break-all">{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted italic p-2 bg-bg rounded border border-border">
                        Sin encabezados personalizados configurados
                      </p>
                    )}
                  </div>

                  {/* Query Params or Iteration Item */}
                  <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg">
                        {effectiveRequest.params ? 'Parámetros Query' : 'Contexto de Origen'}
                      </span>
                      {effectiveRequest.iteration && (
                        <span className="text-[10px] font-mono text-accent">
                          Iteración {effectiveRequest.iteration.current} de {effectiveRequest.iteration.total}
                        </span>
                      )}
                    </div>
                    {effectiveRequest.params ? (
                      <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text leading-relaxed">
                        {typeof effectiveRequest.params === 'string' ? effectiveRequest.params : JSON.stringify(effectiveRequest.params, null, 2)}
                      </div>
                    ) : effectiveRequest.item ? (
                      <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text leading-relaxed max-h-36 overflow-y-auto">
                        <pre className="text-xs">{JSON.stringify(effectiveRequest.item, null, 2)}</pre>
                      </div>
                    ) : (
                      <p className="text-xs text-muted italic p-2 bg-bg rounded border border-border">
                        No hay parámetros adicionales
                      </p>
                    )}
                  </div>
                </div>

                {/* Request Payload / Body */}
                <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-fg">Cuerpo de la Petición (Payload)</span>
                      {formattedRequestBody && (
                        <span className="text-[10px] font-mono text-muted bg-bg px-1.5 py-0.5 rounded border border-border">
                          {formattedRequestBody.length} caracteres
                        </span>
                      )}
                    </div>
                    {formattedRequestBody && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(formattedRequestBody)}
                          className="text-xs text-muted hover:text-fg px-2 py-0.5 rounded border border-border hover:bg-bg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Copy size={12} />
                          <span>{copied ? 'Copiado' : 'Copiar Payload'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {formattedRequestBody ? (
                    <div className="bg-bg rounded border border-border overflow-hidden">
                      <pre className="p-3 font-mono text-xs text-fg select-text leading-relaxed max-h-80 overflow-auto whitespace-pre">
                        {formattedRequestBody}
                      </pre>
                    </div>
                  ) : (
                    <div className="p-4 bg-bg rounded border border-border text-center text-xs text-muted italic">
                      Esta petición HTTP no incluye cuerpo (payload vacío o método GET)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: SERVER RESPONSE (Status, Headers, Body or Loading State) */}
            {activeTab === 'response' && isSending && isViewingActiveIter && !effectiveResponse && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-bg/20 space-y-3">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                  <Loader2 size={24} className="animate-spin text-accent" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-fg">Enviando petición HTTP...</h3>
                  <p className="text-xs text-muted mt-1 max-w-md">
                    Esperando respuesta del servidor en <span className="font-mono text-accent">{effectiveRequest?.endpoint}</span>
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'response' && effectiveResponse && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
                {/* Status Bar */}
                <div className="p-3 bg-surface rounded-md border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "px-2.5 py-1 rounded text-xs font-bold font-mono",
                      effectiveResponse.ok
                        ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                    )}>
                      {effectiveResponse.status} {effectiveResponse.statusText || (effectiveResponse.ok ? 'OK' : 'Error')}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-muted font-mono">
                      <Clock size={13} />
                      <span>Tiempo de respuesta: <strong>{effectiveResponse.durationMs} ms</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (formattedResponseBody) handleCopy(formattedResponseBody);
                      }}
                      className="gap-1.5 text-xs h-7"
                    >
                      <Copy size={12} />
                      <span>{copied ? 'Copiado' : 'Copiar respuesta'}</span>
                    </Button>
                  </div>
                </div>

                {/* Response Headers */}
                {effectiveResponse.headers && Object.keys(effectiveResponse.headers).length > 0 && (
                  <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                    <span className="text-xs font-semibold text-fg">Encabezados de Respuesta</span>
                    <div className="bg-bg rounded border border-border overflow-hidden max-h-40 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <tbody>
                          {Object.entries(effectiveResponse.headers).map(([k, v]) => (
                            <tr key={k} className="border-b border-border last:border-b-0 hover:bg-surface/50">
                              <td className="p-1.5 text-muted border-r border-border font-medium w-1/3 truncate">{k}</td>
                              <td className="p-1.5 text-fg break-all">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Response Body with View Switcher */}
                <div className="p-3 bg-surface rounded-md border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-fg">Cuerpo de la Respuesta</span>
                      {isCurrentDataTabular && (
                        <span className="text-[10px] font-mono text-muted bg-bg px-1.5 py-0.5 rounded border border-border">
                          {tabularRows.length} registros
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-bg p-0.5 rounded border border-border">
                        {isCurrentDataTabular && (
                          <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={cn(
                              "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                              viewMode === 'table' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                            )}
                          >
                            <TableIcon size={12} className="inline mr-1" />
                            Tabla
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setViewMode('structured')}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                            viewMode === 'structured' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                          )}
                        >
                          <Code2 size={12} className="inline mr-1" />
                          Árbol
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('raw')}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                            viewMode === 'raw' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                          )}
                        >
                          JSON
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Body Content Area */}
                  {viewMode === 'raw' ? (
                    <pre className="p-3 bg-bg text-fg rounded-md font-mono text-xs leading-relaxed max-h-96 overflow-auto border border-border select-text">
                      {formattedResponseBody}
                    </pre>
                  ) : viewMode === 'table' && isCurrentDataTabular ? (
                    <div className="bg-bg border border-border rounded-md overflow-hidden flex flex-col">
                      <div className="overflow-auto max-h-80 text-xs font-mono">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-surface border-b border-border sticky top-0 z-10">
                            <tr>
                              <th className="p-2 text-xs font-medium text-muted border-r border-border w-12 text-center">#</th>
                              {tabularColumns.map(c => (
                                <th key={c} className="p-2 text-xs font-medium text-fg border-r border-border last:border-r-0 whitespace-nowrap">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTabularRows.slice((page - 1) * pageSize, page * pageSize).map((r, i) => (
                              <tr key={i} className="border-b border-border last:border-b-0 hover:bg-surface/40 transition-colors">
                                <td className="p-1.5 text-xs font-mono text-muted border-r border-border text-center">
                                  {(page - 1) * pageSize + i + 1}
                                </td>
                                {tabularColumns.map(c => (
                                  <td key={c} className="p-1.5 border-r border-border last:border-r-0 whitespace-nowrap truncate max-w-[200px] text-fg">
                                    {r[c] === null ? (
                                      <span className="text-danger font-medium">null</span>
                                    ) : typeof r[c] === 'object' ? (
                                      <span className="text-muted text-[10px] bg-surface px-1 rounded border border-border">
                                        {JSON.stringify(r[c])}
                                      </span>
                                    ) : (
                                      String(r[c] ?? '')
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {filteredTabularRows.length > pageSize && (
                        <div className="p-2.5 bg-surface border-t border-border flex items-center justify-between text-xs text-muted">
                          <span>
                            {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredTabularRows.length)} de {filteredTabularRows.length} registros
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="default"
                              size="sm"
                              disabled={page === 1}
                              onClick={() => setPage(p => Math.max(1, p - 1))}
                              className="h-6 px-2 text-xs"
                            >
                              Anterior
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              disabled={page >= Math.ceil(filteredTabularRows.length / pageSize)}
                              onClick={() => setPage(p => p + 1)}
                              className="h-6 px-2 text-xs"
                            >
                              Siguiente
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-bg rounded-md border border-border max-h-96 overflow-auto">
                      {renderStructuredData(effectiveResponse.data, 'response')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: UPSTREAM ANCESTOR INPUT DATA */}
            {activeTab === 'input' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Modal Controls Bar */}
                <div className="p-3 bg-surface border-b border-border flex flex-wrap items-center justify-between gap-3 shrink-0">
                  {/* Ancestor source pills */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {upstreamAncestorNodes.length > 1 ? (
                      <>
                        <span className="text-xs font-medium text-muted mr-1">Nodo origen:</span>
                        {upstreamAncestorNodes.map(src => (
                          <button
                            key={src.id}
                            type="button"
                            onClick={() => setSelectedSourceId(src.id)}
                            className={cn(
                              "text-xs px-2.5 py-1 rounded border flex items-center gap-2 transition-colors cursor-pointer",
                              src.id === activeSourceId
                                ? "bg-accent text-white border-accent font-medium shadow-xs"
                                : "bg-bg hover:bg-surface border-border text-fg"
                            )}
                          >
                            <span>{src.label}</span>
                            {Array.isArray(src.data) && (
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.2 rounded font-mono",
                                src.id === activeSourceId ? "bg-white/20 text-white" : "bg-surface text-muted border border-border"
                              )}>
                                {src.data.length}
                              </span>
                            )}
                          </button>
                        ))}
                      </>
                    ) : (
                      <span className="text-xs text-muted">
                        Origen: <strong className="text-fg">{activeSourceInfo?.label}</strong>
                      </span>
                    )}
                  </div>

                  {/* View Switcher and Search */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                      <Input
                        className="h-8 pl-8 text-xs w-56 font-mono"
                        placeholder="Buscar registros..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                      {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg">
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1 bg-bg p-0.5 rounded border border-border">
                      {isCurrentDataTabular && (
                        <button
                          type="button"
                          onClick={() => setViewMode('table')}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                            viewMode === 'table' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                          )}
                        >
                          <TableIcon size={12} className="inline mr-1" />
                          Tabla ({tabularRows.length})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setViewMode('structured')}
                        className={cn(
                          "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                          viewMode === 'structured' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                        )}
                      >
                        <Code2 size={12} className="inline mr-1" />
                        Árbol
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('raw')}
                        className={cn(
                          "px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
                          viewMode === 'raw' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                        )}
                      >
                        JSON
                      </button>
                    </div>
                  </div>
                </div>

                {/* Input Data Content Body */}
                <div className="flex-1 overflow-auto p-4 bg-bg/20">
                  {activeInputData === undefined || activeInputData === null ? (
                    <div className="h-full flex items-center justify-center text-muted italic">
                      No hay datos disponibles en esta rama.
                    </div>
                  ) : viewMode === 'raw' ? (
                    <pre className="p-4 bg-surface text-fg rounded-md font-mono text-xs leading-relaxed overflow-x-auto border border-border select-text">
                      {JSON.stringify(activeInputData, null, 2)}
                    </pre>
                  ) : viewMode === 'table' && isCurrentDataTabular ? (
                    <div className="bg-surface border border-border rounded-md overflow-hidden flex flex-col h-full">
                      <div className="overflow-auto flex-1 text-xs font-mono">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-bg border-b border-border sticky top-0 z-10">
                            <tr>
                              <th className="p-2.5 text-xs font-medium text-muted border-r border-border w-12 text-center">#</th>
                              {tabularColumns.map(c => (
                                <th key={c} className="p-2.5 text-xs font-medium text-fg border-r border-border last:border-r-0 whitespace-nowrap">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTabularRows.slice((page - 1) * pageSize, page * pageSize).map((r, i) => (
                              <tr key={i} className="border-b border-border last:border-b-0 hover:bg-bg/40 transition-colors">
                                <td className="p-2 text-xs font-mono text-muted border-r border-border text-center">
                                  {(page - 1) * pageSize + i + 1}
                                </td>
                                {tabularColumns.map(c => (
                                  <td key={c} className="p-2 border-r border-border last:border-r-0 whitespace-nowrap truncate max-w-[220px] text-fg">
                                    {r[c] === null ? (
                                      <span className="text-danger font-medium">null</span>
                                    ) : typeof r[c] === 'object' ? (
                                      <span className="text-muted font-sans text-xs bg-bg px-1 rounded border border-border">
                                        {JSON.stringify(r[c])}
                                      </span>
                                    ) : (
                                      String(r[c] ?? '')
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="p-3 bg-bg border-t border-border flex items-center justify-between text-xs text-muted shrink-0">
                        <div>
                          Mostrando {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, filteredTabularRows.length)} de {filteredTabularRows.length} registros
                        </div>
                        {filteredTabularRows.length > pageSize && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              disabled={page === 1}
                              onClick={() => setPage(p => Math.max(1, p - 1))}
                              className="h-7 px-2 text-xs"
                            >
                              Anterior
                            </Button>
                            <span>Página {page} de {Math.ceil(filteredTabularRows.length / pageSize)}</span>
                            <Button
                              variant="default"
                              size="sm"
                              disabled={page >= Math.ceil(filteredTabularRows.length / pageSize)}
                              onClick={() => setPage(p => p + 1)}
                              className="h-7 px-2 text-xs"
                            >
                              Siguiente
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-surface rounded-md border border-border">
                      {renderStructuredData(activeInputData, 'data')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Modal Step Actions Footer */}
            <div className="p-3 bg-surface border-t border-border flex items-center justify-between shrink-0">
              <div className="text-xs text-muted flex items-center gap-2">
                <span>
                  Nodo actual: <strong className="text-fg">{(node.data?.label as string) || node.type}</strong>
                </span>
                <span>•</span>
                <span>
                  Estado:{' '}
                  <strong className={effectiveResponse ? "text-emerald-600" : "text-amber-600"}>
                    {effectiveResponse ? 'Respuesta recibida' : 'Pausado para inspección'}
                  </strong>
                </span>
                {totalIterations > 1 && (
                  <span className="font-mono text-accent bg-bg px-2 py-0.5 rounded border border-border">
                    {isViewingActiveIter
                      ? `Petición activa: #${activeIterationNumber}/${totalIterations}`
                      : `Revisando histórico: #${viewingIterNum}/${totalIterations}`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isViewingActiveIter ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSelectedIterNum(activeIterationNumber);
                      if (responsePreview) setActiveTab('response');
                      else setActiveTab('request');
                    }}
                    className="gap-1.5 text-xs h-8"
                  >
                    <span>Volver a la petición activa (#{activeIterationNumber})</span>
                    <ArrowRight size={13} />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant={effectiveRequest && !effectiveResponse ? "primary" : "default"}
                      size="sm"
                      disabled={isSending}
                      onClick={() => {
                        if (effectiveRequest && !effectiveResponse) {
                          // Send request and STAY in modal to inspect response
                          setIsSending(true);
                          setActiveTab('response');
                          dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }));
                        } else {
                          // If response already received, advance to next iteration or finish
                          if (totalIterations > 1 && activeIterationNumber < totalIterations) {
                            dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }));
                            setActiveTab('request');
                          } else {
                            dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }));
                            setIsModalOpen(false);
                          }
                        }
                      }}
                      className="gap-2"
                    >
                      {isSending ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Enviando petición...</span>
                        </>
                      ) : (
                        <>
                          {effectiveResponse ? (
                            <StepForward size={14} className="text-accent" />
                          ) : (
                            <Send size={14} />
                          )}
                          <span>
                            {effectiveResponse
                              ? (totalIterations > 1 && activeIterationNumber < totalIterations
                                  ? `Siguiente petición (#${activeIterationNumber + 1}/${totalIterations})`
                                  : 'Paso siguiente')
                              : effectiveRequest
                                ? (totalIterations > 1 ? `Enviar petición #${activeIterationNumber}` : 'Enviar esta petición')
                                : 'Paso siguiente'}
                          </span>
                        </>
                      )}
                    </Button>

                    {totalIterations > 1 && activeIterationNumber < totalIterations && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'continue_node' }));
                          setIsModalOpen(false);
                        }}
                        className="gap-2 text-fg"
                        title="Enviar todas las peticiones restantes sin pausar"
                      >
                        <FastForward size={14} className="text-accent" />
                        <span>Enviar restantes ({totalIterations - activeIterationNumber})</span>
                      </Button>
                    )}

                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        dispatch(resumeDebugNode({ id: flowId, action: 'continue' }));
                        setIsModalOpen(false);
                      }}
                      className="gap-2 text-fg"
                    >
                      <PlayCircle size={14} />
                      <span>Continuar todo</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
