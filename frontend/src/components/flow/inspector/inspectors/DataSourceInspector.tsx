import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Upload, Loader2, Eye } from 'lucide-react';
import { useAppSelector } from '../../../../store/hooks';
import { getApiUrl } from '../../../../lib/api';
import type { Node, Edge } from '@xyflow/react';

interface DataSourceInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  nodes?: Node[];
  edges?: Edge[];
}

export function DataSourceInspector({ node, updateNodeData, nodes, edges }: DataSourceInspectorProps) {
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
            via: viaPath.length > 0 ? `via ${viaPath.join(' -> ')}` : undefined,
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
      const res = await fetch(getApiUrl('/file-manager/upload'), {
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
  const mode = (node.data?.mode as string) || 'file';

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Origen de Datos</label>
        <select
          className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
          value={mode}
          onChange={e => updateNodeData('mode', e.target.value)}
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
                    <p className="text-[10px] text-muted mt-0.5">Formatos soportados: .xlsx, .xls, .csv</p>
                  </div>
                </>
              )}
            </div>
            {uploadError && <p className="text-[11px] text-danger mt-1">{uploadError}</p>}
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
                    <label className="text-[10px] font-medium text-muted">Hoja de calculo</label>
                    <select
                      className="w-full text-xs h-8 border border-border bg-surface rounded px-2"
                      value={(node.data?.sheetName as string) || sheets[0]}
                      onChange={e => updateNodeData('sheetName', e.target.value)}
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
                          completed: false,
                        },
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
                    <span>Columnas extraidas ({columns.length})</span>
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
        /* Merge mode */
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-md text-emerald-800">
            <p className="text-xs font-semibold mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              Modo Unificador (Merge)
            </p>
            <p className="text-[11px] leading-relaxed opacity-90">
              Este nodo unifica y cruza automaticamente los datos devueltos por los nodos conectados a su entrada.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-fg">
              Origenes de datos a unificar ({effectiveDataNodes.length})
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
                  {mergedRows.length} registros - {mergedColumns.length} columnas
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
                        completed: true,
                      },
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
                        {mergedRows.slice(0, 3).map((r: any, i: number) => (
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
              Haz clic en <strong>Ejecutar Flujo</strong> para procesar y ver los datos unificados aqui.
            </div>
          )}

          <div className="p-2.5 bg-bg border border-border rounded text-[11px] text-muted space-y-1">
            <p>
              Puedes referenciar este nodo unificador usando <code>{`{{${node.id}}}`}</code> en otros nodos (ej. "Iterar Sobre" de HTTP o en un nodo de Exportar).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
