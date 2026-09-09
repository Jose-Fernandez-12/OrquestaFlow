import React, { useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { JsonTreeViewer } from './JsonTreeViewer';
import { X, ChevronDown, ChevronRight, Clock, FileSpreadsheet, Upload, Eye, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Node, Edge } from '@xyflow/react';
import { useAppSelector } from '../../store/hooks';

const isDataProducerNode = (type?: string) => {
  if (!type) return false;
  return type.startsWith('http') || type === 'query' || type === 'dataSource' || type === 'fileSource';
};

const getUpstreamNodes = (node: Node, edges: Edge[] = [], nodes: Node[] = []): Node[] => {
  const visited = new Set<string>();

  function findProducers(targetId: string): Node[] {
    if (visited.has(targetId)) return [];
    visited.add(targetId);

    const producers: Node[] = [];
    const incomingEdges = edges.filter(e => e.target === targetId);

    for (const edge of incomingEdges) {
      const srcNode = nodes.find(n => n.id === edge.source);
      if (!srcNode) continue;

      if (srcNode.type === 'timer' || srcNode.type === 'delay') {
        // Transparent passthrough: jump over timer/delay nodes to find the real producers
        producers.push(...findProducers(srcNode.id));
      } else if (isDataProducerNode(srcNode.type)) {
        producers.push(srcNode);
      }
    }

    return producers;
  }

  const directProducers = findProducers(node.id);
  if (directProducers.length > 0) {
    return Array.from(new Map(directProducers.map(n => [n.id, n])).values());
  }

  // Fallback: in case the edge was connected in reverse
  const revVisited = new Set<string>();
  function findReverseProducers(sourceId: string): Node[] {
    if (revVisited.has(sourceId)) return [];
    revVisited.add(sourceId);

    const producers: Node[] = [];
    const outgoingEdges = edges.filter(e => e.source === sourceId);

    for (const edge of outgoingEdges) {
      const tgtNode = nodes.find(n => n.id === edge.target);
      if (!tgtNode) continue;

      if (tgtNode.type === 'timer' || tgtNode.type === 'delay') {
        producers.push(...findReverseProducers(tgtNode.id));
      } else if (isDataProducerNode(tgtNode.type)) {
        producers.push(tgtNode);
      }
    }
    return producers;
  }

  const revProducers = findReverseProducers(node.id);
  return Array.from(new Map(revProducers.map(n => [n.id, n])).values());
};

function DataSourceInspector({
  node,
  updateNodeData,
  nodes,
  edges
}: {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  nodes?: Node[];
  edges?: Edge[];
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const nodeResult = useAppSelector(state => (state as any).flows?.nodeResults?.[node.id]);

  const effectiveDataNodes = React.useMemo(() => {
    if (!edges || !nodes) return [];

    function resolveSources(targetId: string, viaPath: string[] = []): { node: Node; via?: string }[] {
      const incomingEdges = edges!.filter(e => e.target === targetId);
      const res: { node: Node; via?: string }[] = [];

      for (const edge of incomingEdges) {
        const srcNode = nodes!.find(n => n.id === edge.source);
        if (!srcNode) continue;

        if (srcNode.type === 'timer' || srcNode.type === 'delay') {
          const timerLabel = (srcNode.data?.label as string) || 'Temporizador';
          const up = resolveSources(srcNode.id, [...viaPath, timerLabel]);
          res.push(...up);
        } else if (srcNode.type !== 'start') {
          res.push({
            node: srcNode,
            via: viaPath.length > 0 ? `vía ${viaPath.join(' -> ')}` : undefined
          });
        }
      }
      return res;
    }

    const list = resolveSources(node.id);
    const seen = new Set<string>();
    return list.filter(item => {
      if (seen.has(item.node.id)) return false;
      seen.add(item.node.id);
      return true;
    });
  }, [edges, nodes, node.id]);

  const mergedRows = Array.isArray(nodeResult) ? nodeResult : [];
  const mergedColumns = React.useMemo(() => {
    if (mergedRows.length > 0 && typeof mergedRows[0] === 'object' && mergedRows[0] !== null) {
      return Object.keys(mergedRows[0]);
    }
    return [];
  }, [mergedRows]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setIsUploading(true);
    setUploadError(null);

    try {
      const res = await fetch('http://localhost:3001/api/file-manager/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Error al subir el archivo');
      }

      const resJson = await res.json();
      const uploaded = resJson.data;

      updateNodeData('filePath', uploaded.filePath);
      updateNodeData('fileName', uploaded.originalName);
      updateNodeData('format', uploaded.format);
      updateNodeData('columns', uploaded.columns);
      updateNodeData('totalRows', uploaded.totalRows);
      updateNodeData('sheets', uploaded.sheets);
      updateNodeData('sampleRows', uploaded.sampleRows);
      if (uploaded.sheets && uploaded.sheets.length > 0) {
        updateNodeData('sheetName', uploaded.sheets[0]);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Error al procesar el archivo');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fileName = node.data?.fileName as string;
  const format = node.data?.format as string;
  const columns = (node.data?.columns as string[]) || [];
  const sheets = (node.data?.sheets as string[]) || [];
  const totalRows = (node.data?.totalRows as number) || 0;
  const sampleRows = (node.data?.sampleRows as any[]) || [];

  const mode = (node.data?.mode as string) || 'file'; // 'file' or 'merge'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Origen de Datos</label>
        <select
          className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
          value={mode}
          onChange={(e) => updateNodeData('mode', e.target.value)}
        >
          <option value="file">Subir Archivo (Excel/CSV)</option>
          <option value="merge">Unir Nodos Anteriores (Merge)</option>
        </select>
      </div>

      {mode === 'file' ? (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Archivo origen</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div
              onClick={() => !isUploading && fileInputRef.current?.click()}
              className="border-2 border-dashed border-border hover:border-accent/60 rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-bg/40 hover:bg-bg transition-colors text-center"
            >
              {isUploading ? (
                <>
                  <Loader2 size={22} className="animate-spin text-accent" />
                  <span className="text-xs text-muted">Procesando y analizando archivo...</span>
                </>
              ) : (
                <>
                  <div className="w-9 h-9 rounded-full bg-accent/10 text-accent flex items-center justify-center">
                    <Upload size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-fg">
                      {fileName ? 'Reemplazar archivo' : 'Cargar archivo Excel o CSV'}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5">
                      Formatos soportados: .xlsx, .xls, .csv
                    </p>
                  </div>
                </>
              )}
            </div>
            {uploadError && (
              <p className="text-[11px] text-danger mt-1">{uploadError}</p>
            )}
          </div>

          {fileName && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="bg-bg p-3 rounded-md border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fg truncate max-w-[180px]" title={fileName}>
                    {fileName}
                  </span>
                  <span className="text-[10px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded font-semibold">
                    {format}
                  </span>
                </div>

                <div className="text-[11px] text-muted">
                  Filas detectadas: <strong className="text-fg">{totalRows.toLocaleString()}</strong>
                </div>

                {sheets.length > 1 && (
                  <div className="space-y-1 pt-1">
                    <label className="text-[10px] font-medium text-muted">Hoja de cálculo</label>
                    <select
                      className="w-full text-xs h-8 border border-border bg-surface rounded px-2"
                      value={(node.data?.sheetName as string) || sheets[0]}
                      onChange={(e) => updateNodeData('sheetName', e.target.value)}
                    >
                      {sheets.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}

                <Button
                  variant="default"
                  size="sm"
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('preview-data-source-node', {
                        detail: {
                          id: node.id,
                          label: (node.data?.label as string) || 'Obtener datos',
                          filePath: node.data?.filePath,
                          fileName: node.data?.fileName,
                          format: node.data?.format,
                          sheetName: node.data?.sheetName,
                          sheets: node.data?.sheets,
                          sampleRows: node.data?.sampleRows,
                          totalRows: node.data?.totalRows,
                          completed: false
                        }
                      })
                    );
                  }}
                  className="w-full gap-2 text-xs h-8 bg-surface border-border hover:bg-bg mt-2 text-fg font-medium"
                >
                  <Eye size={14} className="text-emerald-600" />
                  <span>Previsualizar tabla de datos</span>
                </Button>
              </div>

              {columns.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium flex items-center justify-between">
                    <span>Columnas extraídas ({columns.length})</span>
                    {sampleRows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowSample(!showSample)}
                        className="text-[10px] text-accent hover:underline font-medium"
                      >
                        {showSample ? 'Ocultar muestra' : 'Ver muestra'}
                      </button>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 bg-bg rounded border border-border">
                    {columns.map(col => (
                      <span
                        key={col}
                        className="text-[10px] font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-fg"
                      >
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {showSample && sampleRows.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted">Primeras filas (muestra)</label>
                  <div className="border border-border rounded overflow-x-auto max-h-40 text-[10px] font-mono bg-surface">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-bg border-b border-border">
                        <tr>
                          {columns.slice(0, 5).map(c => (
                            <th key={c} className="p-1 border-r border-border last:border-r-0 whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sampleRows.map((r, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            {columns.slice(0, 5).map(c => (
                              <td key={c} className="p-1 border-r border-border last:border-r-0 whitespace-nowrap truncate max-w-[100px]">
                                {String(r[c] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-md text-emerald-800">
            <p className="text-xs font-semibold mb-1 flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs">⚑</span>
              Modo Unificador (Merge)
            </p>
            <p className="text-[11px] leading-relaxed opacity-90">
              Este nodo unifica y cruza automáticamente los datos devueltos por los nodos conectados a su entrada.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-fg">
              Orígenes de datos a unificar ({effectiveDataNodes.length})
            </label>
            {effectiveDataNodes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 p-2 bg-bg rounded border border-border">
                {effectiveDataNodes.map(({ node: up, via }) => (
                  <span
                    key={up.id}
                    className="text-[11px] font-mono bg-surface border border-border px-2 py-1 rounded text-fg flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                    <span>{(up.data?.label as string) || up.type}</span>
                    {via && (
                      <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1 py-0.2 rounded font-sans">
                        {via}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted p-2.5 bg-bg/50 border border-border border-dashed rounded text-center">
                Conecta al menos un nodo de datos (ej. Consulta o HTTP) a la entrada de este nodo.
              </div>
            )}
          </div>

          {mergedRows.length > 0 ? (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {mergedRows.length} registros • {mergedColumns.length} columnas
                </span>
                <span className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono px-1.5 py-0.5 rounded font-semibold">
                  Unificado
                </span>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('preview-data-source-node', {
                      detail: {
                        id: node.id,
                        label: node.data?.label || 'Obtener datos',
                        format: 'Unificado',
                        result: nodeResult,
                        totalRows: mergedRows.length,
                        completed: true
                      }
                    })
                  );
                }}
                className="w-full gap-2 text-xs h-8 bg-surface border-border hover:bg-bg text-fg font-medium"
              >
                <Eye size={14} className="text-emerald-600" />
                <span>Previsualizar tabla de datos unificados</span>
              </Button>

              {mergedColumns.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium flex items-center justify-between">
                    <span>Columnas unificadas ({mergedColumns.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowSample(!showSample)}
                      className="text-[10px] text-accent hover:underline font-medium"
                    >
                      {showSample ? 'Ocultar muestra' : 'Ver muestra'}
                    </button>
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 bg-bg rounded border border-border">
                    {mergedColumns.map(col => (
                      <span
                        key={col}
                        className="text-[10px] font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-fg"
                      >
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {showSample && mergedRows.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted">Primeras filas (muestra)</label>
                  <div className="border border-border rounded overflow-x-auto max-h-40 text-[10px] font-mono bg-surface">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-bg border-b border-border">
                        <tr>
                          {mergedColumns.slice(0, 5).map(c => (
                            <th key={c} className="p-1 border-r border-border last:border-r-0 whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {mergedRows.slice(0, 3).map((r, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            {mergedColumns.slice(0, 5).map(c => (
                              <td key={c} className="p-1 border-r border-border last:border-r-0 whitespace-nowrap truncate max-w-[100px]">
                                {typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : String(r[c] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted p-2.5 bg-bg/50 border border-border rounded text-center">
              Haz clic en <strong>Ejecutar Flujo</strong> para procesar y ver los datos unificados aquí.
            </div>
          )}

          <div className="p-2.5 bg-bg border border-border rounded text-[11px] text-muted space-y-1">
            <p>
              💡 Puedes referenciar este nodo unificador usando <code>{`{{${node.id}}}`}</code> en otros nodos (ej. "Iterar Sobre" de HTTP o en un nodo de Exportar).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

      interface NodeInspectorProps {
        nodes: Node[];
      setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
        edges: Edge[];
        selectedNodeId: string;
}

        export function NodeInspector({nodes, setNodes, edges, selectedNodeId}: NodeInspectorProps) {
  const queries = useAppSelector(state => state.queries.queries);
  const node = nodes.find(n => n.id === selectedNodeId);
  const selectedNodeResult = useAppSelector(state => (state as any).flows?.nodeResults?.[selectedNodeId]);

  const upstreamDataNodes = React.useMemo(() => {
    if (!node) return [];
    return getUpstreamNodes(node, edges, nodes);
  }, [node, edges, nodes]);

  const detectedResponseKeys = React.useMemo(() => {
    if (!selectedNodeResult) return [];
    let sample = selectedNodeResult;
    if (Array.isArray(sample) && sample.length > 0) {
      sample = sample[0];
    }
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      return Object.keys(sample);
    }
    return [];
  }, [selectedNodeResult]);
  
  const selectedQuery = queries.find(q => q.id === (node?.data?.queryId as string));
  
  const detectedParams = React.useMemo(() => {
    if (!selectedQuery?.sql_text) return [];
        const regex = /(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
          const params = new Set<string>();
            let match;
            while ((match = regex.exec(selectedQuery.sql_text)) !== null) {
              params.add(match[1]);
    }
            return Array.from(params);
  }, [selectedQuery]);

  const currentParamsObj = React.useMemo(() => {
    try {
      return JSON.parse((node?.data?.queryParams as string) || '{ }');
    } catch {
      return { };
    }
  }, [node?.data?.queryParams]);
  
  const updateNodeData = (key: string, value: any) => {
              setNodes(nds =>
                nds.map(n => {
                  if (n.id === selectedNodeId) {
                    return { ...n, data: { ...n.data, [key]: value } };
                  }
                  return n;
                })
              );
  };

            if (!node) {
    return (
            <div className="w-[380px] bg-surface border-l border-border flex flex-col p-4 z-10 shrink-0">
              Nodo no encontrado
            </div>
            );
  }

            return (
            <div className="w-[380px] bg-surface border-l border-border flex flex-col h-full z-10 shrink-0">
              <div className="p-4 border-b border-border font-medium flex items-center justify-between">
                Configuración
                <span className="text-xs text-muted px-2 py-1 bg-bg rounded-sm font-mono">{node.type || 'unknown'}</span>
              </div>
              <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Etiqueta del nodo</label>
                  <Input
                    value={node.data?.label as string || ''}
                    onChange={(e) => updateNodeData('label', e.target.value)}
                  />
                </div>

                {node.type?.startsWith('http') && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Método</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                        value={node.data?.method as string || 'GET'}
                        onChange={(e) => updateNodeData('method', e.target.value)}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-border mt-3">
                      <label className="text-xs font-medium">Autenticación</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                        value={node.data?.authType as string || 'none'}
                        onChange={(e) => updateNodeData('authType', e.target.value)}
                      >
                        <option value="none">Sin Autenticación</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="basic">Basic Auth</option>
                      </select>

                      {node.data?.authType === 'bearer' && (
                        <div className="mt-2 space-y-1 bg-bg/50 p-2.5 rounded-sm border border-border">
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] font-medium text-accent">Token (Bearer)</label>
                            <div className="flex gap-1">
                              {upstreamDataNodes.map(upNode => (
                                <JsonSelectorTrigger
                                  key={upNode!.id}
                                  node={upNode}
                                  customLabel={`Mapear`}
                                  onSelectValue={(val) => updateNodeData('authToken', val)}
                                />
                              ))}
                            </div>
                          </div>
                          <Input
                            className="h-8 text-xs font-mono"
                            value={node.data?.authToken as string || ''}
                            onChange={(e) => updateNodeData('authToken', e.target.value)}
                            placeholder="Token fijo o {{nodo_login.data.access_token}}"
                          />
                          <p className="text-[10px] text-muted">Se enviará como <code>Authorization: Bearer ...</code></p>
                        </div>
                      )}

                      {node.data?.authType === 'basic' && (
                        <div className="mt-2 space-y-2 bg-bg/50 p-2.5 rounded-sm border border-border">
                          <div className="space-y-1">
                            <div className="flex justify-between items-center">
                              <label className="text-[11px] font-medium text-accent">Usuario</label>
                              <div className="flex gap-1">
                                {upstreamDataNodes.map(upNode => (
                                  <JsonSelectorTrigger
                                    key={upNode!.id}
                                    node={upNode}
                                    customLabel={`Mapear`}
                                    onSelectValue={(val) => updateNodeData('authUsername', val)}
                                  />
                                ))}
                              </div>
                            </div>
                            <Input
                              className="h-7 text-xs font-mono"
                              value={node.data?.authUsername as string || ''}
                              onChange={(e) => updateNodeData('authUsername', e.target.value)}
                              placeholder="Usuario o {{nodo.user}}"
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between items-center">
                              <label className="text-[11px] font-medium text-accent">Contraseña</label>
                              <div className="flex gap-1">
                                {upstreamDataNodes.map(upNode => (
                                  <JsonSelectorTrigger
                                    key={upNode!.id}
                                    node={upNode}
                                    customLabel={`Mapear`}
                                    onSelectValue={(val) => updateNodeData('authPassword', val)}
                                  />
                                ))}
                              </div>
                            </div>
                            <Input
                              type="password"
                              className="h-7 text-xs font-mono"
                              value={node.data?.authPassword as string || ''}
                              onChange={(e) => updateNodeData('authPassword', e.target.value)}
                              placeholder="Contraseña o {{nodo.pass}}"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-border mt-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="iterateMode"
                          className="w-3.5 h-3.5 accent-accent"
                          checked={node.data?.iterateMode as boolean || false}
                          onChange={(e) => updateNodeData('iterateMode', e.target.checked)}
                        />
                        <label htmlFor="iterateMode" className="text-xs font-medium cursor-pointer">
                          Modo Iteración (Batch)
                        </label>
                      </div>
                      {Boolean(node.data?.iterateMode) && (
                        <div className="mt-2 pl-5 space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground block">Array base a iterar</label>
                          <div className="flex gap-1">
                            <Input
                              className="h-8 text-xs font-mono"
                              value={node.data?.iterateOver as string || ''}
                              onChange={(e) => updateNodeData('iterateOver', e.target.value)}
                              placeholder="{{ID_NODO}}"
                            />
                            {upstreamDataNodes.map(upNode => (
                              <JsonSelectorTrigger key={upNode!.id} node={upNode} customLabel={`Mapear`} onSelectValue={(val) => updateNodeData('iterateOver', val)} />
                            ))}
                          </div>
                          <p className="text-[10px] text-muted">Extrae la lista completa con [*] y luego usa {'{{_item.propiedad}}'} en los demás campos.</p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-medium">Endpoint URL</label>
                        <div className="flex gap-1">
                          {upstreamDataNodes.map(upNode => (
                            <JsonSelectorTrigger key={upNode!.id} node={upNode} customLabel={`Mapear`} onSelectValue={(val) => updateNodeData('endpoint', ((node.data?.endpoint as string) || '') + val)} />
                          ))}
                        </div>
                      </div>
                      <Input
                        value={node.data?.endpoint as string || ''}
                        onChange={(e) => {
                          const newUrl = e.target.value;
                          if (newUrl.includes('?')) {
                            const qIndex = newUrl.indexOf('?');
                            const baseUrl = newUrl.substring(0, qIndex);
                            const queryString = newUrl.substring(qIndex + 1);

                            const searchParams = new URLSearchParams(queryString);
                            let existingParamsObj: Record<string, any> = {};
                            try {
                              if (node.data?.params) {
                                existingParamsObj = JSON.parse(node.data.params as string);
                              }
                            } catch { }

                            const newParamsObj = { ...existingParamsObj };
                            searchParams.forEach((value, key) => {
                              newParamsObj[key] = value;
                            });

                            setNodes(nds =>
                              nds.map(n => {
                                if (n.id === selectedNodeId) {
                                  return {
                                    ...n,
                                    data: {
                                      ...n.data,
                                      endpoint: baseUrl,
                                      params: JSON.stringify(newParamsObj, null, 2)
                                    }
                                  };
                                }
                                return n;
                              })
                            );
                          } else {
                            updateNodeData('endpoint', newUrl);
                          }
                        }}
                        placeholder="https://api.example.com/v1/users/{{start.data.id}}"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-medium">Headers (JSON)</label>
                        <div className="flex gap-1">
                          {upstreamDataNodes.map(upNode => (
                            <JsonSelectorTrigger key={upNode!.id} node={upNode} customLabel={`Mapear`} onSelectValue={(val) => updateNodeData('headers', ((node.data?.headers as string) || '') + val)} />
                          ))}
                        </div>
                      </div>
                      <textarea
                        className="flex w-full min-h-[60px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                        value={node.data?.headers as string || '{\n  "Content-Type": "application/json"\n}'}
                        onChange={(e) => updateNodeData('headers', e.target.value)}
                        placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                      />
                    </div>

                    <HttpParamsEditor
                      paramsJson={node.data?.params as string || ''}
                      onChange={(newParamsJson) => updateNodeData('params', newParamsJson)}
                      node={node}
                      edges={edges}
                      nodes={nodes}
                    />

                    {['POST', 'PUT', 'PATCH'].includes((node.data?.method as string) || 'GET') && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-medium">Body / Payload (JSON)</label>
                          <div className="flex gap-1">
                            {upstreamDataNodes.map(upNode => (
                              <JsonSelectorTrigger key={upNode!.id} node={upNode} customLabel={`Mapear`} onSelectValue={(val) => updateNodeData('body', ((node.data?.body as string) || '') + val)} />
                            ))}
                          </div>
                        </div>
                        <textarea
                          className="flex w-full min-h-[100px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                          value={node.data?.body as string || ''}
                          onChange={(e) => updateNodeData('body', e.target.value)}
                          placeholder={'{\n  "id": "{{start.data.id}}"\n}'}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Formato de respuesta</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                        value={node.data?.responseFormat as string || 'JSON'}
                        onChange={(e) => updateNodeData('responseFormat', e.target.value)}
                      >
                        <option value="JSON">JSON</option>
                        <option value="XML">XML</option>
                        <option value="Text">Texto plano</option>
                      </select>
                    </div>
                    
                    {((node.data?.responseFormat as string) || 'JSON') === 'JSON' && (
                      <div className="space-y-2 pt-2 border-t border-border mt-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-accent flex items-center gap-1.5">
                            Extraer Propiedad de Respuesta
                          </label>
                          {Boolean(node.data?.extractPath) && (
                            <button
                              type="button"
                              onClick={() => updateNodeData('extractPath', '')}
                              className="text-[10px] text-muted hover:text-red-500 font-mono underline"
                            >
                              Limpiar
                            </button>
                          )}
                        </div>

                        {/* Selector rápido de propiedad */}
                        <div className="space-y-1">
                          <select
                            className="flex w-full min-h-[36px] rounded-sm border border-border bg-surface px-[9px] py-[6px] text-xs focus-visible:outline-none focus-visible:border-accent"
                            value={
                              ['', 'data', 'items', 'rows', 'result', 'results'].includes((node.data?.extractPath as string) || '') ||
                              detectedResponseKeys.includes((node.data?.extractPath as string) || '')
                                ? ((node.data?.extractPath as string) || '')
                                : '__custom__'
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__custom__') {
                                if (!node.data?.extractPath) updateNodeData('extractPath', 'data');
                              } else {
                                updateNodeData('extractPath', val);
                              }
                            }}
                          >
                            <option value="">Respuesta completa (sin extraer)</option>
                            <option value="data">data (Recomendado para APIs con wrapper)</option>
                            <option value="items">items</option>
                            <option value="rows">rows</option>
                            <option value="result">result / results</option>
                            {detectedResponseKeys
                              .filter(k => !['data', 'items', 'rows', 'result', 'results'].includes(k))
                              .map(k => (
                                <option key={k} value={k}>
                                  {k} (Detectado en respuesta)
                                </option>
                              ))}
                            <option value="__custom__">Escribir JSON Path personalizado...</option>
                          </select>
                        </div>

                        {/* Si seleccionó custom o un path no estándar */}
                        {(
                          !['', 'data', 'items', 'rows', 'result', 'results'].includes((node.data?.extractPath as string) || '') &&
                          !detectedResponseKeys.includes((node.data?.extractPath as string) || '')
                        ) && (
                          <Input
                            className="h-8 text-xs font-mono bg-bg/50"
                            value={(node.data?.extractPath as string) || ''}
                            onChange={(e) => updateNodeData('extractPath', e.target.value)}
                            placeholder="ej. data.records o mi_propiedad"
                          />
                        )}

                        <p className="text-[10px] text-muted leading-relaxed">
                          Selecciona <strong>data</strong> para que el flujo reciba directamente los registros internos y no el envoltorio con <code>status</code>.
                        </p>
                      </div>
                    )}

                    {/* JSON Selector Modal Trigger */}
                    <div className="pt-2 border-t border-border mt-2">
                      <JsonSelectorTrigger node={node} customLabel="Probar Petición HTTP (Ejecutar)" />
                    </div>

                    {/* Render JSON Viewer for upstream HTTP/Query nodes to make mapping easier */}
                    {edges
                      .filter(e => e.target === node.id)
                      .map(e => nodes.find(n => n.id === e.source))
                      .filter(n => n && isDataProducerNode(n.type))
                      .map(upNode => (
                        <div key={upNode!.id} className="pt-2 border-t border-border mt-4">
                          <span className="text-[10px] text-muted block mb-1">Inspeccionar datos desde: {(upNode!.data?.label as string) || upNode!.type}</span>
                          <JsonSelectorTrigger node={upNode} customLabel={`Ver JSON de ${upNode!.data?.label as string || 'nodo anterior'}`} updateNodeData={updateNodeData} />
                        </div>
                      ))
                    }
                  </>
                )}

                {node.type === 'query' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Seleccionar Consulta</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                        value={node.data?.queryId as string || ''}
                        onChange={(e) => updateNodeData('queryId', e.target.value)}
                      >
                        <option value="">Seleccionar consulta...</option>
                        {queries.map(q => (
                          <option key={q.id} value={q.id}>{q.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Modo de extracción</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                        value={node.data?.extractMode as string || 'all'}
                        onChange={(e) => updateNodeData('extractMode', e.target.value)}
                      >
                        <option value="all">Todas las filas (Array)</option>
                        <option value="selected_columns">Solo columnas específicas</option>
                      </select>
                    </div>

                    {node.data?.extractMode === 'selected_columns' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Columnas (separadas por coma)</label>
                        <Input
                          placeholder="ej. codigo_eds, nombre_eds"
                          value={node.data?.extractColumns as string || ''}
                          onChange={(e) => updateNodeData('extractColumns', e.target.value)}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Mapeo de Parámetros</label>
                      {detectedParams.length > 0 ? (
                        <div className="space-y-2 border border-border rounded-sm p-3 bg-bg/50">
                          {detectedParams.map(param => (
                            <div key={param} className="flex flex-col gap-1">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-mono font-medium text-accent">#param_{param}</label>
                                <div className="flex gap-1">
                                  {edges
                                    .filter(e => e.target === node.id)
                                    .map(e => nodes.find(n => n.id === e.source))
                                    .filter(n => n && isDataProducerNode(n.type))
                                    .map(upNode => (
                                      <JsonSelectorTrigger
                                        key={upNode!.id}
                                        node={upNode}
                                        customLabel={`Mapear desde ${upNode!.data?.label || upNode!.type}`}
                                        onSelectValue={(val) => {
                                          const newParams = { ...currentParamsObj, [param]: val };
                                          updateNodeData('queryParams', JSON.stringify(newParams, null, 2));
                                        }}
                                      />
                                    ))
                                  }
                                </div>
                              </div>
                              <Input
                                className="h-7 text-xs font-mono"
                                placeholder="Valor fijo o {{ruta}}"
                                value={currentParamsObj[param] || ''}
                                onChange={(e) => {
                                  const newParams = { ...currentParamsObj, [param]: e.target.value };
                                  updateNodeData('queryParams', JSON.stringify(newParams, null, 2));
                                }}
                              />
                            </div>
                          ))}
                          <p className="text-[10px] text-muted leading-tight mt-2">
                            Escribe un valor fijo para pruebas, o mapea a variables de forma dinámica (ej. <code>{`{{start.data.codigo}}`}</code>).
                          </p>
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted p-3 bg-bg border border-border rounded-sm border-dashed text-center">
                          La consulta no requiere parámetros (#param_nombre).
                        </div>
                      )}
                    </div>

                    {/* Render JSON Viewer for upstream HTTP/Query nodes to make mapping easier */}
                    {edges
                      .filter(e => e.target === node.id)
                      .map(e => nodes.find(n => n.id === e.source))
                      .filter(n => n && isDataProducerNode(n.type))
                      .map(upNode => (
                        <div key={upNode!.id} className="pt-2 border-t border-border mt-4">
                          <span className="text-[10px] text-muted block mb-1">Inspeccionar datos desde: {(upNode!.data?.label as string) || upNode!.type}</span>
                          <JsonSelectorTrigger node={upNode} customLabel={`Ver JSON de ${upNode!.data?.label as string || 'nodo anterior'}`} updateNodeData={updateNodeData} />
                        </div>
                      ))
                    }
                  </>
                )}

                {node.type === 'scraping' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">URL a scrapear</label>
                      <Input
                        value={node.data?.url as string || ''}
                        onChange={(e) => updateNodeData('url', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Script de extracción (.py)</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                        value={node.data?.script as string || ''}
                        onChange={(e) => updateNodeData('script', e.target.value)}
                      >
                        <option value="">Seleccionar script...</option>
                        <option value="1">extraer_precios.py</option>
                        <option value="2">parse_table.py</option>
                      </select>
                    </div>
                  </>
                )}

                {node.type === 'export' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Nombre de archivo</label>
                      <Input
                        value={node.data?.fileName as string || 'export'}
                        onChange={(e) => updateNodeData('fileName', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Formato</label>
                      <select
                        className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                        value={node.data?.format as string || 'CSV'}
                        onChange={(e) => updateNodeData('format', e.target.value)}
                      >
                        <option value="CSV">CSV</option>
                        <option value="Excel">Excel (.xlsx)</option>
                      </select>
                    </div>

                    {node.data?.format === 'Excel' && (
                      <div className="space-y-1.5 mt-2">
                        <label className="text-xs font-medium">Modo de Exportación</label>
                        <select
                          className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                          value={node.data?.exportMode as string || 'single'}
                          onChange={(e) => updateNodeData('exportMode', e.target.value)}
                        >
                          <option value="single">Combinar en una hoja</option>
                          <option value="multi">Múltiples pestañas por nodo</option>
                        </select>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="w-full gap-2 text-xs font-medium border-accent/40 text-accent hover:bg-accent/10 mt-1"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('preview-export-node', {
                            detail: {
                              id: node.id,
                              label: node.data?.label || 'Exportar',
                              fileName: node.data?.fileName,
                              format: node.data?.format
                            }
                          })
                        );
                      }}
                    >
                      <Eye size={14} />
                      <span>Previsualizar datos exportados</span>
                    </Button>

                    {node.data?.format === 'Excel' && node.data?.exportMode === 'multi' ? (
                      <div className="space-y-2 mt-4 pt-3 border-t border-border">
                        <label className="text-xs font-semibold text-fg">Configuración de Pestañas</label>
                        <p className="text-[10px] text-muted leading-tight">Asigna un nombre de pestaña para cada nodo conectado. Se exportarán todas sus columnas automáticamente.</p>
                        <div className="space-y-2">
                          {edges
                            .filter(e => e.target === node.id)
                            .map(e => nodes.find(n => n.id === e.source))
                            .filter(n => !!n)
                            .map(upNode => {
                              const multiSheetConfig = (node.data?.multiSheetConfig as Record<string, string>) || {};
                              const currentSheetName = multiSheetConfig[upNode!.id] || upNode!.data?.label || upNode!.type;
                              return (
                                <div key={upNode!.id} className="bg-bg p-2 rounded border border-border flex flex-col gap-1.5">
                                  <span className="text-[10px] font-medium text-fg truncate">
                                    Desde: {(upNode!.data?.label as string) || upNode!.type}
                                  </span>
                                  <Input
                                    className="h-7 text-xs"
                                    placeholder="Nombre de la pestaña"
                                    value={currentSheetName as string}
                                    onChange={(e) => {
                                      const newConfig = { ...multiSheetConfig, [upNode!.id]: e.target.value };
                                      updateNodeData('multiSheetConfig', newConfig);
                                    }}
                                  />
                                </div>
                              );
                            })
                          }
                          {edges.filter(e => e.target === node.id).length === 0 && (
                            <div className="text-[10px] text-muted p-2 bg-bg border border-border border-dashed rounded text-center">
                              Conecta nodos a la entrada para configurar sus pestañas.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1.5 mt-2">
                          <label className="text-xs font-medium">Nodo Origen de Datos</label>
                          <select
                            className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                            value={node.data?.sourceNodeId as string || ''}
                            onChange={(e) => {
                              const selectedId = e.target.value;
                              updateNodeData('sourceNodeId', selectedId);
                              if (selectedId) {
                                updateNodeData('dataSource', `{{${selectedId}}}`);
                              } else {
                                updateNodeData('dataSource', '');
                              }
                            }}
                          >
                            <option value="">Auto-detectar (Último nodo ejecutado)</option>
                            {edges
                              .filter(e => e.target === node.id)
                              .map(e => nodes.find(n => n.id === e.source))
                              .filter((n): n is Node => !!n && (n.type?.startsWith('http') || n.type === 'query'))
                              .map(upNode => (
                                <option key={upNode!.id} value={upNode!.id}>
                                  {(upNode!.data?.label as string) || upNode!.type} ({upNode!.id})
                                </option>
                              ))
                            }
                          </select>
                        </div>

                        <div className="space-y-1.5 mt-2">
                          <label className="text-xs font-medium">Ruta de Colección (Array Base)</label>
                          <Input
                            placeholder="{{httpGet_1.data.items}}"
                            className="font-mono text-xs"
                            value={node.data?.dataSource as string || ''}
                            onChange={(e) => updateNodeData('dataSource', e.target.value)}
                          />
                          <p className="text-[10px] text-muted leading-tight">Dejar vacío para usar el último nodo conectado.</p>
                        </div>

                        {node.data?.format === 'Excel' && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Color de encabezados</label>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-7 h-7 rounded-sm border border-border shrink-0 transition-colors"
                                style={{
                                  backgroundColor: (() => {
                                    const raw = (node.data?.headerColor as string) || '';
                                    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
                                    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(normalized) ? normalized : 'transparent';
                                  })()
                                }}
                              />
                              <Input
                                placeholder="#FF5733"
                                className="font-mono text-xs"
                                maxLength={7}
                                value={node.data?.headerColor as string || ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const normalized = raw && !raw.startsWith('#') ? `#${raw}` : raw;
                                  updateNodeData('headerColor', normalized);
                                }}
                              />
                            </div>
                            <p className="text-[10px] text-muted leading-tight">Color de fondo en formato hex para la fila de encabezados del reporte.</p>
                          </div>
                        )}

                        <JoinMappingEditor
                          joins={node.data?.joins as any || []}
                          onChange={joins => updateNodeData('joins', joins)}
                          upstreamNodes={edges
                            .filter(e => e.target === node.id)
                            .map(e => nodes.find(n => n.id === e.source))
                            .filter(n => !!n) as Node[]
                          }
                        />

                        <ColumnMappingEditor
                          columns={node.data?.columns as any || []}
                          onChange={cols => updateNodeData('columns', cols)}
                        />
                      </>
                    )}

                    {/* Render JSON Viewer for upstream HTTP/Query nodes to make mapping easier */}
                    {edges
                      .filter(e => e.target === node.id)
                      .map(e => nodes.find(n => n.id === e.source))
                      .filter(n => n && isDataProducerNode(n.type))
                      .map(upNode => (
                        <div key={upNode!.id} className="pt-2 border-t border-border mt-4">
                          <span className="text-[10px] text-muted block mb-1">Inspeccionar datos desde: {(upNode!.data?.label as string) || upNode!.type}</span>
                          <JsonSelectorTrigger node={upNode} forExportNode={node} customLabel={`Ver JSON de ${upNode!.data?.label as string || 'nodo anterior'}`} updateNodeData={updateNodeData} />
                        </div>
                      ))
                    }
                  </>
                )}

                {(node.type === 'timer' || node.type === 'delay') && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Tiempo de pausa</label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="1"
                          className="w-24"
                          value={(node.data?.duration as number | undefined) ?? 10}
                          onChange={(e) => updateNodeData('duration', Math.max(1, parseFloat(e.target.value) || 1))}
                        />
                        <select
                          className="flex flex-1 min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                          value={node.data?.unit as string || 'seconds'}
                          onChange={(e) => updateNodeData('unit', e.target.value)}
                        >
                          <option value="seconds">Segundos</option>
                          <option value="minutes">Minutos</option>
                          <option value="hours">Horas</option>
                        </select>
                      </div>
                      <p className="text-[10px] text-muted">
                        El flujo pausará su ciclo en este punto durante el tiempo configurado y luego continuará automáticamente hacia los nodos conectados.
                      </p>
                    </div>

                    <div className="p-3 bg-bg rounded-sm border border-border flex items-center gap-2 text-xs">
                      <Clock size={16} className="text-amber-500 shrink-0" />
                      <span>
                        Tiempo efectivo:{' '}
                        <strong className="text-fg">
                          {(() => {
                            const dur = parseFloat(node.data?.duration as any ?? 10) || 10;
                            const u = (node.data?.unit as string) || 'seconds';
                            const sec = u === 'minutes' ? dur * 60 : u === 'hours' ? dur * 3600 : dur;
                            if (sec >= 60) return `${Math.floor(sec / 60)} min ${sec % 60} s (${sec}s)`;
                            return `${sec} segundos`;
                          })()}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {(node.type === 'dataSource' || node.type === 'fileSource') && (
                  <DataSourceInspector node={node} updateNodeData={updateNodeData} nodes={nodes} edges={edges} />
                )}

                {node.type === 'dataList' && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Datos (JSON Array)</label>
                      <textarea
                        className={`flex w-full min-h-[200px] rounded-sm border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent ${
                          node.data?.items ? (
                            (() => {
                              try {
                                const parsed = JSON.parse(node.data.items as string);
                                return Array.isArray(parsed) ? "border-border" : "border-red-500 ring-1 ring-red-500/30";
                              } catch {
                                return "border-red-500 ring-1 ring-red-500/30";
                              }
                            })()
                          ) : "border-border"
                        }`}
                        value={node.data?.items as string || ''}
                        onChange={(e) => updateNodeData('items', e.target.value)}
                        placeholder={'[\n  { "id": 1, "nombre": "A" },\n  { "id": 2, "nombre": "B" }\n]'}
                      />
                      {(() => {
                        if (!node.data?.items) return null;
                        try {
                          const parsed = JSON.parse(node.data.items as string);
                          if (!Array.isArray(parsed)) return <p className="text-[10px] text-red-500">Debe ser un array válido.</p>;
                          return <p className="text-[10px] text-muted">Contiene {parsed.length} elementos.</p>;
                        } catch {
                          return <p className="text-[10px] text-red-500">JSON inválido.</p>;
                        }
                      })()}
                    </div>
                  </div>
                )}

                {node.type === 'forEach' && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Iterar sobre</label>
                      <Input
                        value={node.data?.iterateOver as string || ''}
                        onChange={(e) => updateNodeData('iterateOver', e.target.value)}
                        placeholder="{{dataList_1}}"
                      />
                      <p className="text-[10px] text-muted">Referencia al nodo que contiene el array. Ej: {'{{dataList_1}}'}</p>
                    </div>
                  </div>
                )}

                {node.type === 'forEachEnd' && (
                  <div className="space-y-4">
                    <div className="bg-bg/50 border border-border p-3 rounded-sm">
                      <p className="text-xs font-medium mb-1">Este nodo marca el final del bucle forEach.</p>
                      <p className="text-[11px] text-muted leading-relaxed">Los nodos entre 'Para cada elemento' y este nodo se ejecutaran una vez por cada elemento del array.</p>
                    </div>
                  </div>
                )}

                <div className="mt-8 pt-4 border-t border-border">
                  <Button
                    variant="default"
                    className="w-full text-danger border-danger/20 hover:bg-danger/10 hover:border-danger/30"
                    onClick={() => setNodes(nds => nds.filter(n => n.id !== selectedNodeId))}
                  >
                    Eliminar Nodo
                  </Button>
                </div>

              </div>
            </div>
            );
}

            function truncateArrays(obj: any): any {
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      // Mantener hasta 3 elementos como referencia para el usuario
      return obj.slice(0, 3).map(truncateArrays);
    }
            return [];
  } else if (obj !== null && typeof obj === 'object') {
    const newObj: any = { };
            for (const key in obj) {
              newObj[key] = truncateArrays(obj[key]);
    }
            return newObj;
  }
            return obj;
}

            function extractExportableSample(data: any): any {
  if (!data) return null;
            if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.data) && data.data.length > 0) {
        return extractExportableSample(data.data);
      }
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        return extractExportableSample(data.rows);
      }
      if (Array.isArray(data.items) && data.items.length > 0) {
        return extractExportableSample(data.items);
      }
            return data;
    }
            return data;
  }
            const nonEmpties: any[] = [];
            for (const item of data) {
    if (!item) continue;
            if (Array.isArray(item)) {
      const sample = extractExportableSample(item);
            if (sample) nonEmpties.push(...(Array.isArray(sample) ? sample : [sample]));
    } else if (typeof item === 'object') {
      if (Array.isArray(item.data) && item.data.length > 0) {
              nonEmpties.push(...item.data);
      } else if (Array.isArray(item.rows) && item.rows.length > 0) {
              nonEmpties.push(...item.rows);
      } else if (Array.isArray(item.items) && item.items.length > 0) {
              nonEmpties.push(...item.items);
      } else if (Object.keys(item).length > 0 && !item.data) {
              nonEmpties.push(item);
      }
    }
  }
  return nonEmpties.length > 0 ? nonEmpties : data;
}

            function JsonSelectorTrigger({node, forExportNode, updateNodeData, onSelectValue, customLabel}: {node: any, forExportNode?: any, updateNodeData?: (key: string, val: any) => void, onSelectValue?: (val: string) => void, customLabel?: string }) {
  const [isOpen, setIsOpen] = useState(false);
            const [selectedKey, setSelectedKey] = useState('');
            const [jsonData, setJsonData] = useState<any>(null);
              const [loading, setLoading] = useState(false);
              const [error, setError] = useState('');
              const [extractArray, setExtractArray] = useState(false);
              const [extractIterate, setExtractIterate] = useState(false);
  
  const cachedResult = useAppSelector(state => (state as any).flows?.nodeResults?.[node.id]);

              // Multi-select state for column auto-mapping
              const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
              const isMultiSelect = !!forExportNode;

  const handleOpen = async () => {
                setIsOpen(true);
              setSelectedPaths([]);

              // Si ya tenemos los datos cacheados, no volver a hacer la petición
              if (jsonData) return;

              setError('');

              // 1. Usar resultado en caché de Redux (si el flujo ya se ejecutó recientemente)
              if (cachedResult) {
                let resultToDisplay = cachedResult;
                if (node.type === 'query') {
                  resultToDisplay = cachedResult.rows || cachedResult.data?.rows || cachedResult;
                }
                if (node.type === 'dataSource' || node.type === 'fileSource') {
                  resultToDisplay = cachedResult;
                }
                if (isMultiSelect) {
                  resultToDisplay = extractExportableSample(resultToDisplay);
                }
                setJsonData(truncateArrays(resultToDisplay));
                return;
              }

              // Si es dataSource o fileSource sin caché
              if (node.type === 'dataSource' || node.type === 'fileSource') {
                if (node.data?.sampleRows && Array.isArray(node.data.sampleRows) && node.data.sampleRows.length > 0) {
                  setJsonData(truncateArrays(node.data.sampleRows));
                  return;
                }
                if (node.data?.filePath) {
                  setLoading(true);
                  try {
                    const previewRes = await fetch(`http://localhost:3001/api/file-manager/preview?filePath=${encodeURIComponent(node.data.filePath)}&limit=10`);
                    if (previewRes.ok) {
                      const pJson = await previewRes.json();
                      if (pJson?.data?.rows) {
                        setJsonData(truncateArrays(pJson.data.rows));
                        return;
                      }
                    }
                  } catch (e) {
                  } finally {
                    setLoading(false);
                  }
                }
                setError('Ejecuta el flujo para que este nodo genere sus datos y puedas seleccionarlos aquí.');
                return;
              }

              // 2. Si no hay caché, intentar hacer una petición en vivo
              let endpoint = node.data?.endpoint || '';
              if (node.type === 'query') {
      const queryId = node.data?.queryId;
              if (!queryId) {
                setError('No hay una consulta seleccionada en el nodo.');
              return;
      }
              endpoint = `http://localhost:3001/api/queries/${queryId}/execute`;
    }

              if (!endpoint) {
                setError('No hay un endpoint configurado');
              return;
    }

              if (endpoint.includes('storefront.com') || (!endpoint.startsWith('http') && node.type !== 'query')) {
                // use sample mock
                setJsonData({
                  status: "success",
                  code: 200,
                  data: {
                    items: [
                      { id: "prod_01", name: "Laptop Pro", price: 1299.99, stock: 45 }
                    ],
                    pagination: { page: 1, total_pages: 5, total_items: 10 }
                  }
                });
              return;
    }

              setLoading(true);
              try {
                let res;
              if (node.type === 'query') {
                let parsedParams = { };
              if (node.data?.queryParams) {
          try {
                parsedParams = JSON.parse(node.data.queryParams);
          } catch(e) {
                console.error('Error parsing queryParams JSON for preview', e);
          }
        }
              res = await fetch(endpoint, {
                method: 'POST',
              headers: {'Content-Type': 'application/json' },
              body: JSON.stringify({connection_ids: [], params: parsedParams })
        });
      } else {
        const method = (node.data?.method as string) || (node.type === 'httpPost' ? 'POST' : 'GET');
              const options: RequestInit = {method, headers: {'Content-Type': 'application/json' } };

              let payloadStr = '';
              if (node.data?.body) {
                payloadStr = node.data.body;
        } else if (node.data?.payload) {
                payloadStr = JSON.stringify(node.data.payload);
        }

              if (['POST', 'PUT', 'PATCH'].includes(method) && payloadStr) {
                options.body = payloadStr;
        }
              res = await fetch(endpoint, options);
      }

              if (!res.ok) {
                let errorMsg = `HTTP Error: ${res.status}`;
              try {
          const errData = await res.clone().json();
              if (errData.error) errorMsg = errData.error;
        } catch (e) { }
              throw new Error(errorMsg);
      }

              const text = await res.text();
              try {
        const parsed = JSON.parse(text);
              let resultToDisplay = parsed;
              if (node.type === 'query') {
                resultToDisplay = parsed.data?.rows || [];
        }
              if (isMultiSelect) {
                resultToDisplay = extractExportableSample(resultToDisplay);
        }
              setJsonData(truncateArrays(resultToDisplay));
      } catch (e) {
                setJsonData({ textResponse: text.slice(0, 500) + '...' });
      }
    } catch (err: any) {
                setError(
                  err.message?.includes('Timeout') || err.message?.includes('Query execution failed')
                    ? 'La consulta falló (¿Faltan parámetros dinámicos?). Ejecuta el flujo completo primero para visualizar los resultados aquí.'
                    : err.message || 'Error al ejecutar la petición.'
                );
    } finally {
                setLoading(false);
    }
  };

  const handleSelectKey = (path: string) => {
                // path already starts with nodeId (it's the currentPath)
                let formattedPath = path;
              if (extractIterate) {
      const lastBracket = path.lastIndexOf('].');
              if (lastBracket !== -1) {
                formattedPath = '_item.' + path.substring(lastBracket + 2);
      } else {
        const lastDot = path.lastIndexOf('.');
              if (lastDot !== -1) {
                formattedPath = '_item.' + path.substring(lastDot + 1);
        } else {
                formattedPath = '_item';
        }
      }
    } else if (extractArray) {
      // Reemplaza el primer o último índice de array con [*]
      const lastBracket = path.lastIndexOf('[');
              if (lastBracket !== -1) {
                formattedPath = path.substring(0, lastBracket) + '[*]' + path.substring(path.indexOf(']', lastBracket) + 1);
      } else {
                formattedPath = path.replace(/\[\d+\]/g, '[*]');
      }
    }
              const variableFormat = `{{${formattedPath}}}`;
              setSelectedKey(variableFormat);

              if (onSelectValue) {
                onSelectValue(variableFormat);
              setIsOpen(false);
    } else {
                navigator.clipboard.writeText(variableFormat);
              alert(`Copiado al portapapeles: ${variableFormat}`);
    }
  };

  const handleTogglePath = (path: string) => {
                setSelectedPaths(prev =>
                  prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
                );
  };

  const handleAutoMapColumns = () => {
    if (!updateNodeData || !forExportNode) return;

              const currentCols = forExportNode.data?.columns || [];
    
    const newCols = selectedPaths.map(path => {
                // Intentar limpiar el path para obtener solo la clave relativa
                // ej: "response[0].name" -> "name", "response.data.items[0].price" -> "price"
                let relativeKey = path;
              const bracketIndex = path.lastIndexOf('].');
              if (bracketIndex !== -1) {
                relativeKey = path.substring(bracketIndex + 2);
      } else {
        const dotIndex = path.lastIndexOf('.');
              if (dotIndex !== -1) relativeKey = path.substring(dotIndex + 1);
      }

              // El nombre por defecto puede ser la llave capitalizada
              const headerName = relativeKey.split('.').pop() || relativeKey;
              const capitalized = headerName.charAt(0).toUpperCase() + headerName.slice(1);

              return {
                header: capitalized,
              key: relativeKey
      };
    });

              updateNodeData('columns', [...currentCols, ...newCols]);
              alert(`${newCols.length} columnas agregadas correctamente.`);
              setIsOpen(false);
  };

              return (
              <>
                <Button variant="textLink" onClick={handleOpen}>
                  {customLabel || 'Visualizar Respuesta (JSON)'}
                </Button>

                {isOpen && createPortal(
                  <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-fade-in">
                    <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-lg p-6 relative flex flex-col gap-4">
                      <button
                        onClick={() => setIsOpen(false)}
                        className="absolute top-4 right-4 text-muted hover:text-fg"
                      >
                        <X size={18} />
                      </button>

                      <div>
                        <h2 className="text-lg font-semibold">
                          {isMultiSelect ? 'Seleccionar columnas' : 'Selector de campos JSON'}
                        </h2>
                        <p className="text-xs text-muted mt-1">
                          {isMultiSelect
                            ? 'Marca los campos que deseas exportar. Se extraerá la llave automáticamente.'
                            : 'Haz clic en cualquier propiedad para copiar su variable de referencia.'
                          }
                        </p>
                        {!isMultiSelect && (
                          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-border">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="extractArray"
                                className="w-3.5 h-3.5 accent-accent"
                                checked={extractArray}
                                onChange={(e) => {
                                  setExtractArray(e.target.checked);
                                  if (e.target.checked) setExtractIterate(false);
                                }}
                              />
                              <label htmlFor="extractArray" className="text-xs font-medium text-muted-foreground select-none cursor-pointer">
                                Extraer como lista completa (Array map [*])
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="extractIterate"
                                className="w-3.5 h-3.5 accent-accent"
                                checked={extractIterate}
                                onChange={(e) => {
                                  setExtractIterate(e.target.checked);
                                  if (e.target.checked) setExtractArray(false);
                                }}
                              />
                              <label htmlFor="extractIterate" className="text-xs font-medium text-muted-foreground select-none cursor-pointer">
                                Extraer para Modo Iteración (usa _item)
                              </label>
                            </div>
                          </div>
                        )}
                      </div>

                      {loading && <div className="text-center p-4 text-sm text-muted">Realizando petición a {node.data?.endpoint}...</div>}
                      {error && <div className="text-center p-4 text-sm text-danger border border-danger/30 bg-danger/5 rounded-md">{error}</div>}
                      {!loading && !error && jsonData && (
                        <JsonTreeViewer
                          data={jsonData}
                          mode={isMultiSelect ? 'select' : 'copy'}
                          onSelectKey={isMultiSelect ? undefined : handleSelectKey}
                          currentPath={node.id}
                          selectedPaths={selectedPaths}
                          onTogglePath={handleTogglePath}
                        />
                      )}

                      {!isMultiSelect && selectedKey && (
                        <div className="p-3 bg-bg border border-border rounded-sm">
                          <span className="text-xs text-muted block mb-1">Variable seleccionada</span>
                          <code className="text-xs text-accent font-semibold">{selectedKey}</code>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 mt-2">
                        {isMultiSelect && selectedPaths.length > 0 && (
                          <Button variant="primary" size="sm" onClick={handleAutoMapColumns}>
                            Agregar {selectedPaths.length} seleccionadas
                          </Button>
                        )}
                        <Button variant="default" size="sm" onClick={() => setIsOpen(false)}>
                          Cerrar
                        </Button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
              </>
              );
}

              function ColumnMappingEditor({columns, onChange}: {columns: {header: string, key: string }[], onChange: (cols: any) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  const addColumn = () => {
                onChange([...(columns || []), { header: '', key: '' }]);
  };

  const updateColumn = (index: number, field: 'header' | 'key', value: string) => {
    const newCols = [...(columns || [])];
              newCols[index] = {...newCols[index], [field]: value };
              onChange(newCols);
  };

  const removeColumn = (index: number) => {
    const newCols = [...(columns || [])];
              newCols.splice(index, 1);
              onChange(newCols);
  };

              const count = (columns || []).length;

              return (
              <div className="space-y-2 mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCollapsed(prev => !prev)}
                    className="flex items-center gap-1.5 text-xs font-medium hover:text-accent transition-colors"
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    Mapeo de Columnas
                    {count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-mono leading-none">
                        {count}
                      </span>
                    )}
                  </button>
                  {!collapsed && (
                    <Button variant="default" size="sm" onClick={addColumn} className="h-6 text-[10px] px-2 py-0">
                      + Agregar
                    </Button>
                  )}
                </div>

                {!collapsed && (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pb-2">
                    {(columns || []).map((col, i) => (
                      <div key={i} className="flex gap-2 items-start bg-bg p-2 rounded-sm border border-border">
                        <div className="flex-1 space-y-1.5">
                          <Input
                            placeholder="Nombre Columna (ej: Precio)"
                            className="h-7 text-xs"
                            value={col.header}
                            onChange={e => updateColumn(i, 'header', e.target.value)}
                          />
                          <Input
                            placeholder="Llave JSON (ej: price)"
                            className="h-7 text-xs font-mono"
                            value={col.key}
                            onChange={e => updateColumn(i, 'key', e.target.value)}
                          />
                        </div>
                        <Button variant="icon" size="icon" onClick={() => removeColumn(i)} className="text-danger hover:text-danger hover:bg-danger/10 shrink-0 mt-0.5">
                          <X size={14} />
                        </Button>
                      </div>
                    ))}
                    {(!columns || columns.length === 0) && (
                      <div className="text-[10px] text-muted text-center py-4 bg-bg rounded-sm border border-border border-dashed">
                        Sin mapeo. Se exportarán todos los campos.
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
}

              function HttpParamsEditor({
                paramsJson,
                onChange,
                node,
                edges,
                nodes
              }: {
                paramsJson: string;
  onChange: (newJson: string) => void;
              node: Node;
              edges: Edge[];
              nodes: Node[];
}) {
  const [showRaw, setShowRaw] = useState(false);
              const [newKey, setNewKey] = useState('');

  const paramsObj = React.useMemo(() => {
    try {
      if (!paramsJson || !paramsJson.trim()) return { };
              const parsed = JSON.parse(paramsJson);
              return typeof parsed === 'object' && parsed !== null ? parsed : { };
    } catch {
      return { };
    }
  }, [paramsJson]);

  const updateParamValue = (key: string, value: any) => {
    const updated = {...paramsObj, [key]: value };
              onChange(JSON.stringify(updated, null, 2));
  };

  const removeParam = (key: string) => {
    const updated = {...paramsObj};
              delete updated[key];
              onChange(Object.keys(updated).length === 0 ? '' : JSON.stringify(updated, null, 2));
  };

  const addParam = () => {
    const keyToAdd = newKey.trim() || `param_${Object.keys(paramsObj).length + 1}`;
              const updated = {...paramsObj, [keyToAdd]: '' };
              onChange(JSON.stringify(updated, null, 2));
              setNewKey('');
  };

              const paramEntries = Object.entries(paramsObj);
              const upstreamNodes = getUpstreamNodes(node, edges, nodes);

              return (
              <div className="space-y-2 border-t border-border pt-3 mt-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium">Parámetros de Consulta (Query Params)</label>
                  <button
                    type="button"
                    onClick={() => setShowRaw(!showRaw)}
                    className="text-[10px] text-accent hover:underline font-mono"
                  >
                    {showRaw ? 'Vista Guiada' : 'Ver JSON'}
                  </button>
                </div>

                {showRaw ? (
                  <textarea
                    className="flex w-full min-h-[70px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                    value={paramsJson}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={'{\n  "idEds": "94",\n  "estadoRegistro": "A"\n}'}
                  />
                ) : (
                  <div className="space-y-2 border border-border rounded-sm p-2.5 bg-bg/50">
                    {paramEntries.length > 0 ? (
                      paramEntries.map(([key, val]) => (
                        <div key={key} className="flex flex-col gap-1 pb-2 border-b border-border/50 last:border-0 last:pb-0">
                          <div className="flex justify-between items-center gap-1">
                            <span className="text-[11px] font-mono font-semibold text-accent truncate max-w-[140px]" title={key}>
                              {key}
                            </span>
                            <div className="flex gap-1 items-center">
                              {upstreamNodes.map(upNode => (
                                <JsonSelectorTrigger
                                  key={upNode.id}
                                  node={upNode}
                                  customLabel={upstreamNodes.length > 1 ? `Mapear (${upNode.data?.label || upNode.type})` : 'Mapear'}
                                  onSelectValue={(mappedVal) => updateParamValue(key, mappedVal)}
                                />
                              ))}
                              <button
                                type="button"
                                onClick={() => removeParam(key)}
                                className="text-muted hover:text-danger p-0.5"
                                title="Eliminar parámetro"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                          <Input
                            className="h-7 text-xs font-mono"
                            value={typeof val === 'string' ? val : JSON.stringify(val)}
                            onChange={(e) => updateParamValue(key, e.target.value)}
                            placeholder="Valor o {{nodo_1.data.id}}"
                          />
                        </div>
                      ))
                    ) : (
                      <div className="text-[10px] text-muted text-center py-2 leading-relaxed">
                        No hay parámetros. Pega una URL con <code className="text-accent font-mono">?key=val</code> o agrega un parámetro abajo.
                      </div>
                    )}

                    <div className="flex gap-1.5 pt-1.5 border-t border-border/50">
                      <Input
                        className="h-7 text-xs font-mono flex-1"
                        placeholder="Nombre del parámetro..."
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addParam();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-7 px-2 text-xs shrink-0 flex items-center gap-1"
                        onClick={addParam}
                      >
                        <Plus size={12} />
                        Agregar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              );
}

              function JoinMappingEditor({joins, onChange, upstreamNodes}: {joins: {nodeId: string, localKey: string, foreignKey: string }[], onChange: (joins: any) => void, upstreamNodes: Node[] }) {
  const [collapsed, setCollapsed] = useState(false);

  const addJoin = () => {
                onChange([...(joins || []), { nodeId: '', localKey: '', foreignKey: '' }]);
  };

  const updateJoin = (index: number, field: 'nodeId' | 'localKey' | 'foreignKey', value: string) => {
    const newJoins = [...(joins || [])];
              newJoins[index] = {...newJoins[index], [field]: value };
              onChange(newJoins);
  };

  const removeJoin = (index: number) => {
    const newJoins = [...(joins || [])];
              newJoins.splice(index, 1);
              onChange(newJoins);
  };

              const count = (joins || []).length;

              return (
              <div className="space-y-2 mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCollapsed(prev => !prev)}
                    className="flex items-center gap-1.5 text-xs font-medium hover:text-accent transition-colors"
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    Relaciones (Joins)
                    {count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-mono leading-none">
                        {count}
                      </span>
                    )}
                  </button>
                  {!collapsed && (
                    <Button variant="default" size="sm" onClick={addJoin} className="h-6 text-[10px] px-2 py-0">
                      + Agregar
                    </Button>
                  )}
                </div>

                {!collapsed && (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pb-2">
                    {(joins || []).map((join, i) => (
                      <div key={i} className="flex gap-2 items-start bg-bg p-2 rounded-sm border border-border flex-col">
                        <div className="flex w-full items-center justify-between">
                          <select
                            className="flex-1 h-7 rounded-sm border border-border bg-surface px-[9px] text-xs focus-visible:outline-none focus-visible:border-accent"
                            value={join.nodeId}
                            onChange={e => updateJoin(i, 'nodeId', e.target.value)}
                          >
                            <option value="">Seleccionar nodo a cruzar...</option>
                            {upstreamNodes.map(n => (
                              <option key={n.id} value={n.id}>{(n.data?.label as string) || n.type} ({n.id})</option>
                            ))}
                          </select>
                          <Button variant="icon" size="icon" onClick={() => removeJoin(i)} className="text-danger hover:text-danger hover:bg-danger/10 shrink-0 ml-1">
                            <X size={14} />
                          </Button>
                        </div>
                        <div className="flex gap-2 w-full mt-1.5">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted mb-0.5 block">Llave Local</label>
                            <Input
                              placeholder="ej: id_eds"
                              className="h-7 text-xs font-mono"
                              value={join.localKey}
                              onChange={e => updateJoin(i, 'localKey', e.target.value)}
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted mb-0.5 block">Llave Externa</label>
                            <Input
                              placeholder="ej: IdEds"
                              className="h-7 text-xs font-mono"
                              value={join.foreignKey}
                              onChange={e => updateJoin(i, 'foreignKey', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!joins || joins.length === 0) && (
                      <div className="text-[10px] text-muted text-center py-4 bg-bg rounded-sm border border-border border-dashed px-2">
                        Sin relaciones. Útil si los IDs no coinciden entre nodos.
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
}
