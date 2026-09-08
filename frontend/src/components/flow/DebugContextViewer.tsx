import React, { useState, useMemo } from 'react';
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
  FileSpreadsheet,
  Layers,
  FastForward,
  Globe
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

interface DebugContextViewerProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  flowId: string;
  context: Record<string, any>;
  requestPreview?: HttpRequestPreview | null;
}

export function DebugContextViewer({
  node,
  nodes,
  edges,
  flowId,
  context,
  requestPreview
}: DebugContextViewerProps) {
  const dispatch = useAppDispatch();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

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
      .filter(n => ancestorIds.has(n.id) && context[n.id] !== undefined && n.type !== 'start')
      .map(n => ({
        id: n.id,
        label: (n.data?.label as string) || n.type,
        type: n.type,
        data: context[n.id]
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

  const activeData = useMemo(() => {
    if (!context || !activeSourceId) return null;
    return context[activeSourceId];
  }, [context, activeSourceId]);

  // Detect if active data is tabular (array of objects)
  const isTabular = useMemo(() => {
    let candidate = activeData;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (Array.isArray(candidate.data)) candidate = candidate.data;
      else if (Array.isArray(candidate.rows)) candidate = candidate.rows;
      else if (Array.isArray(candidate.items)) candidate = candidate.items;
      else if (Array.isArray(candidate.result)) candidate = candidate.result;
    }
    return Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === 'object' && candidate[0] !== null;
  }, [activeData]);

  const [viewMode, setViewMode] = useState<'table' | 'structured' | 'raw'>('table');

  React.useEffect(() => {
    setViewMode(isTabular ? 'table' : 'structured');
  }, [isTabular, activeSourceId]);

  const tabularRows = useMemo(() => {
    if (!isTabular) return [];
    let candidate = activeData;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (Array.isArray(candidate.data)) candidate = candidate.data;
      else if (Array.isArray(candidate.rows)) candidate = candidate.rows;
      else if (Array.isArray(candidate.items)) candidate = candidate.items;
      else if (Array.isArray(candidate.result)) candidate = candidate.result;
    }
    return Array.isArray(candidate) ? candidate : [];
  }, [activeData, isTabular]);

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

  const handleCopyJson = () => {
    if (!activeData) return;
    navigator.clipboard.writeText(JSON.stringify(activeData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCollapse = (path: string) => {
    setCollapsedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const activeSourceInfo = upstreamAncestorNodes.find(n => n.id === activeSourceId);
  const totalItemsCount = isTabular
    ? tabularRows.length
    : activeData && typeof activeData === 'object'
      ? Object.keys(activeData).length
      : 0;

  // Clean, native theme structured data renderer for the modal
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
      return <span className="font-mono text-xs text-success break-all">"{val}"</span>;
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
            className="flex items-center gap-1.5 text-xs font-mono text-fg hover:text-accent font-medium select-none bg-bg hover:bg-surface px-2 py-0.5 rounded border border-border transition-colors"
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

  return (
    <>
      {/* Sleek, Integrated Sidebar Card (no squashed preview box) */}
      <div className="rounded-md border border-border bg-surface p-3 space-y-3 shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20">
              <Pause size={12} className="fill-amber-600" />
            </div>
            <div>
              <div className="text-xs font-semibold text-fg flex items-center gap-1.5">
                <span>Modo Depuración</span>
                <span className="text-[10px] bg-amber-500/10 text-amber-700 font-medium px-1.5 py-0.2 rounded border border-amber-500/20">
                  Pausado
                </span>
              </div>
            </div>
          </div>
          {requestPreview?.iteration && (
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-bg text-accent border border-border">
              {requestPreview.iteration.total > 1
                ? `${requestPreview.iteration.current} de ${requestPreview.iteration.total}`
                : 'Petición 1/1'}
            </span>
          )}
        </div>

        {/* HTTP Request Details if paused on an HTTP request */}
        {requestPreview && (
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
              <span className="text-[11px] font-mono text-muted">
                {isTabular ? `${tabularRows.length} registros` : 'Datos disponibles'}
              </span>
            </div>
          )}
        </div>

        {/* Clean inspection trigger button */}
        {upstreamAncestorNodes.length > 0 && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="w-full gap-2 text-xs h-8 bg-surface border-border hover:bg-bg text-fg font-medium"
          >
            <Eye size={14} className="text-accent" />
            <span>
              {isTabular
                ? `Ver datos recibidos (${tabularRows.length})`
                : 'Ver datos recibidos'}
            </span>
          </Button>
        )}

        {/* Step execution buttons */}
        {requestPreview ? (
          <div className="space-y-1.5 pt-1 border-t border-border">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => dispatch(resumeDebugNode({ id: flowId, nodeId: node.id, action: 'step_over' }))}
              className="w-full text-xs h-8 gap-1.5 font-medium border-border hover:bg-bg text-fg"
              title="Enviar esta petición y pausar en la siguiente"
            >
              <StepForward size={13} className="text-accent" />
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

      {/* Spacious, Beautiful Inspection Modal when User Clicks */}
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
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Datos recopilados por los nodos anteriores en esta rama antes de ejecutar este nodo
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleCopyJson}
                  className="gap-1.5 text-xs h-8"
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  <span>{copied ? 'Copiado al portapapeles' : 'Copiar JSON'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 hover:bg-muted rounded-md text-muted hover:text-fg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* HTTP Request Banner in Modal */}
            {requestPreview && (
              <div className="p-3 bg-bg/90 border-b border-border flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "px-2 py-0.5 rounded font-mono font-bold uppercase shrink-0 text-[10px]",
                    requestPreview.method === 'GET' ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" :
                    requestPreview.method === 'POST' ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                    "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                  )}>
                    {requestPreview.method}
                  </span>
                  <span className="font-mono text-fg text-xs truncate select-text">{requestPreview.endpoint}</span>
                </div>
                {requestPreview.iteration && (
                  <span className="text-[11px] font-mono text-muted shrink-0">
                    Petición {requestPreview.iteration.current} de {requestPreview.iteration.total}
                  </span>
                )}
              </div>
            )}

            {/* Modal Controls Bar */}
            <div className="p-3 bg-surface border-b border-border flex flex-wrap items-center justify-between gap-3">
              {/* Ancestor source pills (only shown if there are multiple ancestors in this branch) */}
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
                    placeholder="Buscar registros o campos..."
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
                  {isTabular && (
                    <button
                      type="button"
                      onClick={() => setViewMode('table')}
                      className={cn(
                        "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                        viewMode === 'table' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                      )}
                    >
                      <TableIcon size={13} className="inline mr-1.5" />
                      Vista Tabla ({tabularRows.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setViewMode('structured')}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      viewMode === 'structured' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                    )}
                  >
                    <Code2 size={13} className="inline mr-1.5" />
                    Árbol
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('raw')}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      viewMode === 'raw' ? "bg-surface shadow-xs text-fg font-semibold" : "text-muted hover:text-fg"
                    )}
                  >
                    JSON
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-4 bg-bg/20">
              {activeData === undefined || activeData === null ? (
                <div className="h-full flex items-center justify-center text-muted italic">
                  No hay datos disponibles en esta rama.
                </div>
              ) : viewMode === 'raw' ? (
                <pre className="p-4 bg-surface text-fg rounded-md font-mono text-xs leading-relaxed overflow-x-auto border border-border select-text">
                  {JSON.stringify(activeData, null, 2)}
                </pre>
              ) : viewMode === 'table' && isTabular ? (
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

                  <div className="p-3 bg-bg border-t border-border flex items-center justify-between text-xs text-muted">
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
                  {renderStructuredData(activeData, 'data')}
                </div>
              )}
            </div>

            {/* Modal Step Actions Footer */}
            <div className="p-3 bg-surface border-t border-border flex items-center justify-between">
              <div className="text-xs text-muted">
                Nodo actual: <strong className="text-fg">{(node.data?.label as string) || node.type}</strong> • Estado: <strong>Pausado</strong>
                {requestPreview?.iteration && (
                  <span className="ml-2 font-mono text-accent">
                    (Petición {requestPreview.iteration.current}/{requestPreview.iteration.total})
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
                    {requestPreview ? 'Enviar esta petición' : 'Paso siguiente'}
                  </span>
                </Button>

                {requestPreview?.iteration && requestPreview.iteration.total > 1 && (
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
                    <span>Enviar todas ({requestPreview.iteration.total - requestPreview.iteration.current + 1})</span>
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
