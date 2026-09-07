import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Download,
  FileSpreadsheet,
  Search,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { triggerBrowserDownload } from '../../lib/exportUtils';

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  nodeLabel: string;
  nodeResult: any;
  completed: boolean;
  isLiveExecuting: boolean;
  onExecuteFlow: () => void;
  fileName?: string;
  format?: string;
}

export function ExportPreviewModal({
  isOpen,
  onClose,
  nodeId,
  nodeLabel,
  nodeResult,
  completed,
  isLiveExecuting,
  onExecuteFlow,
  fileName: configuredFileName,
  format: configuredFormat,
}: ExportPreviewModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [fetchedData, setFetchedData] = useState<{ columns: string[]; rows: any[]; totalRows: number } | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // If nodeResult doesn't have previewRows but has filePath, try to load it from server
  useEffect(() => {
    if (isOpen && nodeResult?.filePath && (!nodeResult.previewRows || nodeResult.previewRows.length === 0)) {
      setIsLoadingFile(true);
      fetch(`http://localhost:3001/api/file-manager/preview?filePath=${encodeURIComponent(nodeResult.filePath)}&limit=500`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.data) {
            setFetchedData({
              columns: data.data.columns || [],
              rows: data.data.rows || [],
              totalRows: data.data.totalRows || 0,
            });
          }
        })
        .catch(err => console.error('Error fetching export file preview:', err))
        .finally(() => setIsLoadingFile(false));
    }
  }, [isOpen, nodeResult?.filePath, nodeResult?.previewRows]);

  const rows: any[] = useMemo(() => {
    if (nodeResult?.previewRows && Array.isArray(nodeResult.previewRows) && nodeResult.previewRows.length > 0) {
      return nodeResult.previewRows;
    }
    if (fetchedData?.rows && Array.isArray(fetchedData.rows)) {
      return fetchedData.rows;
    }
    return [];
  }, [nodeResult, fetchedData]);

  const columns: string[] = useMemo(() => {
    if (nodeResult?.headers && Array.isArray(nodeResult.headers) && nodeResult.headers.length > 0) {
      return nodeResult.headers;
    }
    if (fetchedData?.columns && Array.isArray(fetchedData.columns) && fetchedData.columns.length > 0) {
      return fetchedData.columns;
    }
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      return Object.keys(rows[0]);
    }
    return [];
  }, [nodeResult, fetchedData, rows]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter(row => {
      if (!row || typeof row !== 'object') return String(row).toLowerCase().includes(term);
      return Object.values(row).some(val =>
        String(val ?? '').toLowerCase().includes(term)
      );
    });
  }, [rows, searchTerm]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  if (!isOpen) return null;

  const displayFormat = nodeResult?.format || configuredFormat || 'CSV';
  const displayFileName =
    nodeResult?.filePath ? nodeResult.filePath.split(/[/\\]/).pop() : (configuredFileName || 'export');
  const totalRecords = nodeResult?.records ?? (fetchedData?.totalRows ?? rows.length);
  const isReady = (completed || Boolean(nodeResult?.filePath)) && rows.length > 0;

  const handleDownload = () => {
    if (nodeResult?.filePath) {
      const fileName = nodeResult.filePath.split(/[/\\]/).pop();
      triggerBrowserDownload(`http://localhost:3001/api/files/${fileName}`, fileName);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-lg shadow-raised border border-border w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-bg/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-orange-500/10 text-orange-600 flex items-center justify-center">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-fg">
                  Previsualización de Exportación
                </h2>
                <span className="font-mono text-xs bg-bg px-2 py-0.5 rounded border border-border font-medium text-muted">
                  {nodeLabel}
                </span>
                <span className="text-[10px] bg-accent/10 text-accent font-mono px-2 py-0.5 rounded uppercase font-semibold">
                  {displayFormat}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {displayFileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg rounded-md text-muted hover:text-fg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 min-h-0 bg-bg/20">
          {!isReady && !isLoadingFile ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4 bg-surface rounded-md border border-dashed border-border">
              <div className="w-12 h-12 rounded-full bg-warn/10 text-warn flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="text-sm font-semibold text-fg">
                  El flujo aún no se ha ejecutado
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  Para poder previsualizar exactamente cómo se exportan los datos, es necesario ejecutar el ciclo. Al completarse, podrás ver todas las filas generadas aquí mismo.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={onExecuteFlow}
                disabled={isLiveExecuting}
                className="gap-2 font-medium"
              >
                {isLiveExecuting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Ejecutando flujo...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    <span>Ejecutar flujo ahora</span>
                  </>
                )}
              </Button>
            </div>
          ) : isLoadingFile ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-12 text-muted">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-xs">Cargando datos del archivo exportado...</span>
            </div>
          ) : (
            <>
              {/* Controls bar: Search, stats, and download */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative w-full">
                    <Search
                      size={14}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <Input
                      placeholder="Buscar en registros..."
                      value={searchTerm}
                      onChange={e => {
                        setSearchTerm(e.target.value);
                        setPage(1);
                      }}
                      className="pl-8 h-8 text-xs bg-surface"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">
                    Total:{' '}
                    <strong className="text-fg font-semibold">
                      {totalRecords.toLocaleString()}
                    </strong>{' '}
                    registros •{' '}
                    <strong className="text-fg font-semibold">
                      {columns.length}
                    </strong>{' '}
                    columnas
                  </span>

                  {nodeResult?.filePath && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleDownload}
                      className="gap-1.5 h-8 text-xs font-medium bg-surface border-border hover:bg-bg"
                    >
                      <Download size={13} />
                      <span>Descargar archivo</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="flex-1 border border-border rounded-md bg-surface overflow-auto shadow-inner">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-surface border-b border-border shadow-sm z-10">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold text-muted w-12 text-center border-r border-border bg-bg/50">
                        #
                      </th>
                      {columns.map(col => (
                        <th
                          key={col}
                          className="py-2.5 px-3 font-semibold text-fg whitespace-nowrap border-r border-border last:border-r-0 bg-bg/50"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={columns.length + 1}
                          className="py-8 text-center text-muted"
                        >
                          No se encontraron registros que coincidan con la búsqueda.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-bg/60 transition-colors odd:bg-surface even:bg-bg/20 font-mono text-[11px]"
                        >
                          <td className="py-2 px-3 text-center text-muted/60 border-r border-border select-none text-[10px]">
                            {(page - 1) * pageSize + idx + 1}
                          </td>
                          {columns.map(col => {
                            const val = row[col];
                            const textVal =
                              val === null || val === undefined
                                ? ''
                                : typeof val === 'object'
                                ? JSON.stringify(val)
                                : String(val);

                            return (
                              <td
                                key={col}
                                className="py-2 px-3 whitespace-nowrap max-w-[280px] truncate border-r border-border last:border-r-0 text-fg"
                                title={textVal}
                              >
                                {textVal}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-1 pt-1 text-xs text-muted">
                  <span>
                    Mostrando{' '}
                    <strong>
                      {(page - 1) * pageSize + 1} -{' '}
                      {Math.min(page * pageSize, filteredRows.length)}
                    </strong>{' '}
                    de {filteredRows.length} resultados filtrados
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="w-7 h-7"
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <span className="px-2 font-mono text-xs">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="w-7 h-7"
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between bg-surface">
          <div className="text-xs text-muted flex items-center gap-1.5">
            {isReady && (
              <>
                <CheckCircle2 size={13} className="text-success" />
                <span>Datos listos para verificación o descarga</span>
              </>
            )}
          </div>
          <Button variant="default" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
