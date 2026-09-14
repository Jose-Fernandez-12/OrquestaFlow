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
  X,
  FastForward,
  Globe,
  CornerDownRight,
  Clock,
  Send
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useAppDispatch } from '../../store/hooks';
import { resumeDebugNode } from '../../store/flowSlice';
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
}

type ModalTab = 'request' | 'response' | 'input';

export function DebugContextViewer({
  node,
  nodes,
  edges,
  flowId,
  context,
  requestPreview,
  responsePreview
}: DebugContextViewerProps) {
  const dispatch = useAppDispatch();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('request');
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Sync default modal tab when preview updates
  useEffect(() => {
    if (responsePreview) {
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
    if (activeTab === 'response') return responsePreview?.data;
    if (activeTab === 'request') return requestPreview?.body;
    return activeInputData;
  }, [activeTab, responsePreview, requestPreview, activeInputData]);

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
    if (!requestPreview?.body) return null;
    if (typeof requestPreview.body === 'string') {
      try {
        const parsed = JSON.parse(requestPreview.body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return requestPreview.body;
      }
    }
    return JSON.stringify(requestPreview.body, null, 2);
  }, [requestPreview?.body]);

  // Formatted string representation of response data
  const formattedResponseBody = useMemo(() => {
    if (!responsePreview?.data) return null;
    if (typeof responsePreview.data === 'string') return responsePreview.data;
    return JSON.stringify(responsePreview.data, null, 2);
  }, [responsePreview?.data]);

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

  const currentIteration = responsePreview?.iteration || requestPreview?.iteration;

  return (
    <>
      {/* Sleek, Integrated Sidebar Card */}
      <div className="rounded-md border border-border bg-surface p-3 space-y-3 shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20">
              <Pause size={12} className="fill-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-fg">Modo Debug</span>
                <span className="text-[10px] bg-amber-500/10 text-amber-700 font-medium px-1.5 py-0.2 rounded border border-amber-500/20">
                  {responsePreview ? 'Respuesta recibida' : 'Pausado'}
                </span>
              </div>
            </div>
          </div>
          {currentIteration && (
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-bg text-accent border border-border">
              {currentIteration.total > 1
                ? `${currentIteration.current} de ${currentIteration.total}`
                : 'Petición 1/1'}
            </span>
          )}
        </div>

        {/* Server Response Card (if node is paused on an HTTP response) */}
        {responsePreview && (
          <div className="p-2.5 rounded bg-bg border border-border space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-bold font-mono",
                  responsePreview.ok
                    ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                )}>
                  {responsePreview.status} {responsePreview.statusText || (responsePreview.ok ? 'OK' : 'Error')}
                </span>
                <span className="text-[10px] font-mono text-muted flex items-center gap-1">
                  <Clock size={10} />
                  {responsePreview.durationMs} ms
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (formattedResponseBody) handleCopy(formattedResponseBody);
                }}
                className="text-[10px] text-muted hover:text-fg px-1.5 py-0.5 rounded border border-border hover:bg-surface transition-colors cursor-pointer"
              >
                {copied ? 'Copiado' : 'Copiar respuesta'}
              </button>
            </div>

            {/* Response preview snippet */}
            <div className="p-2 bg-surface rounded border border-border font-mono text-[11px] text-fg select-text leading-relaxed max-h-28 overflow-y-auto whitespace-pre-wrap break-all">
              {formattedResponseBody || 'Sin contenido de respuesta'}
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => openModalWithTab('response')}
              className="w-full gap-1.5 text-xs h-7 bg-surface border-border hover:bg-bg text-fg font-medium"
            >
              <Eye size={13} className="text-accent" />
              <span>Ver respuesta completa del servidor</span>
            </Button>
          </div>
        )}

        {/* HTTP Request Details if paused on an HTTP request */}
        {requestPreview && !responsePreview && (
          <div className="p-2.5 rounded bg-bg border border-border space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase",
                  requestPreview.method === 'GET' ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" :
                  requestPreview.method === 'POST' ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                  requestPreview.method === 'PUT' || requestPreview.method === 'PATCH' ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                  "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                )}>
                  {requestPreview.method}
                </span>
                <span className="text-[11px] font-medium text-muted">
                  Petición preparada
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(requestPreview.endpoint);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="text-[10px] text-muted hover:text-fg px-1.5 py-0.5 rounded border border-border hover:bg-surface transition-colors cursor-pointer"
              >
                {copied ? 'Copiado' : 'Copiar URL'}
              </button>
            </div>

            <div className="p-2 bg-surface rounded border border-border break-all font-mono text-[11px] text-fg select-text leading-relaxed">
              {requestPreview.endpoint}
            </div>

            {/* Request Body / Payload preview for POST, PUT, PATCH */}
            {formattedRequestBody && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className="font-medium text-fg">Cuerpo / Payload:</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(formattedRequestBody);
                      setCopiedPayload(true);
                      setTimeout(() => setCopiedPayload(false), 1500);
                    }}
                    className="text-[10px] text-muted hover:text-fg px-1.5 py-0.2 rounded border border-border hover:bg-surface transition-colors cursor-pointer"
                  >
                    {copiedPayload ? 'Copiado' : 'Copiar Payload'}
                  </button>
                </div>
                <div className="p-2 bg-surface rounded border border-border font-mono text-[11px] text-fg select-text leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                  {formattedRequestBody}
                </div>
              </div>
            )}

            {requestPreview.item && (
              <div className="text-[11px] text-muted bg-surface/60 p-2 rounded border border-border space-y-0.5">
                <div className="font-medium text-fg flex items-center justify-between">
                  <span>Dato origen actual:</span>
                  {requestPreview.item.CityCapitalId !== undefined && (
                    <span className="font-mono text-accent">ID: {requestPreview.item.CityCapitalId}</span>
                  )}
                  {requestPreview.item.id !== undefined && (
                    <span className="font-mono text-accent">ID: {requestPreview.item.id}</span>
                  )}
                </div>
                <div className="truncate text-fg/80 font-mono text-[10px]">
                  {requestPreview.item.Name || requestPreview.item.nombre || requestPreview.item.name || JSON.stringify(requestPreview.item)}
                </div>
              </div>
            )}

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => openModalWithTab('request')}
              className="w-full gap-1.5 text-xs h-7 bg-surface border-border hover:bg-bg text-fg font-medium"
            >
              <Eye size={13} className="text-accent" />
              <span>Inspeccionar petición completa</span>
            </Button>
          </div>
        )}

        {/* Upstream branch info */}
        <div className="text-xs text-muted">
          {upstreamAncestorNodes.length === 0 ? (
            <p className="italic text-[11px]">No hay nodos previos ejecutados en esta rama.</p>
          ) : (
            <div className="flex items-center justify-between bg-bg rounded px-2.5 py-1.5 border border-border">
              <span className="text-fg font-medium truncate max-w-[180px]">
                Origen: {activeSourceInfo?.label || upstreamAncestorNodes[0].label}
              </span>
              <button
                type="button"
                onClick={() => openModalWithTab('input')}
                className="text-[11px] font-mono text-accent hover:underline cursor-pointer"
              >
                Ver datos ({upstreamAncestorNodes.length})
              </button>
            </div>
          )}
        </div>

        {/* Execution control buttons */}
        {responsePreview ? (
          <div className="space-y-1.5 pt-1 border-t border-border">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
              className="w-full text-xs h-8 gap-1.5 font-medium border-border hover:bg-bg text-fg"
              title="Continuar a la siguiente petición o siguiente nodo"
            >
              <StepForward size={13} className="text-accent" />
              <span>
                {responsePreview.iteration && responsePreview.iteration.total > 1
                  ? `Siguiente petición (${responsePreview.iteration.current}/${responsePreview.iteration.total})`
                  : 'Paso siguiente'}
              </span>
            </Button>

            <div className="flex items-center gap-2">
              {responsePreview.iteration && responsePreview.iteration.total > 1 && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'continue_node' }))}
                  className="flex-1 text-xs h-8 gap-1 font-medium border-border hover:bg-bg text-fg"
                  title="Enviar todas las peticiones restantes de este nodo sin pausar"
                >
                  <FastForward size={13} className="text-accent" />
                  <span>Enviar restantes ({responsePreview.iteration.total - responsePreview.iteration.current})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
                className={cn("text-xs h-8 gap-1 font-medium", responsePreview.iteration && responsePreview.iteration.total > 1 ? "flex-1" : "w-full")}
                title="Continuar ejecución completa del flujo"
              >
                <PlayCircle size={13} />
                <span>Continuar todo</span>
              </Button>
            </div>
          </div>
        ) : requestPreview ? (
          <div className="space-y-1.5 pt-1 border-t border-border">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
              className="w-full text-xs h-8 gap-1.5 font-medium border-border hover:bg-bg text-fg"
              title="Enviar esta petición y pausar al recibir respuesta"
            >
              <Send size={13} className="text-accent" />
              <span>
                {requestPreview.iteration && requestPreview.iteration.total > 1
                  ? `Enviar petición (${requestPreview.iteration.current}/${requestPreview.iteration.total})`
                  : 'Enviar petición'}
              </span>
            </Button>

            <div className="flex items-center gap-2">
              {requestPreview.iteration && requestPreview.iteration.total > 1 && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'continue_node' }))}
                  className="flex-1 text-xs h-8 gap-1 font-medium border-border hover:bg-bg text-fg"
                  title="Enviar todas las peticiones restantes de este nodo sin pausar"
                >
                  <FastForward size={13} className="text-accent" />
                  <span>Enviar todas ({requestPreview.iteration.total - requestPreview.iteration.current + 1})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
                className={cn("text-xs h-8 gap-1 font-medium", requestPreview.iteration && requestPreview.iteration.total > 1 ? "flex-1" : "w-full")}
                title="Continuar ejecución completa del flujo"
              >
                <PlayCircle size={13} />
                <span>Continuar todo</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
              className="flex-1 text-xs h-8 gap-1.5 font-medium border-border hover:bg-bg text-fg"
              title="Ejecutar solo este nodo"
            >
              <StepForward size={13} className="text-accent" />
              <span>Paso siguiente</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => dispatch(resumeDebugNode({ id: flowId, action: 'continue' }))}
              className="flex-1 text-xs h-8 gap-1.5 font-medium"
              title="Continuar ejecución completa del flujo"
            >
              <PlayCircle size={13} />
              <span>Continuar</span>
            </Button>
          </div>
        )}
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
                    {responsePreview && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-600 font-semibold px-2 py-0.5 rounded border border-emerald-500/20">
                        Respuesta {responsePreview.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {responsePreview
                      ? 'Inspecciona la petición saliente, la respuesta del servicio y los datos de entrada'
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
                      activeTab === 'request' ? (formattedRequestBody || requestPreview?.endpoint) :
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

            {/* Main Tabs Navigation */}
            <div className="px-4 bg-bg border-b border-border flex items-center gap-2">
              {requestPreview && (
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
                    requestPreview.method === 'GET' ? "bg-blue-500/10 text-blue-600" :
                    requestPreview.method === 'POST' ? "bg-emerald-500/10 text-emerald-600" :
                    "bg-amber-500/10 text-amber-600"
                  )}>
                    {requestPreview.method}
                  </span>
                </button>
              )}

              {responsePreview && (
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
                  <CornerDownRight size={14} />
                  <span>Respuesta del Servidor</span>
                  <span className={cn(
                    "text-[10px] font-mono px-1.5 py-0.2 rounded font-bold",
                    responsePreview.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  )}>
                    {responsePreview.status}
                  </span>
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
            {activeTab === 'request' && requestPreview && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
                {/* Endpoint & Method Bar */}
                <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg">Destino de la Petición</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(requestPreview.endpoint)}
                      className="text-xs text-muted hover:text-fg px-2 py-0.5 rounded border border-border hover:bg-bg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Copy size={12} />
                      <span>{copied ? 'Copiado' : 'Copiar URL completa'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-bold font-mono uppercase shrink-0",
                      requestPreview.method === 'GET' ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" :
                      requestPreview.method === 'POST' ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                      "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                    )}>
                      {requestPreview.method}
                    </span>
                    <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text break-all flex-1">
                      {requestPreview.endpoint}
                    </div>
                  </div>
                </div>

                {/* Headers & Query Parameters Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Headers */}
                  <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg">Encabezados (Headers)</span>
                      {requestPreview.headers && (
                        <span className="text-[10px] font-mono text-muted">
                          {Object.keys(requestPreview.headers).length} encabezados
                        </span>
                      )}
                    </div>
                    {requestPreview.headers && Object.keys(requestPreview.headers).length > 0 ? (
                      <div className="bg-bg rounded border border-border overflow-hidden">
                        <table className="w-full text-left text-xs font-mono">
                          <tbody>
                            {Object.entries(requestPreview.headers).map(([k, v]) => (
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
                        {requestPreview.params ? 'Parámetros Query' : 'Contexto de Origen'}
                      </span>
                      {requestPreview.iteration && (
                        <span className="text-[10px] font-mono text-accent">
                          Iteración {requestPreview.iteration.current} de {requestPreview.iteration.total}
                        </span>
                      )}
                    </div>
                    {requestPreview.params ? (
                      <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text leading-relaxed">
                        {typeof requestPreview.params === 'string' ? requestPreview.params : JSON.stringify(requestPreview.params, null, 2)}
                      </div>
                    ) : requestPreview.item ? (
                      <div className="p-2 bg-bg rounded border border-border font-mono text-xs text-fg select-text leading-relaxed max-h-36 overflow-y-auto">
                        <pre className="text-xs">{JSON.stringify(requestPreview.item, null, 2)}</pre>
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

            {/* TAB 2: SERVER RESPONSE (Status, Headers, Body) */}
            {activeTab === 'response' && responsePreview && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
                {/* Status Bar */}
                <div className="p-3 bg-surface rounded-md border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "px-2.5 py-1 rounded text-xs font-bold font-mono",
                      responsePreview.ok
                        ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                    )}>
                      {responsePreview.status} {responsePreview.statusText || (responsePreview.ok ? 'OK' : 'Error')}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-muted font-mono">
                      <Clock size={13} />
                      <span>Tiempo de respuesta: <strong>{responsePreview.durationMs} ms</strong></span>
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
                {responsePreview.headers && Object.keys(responsePreview.headers).length > 0 && (
                  <div className="p-3 bg-surface rounded-md border border-border space-y-2">
                    <span className="text-xs font-semibold text-fg">Encabezados de Respuesta</span>
                    <div className="bg-bg rounded border border-border overflow-hidden max-h-40 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <tbody>
                          {Object.entries(responsePreview.headers).map(([k, v]) => (
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
                      {renderStructuredData(responsePreview.data, 'response')}
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
              <div className="text-xs text-muted">
                Nodo actual: <strong className="text-fg">{(node.data?.label as string) || node.type}</strong> • Estado:{' '}
                <strong className={responsePreview ? "text-emerald-600" : "text-amber-600"}>
                  {responsePreview ? 'Respuesta recibida' : 'Pausado'}
                </strong>
                {currentIteration && (
                  <span className="ml-2 font-mono text-accent">
                    (Petición {currentIteration.current}/{currentIteration.total})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }));
                    setIsModalOpen(false);
                  }}
                  className="gap-2"
                >
                  <StepForward size={14} className="text-accent" />
                  <span>
                    {responsePreview
                      ? (currentIteration && currentIteration.total > 1 ? `Siguiente (${currentIteration.current}/${currentIteration.total})` : 'Paso siguiente')
                      : requestPreview
                        ? 'Enviar esta petición'
                        : 'Paso siguiente'}
                  </span>
                </Button>

                {currentIteration && currentIteration.total > 1 && (
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
                    <span>Enviar todas ({currentIteration.total - currentIteration.current + 1})</span>
                  </Button>
                )}

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    dispatch(resumeDebugNode({ id: flowId, action: 'continue' }));
                    setIsModalOpen(false);
                  }}
                  className="gap-2"
                >
                  <PlayCircle size={14} />
                  <span>Continuar todo</span>
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
