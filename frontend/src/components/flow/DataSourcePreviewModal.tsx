import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Download,
  FileSpreadsheet,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Layers
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { triggerBrowserDownload } from '../../lib/exportUtils';

interface DataSourcePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  nodeLabel: string;
  fileName?: string;
  filePath?: string;
  format?: string;
  sheetName?: string;
  sheets?: string[];
  sampleRows?: any[];
  totalRows?: number;
  nodeResult?: any;
  onSelectSheet?: (sheet: string) => void;
}

export function DataSourcePreviewModal({
  isOpen,
  onClose,
  nodeId,
  nodeLabel,
  fileName,
  filePath,
  format,
  sheetName: initialSheetName,
  sheets = [],
  sampleRows,
  totalRows,
  nodeResult,
  onSelectSheet,
}: DataSourcePreviewModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [activeSheet, setActiveSheet] = useState<string>(initialSheetName || sheets[0] || '');
  const [fetchedData, setFetchedData] = useState<{
    columns: string[];
    rows: any[];
    totalRows: number;
    sheets: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sync initial sheet
  useEffect(() => {
    if (initialSheetName) {
      setActiveSheet(initialSheetName);
    } else if (sheets && sheets.length > 0) {
      setActiveSheet(sheets[0]);
    }
  }, [initialSheetName, sheets]);

  // Load preview data when modal opens or active sheet changes
  useEffect(() => {
    if (!isOpen) return;

    if (Array.isArray(nodeResult) && nodeResult.length > 0 && !activeSheet) {
      return;
    }

    if (!filePath) return;

    setIsLoading(true);
    setLoadError(null);

    const sheetParam = activeSheet ? `&sheetName=${encodeURIComponent(activeSheet)}` : '';
    fetch(`http://localhost:3001/api/file-manager/preview?filePath=${encodeURIComponent(filePath)}${sheetParam}&limit=1000`)
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Error al cargar los datos del archivo');
        }
        return res.json();
      })
      .then(json => {
        if (json?.data) {
          setFetchedData({
            columns: json.data.columns || [],
            rows: json.data.rows || [],
            totalRows: json.data.totalRows || 0,
            sheets: json.data.sheets || sheets,
          });
        }
      })
      .catch(err => {
        console.error('Error fetching data source preview:', err);
        setLoadError(err.message || 'Error al cargar la previsualización');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, filePath, activeSheet]);

  const rows: any[] = useMemo(() => {
    if (fetchedData?.rows && Array.isArray(fetchedData.rows)) {
      return fetchedData.rows;
    }
    if (Array.isArray(nodeResult) && nodeResult.length > 0) {
      return nodeResult;
    }
    if (Array.isArray(sampleRows) && sampleRows.length > 0) {
      return sampleRows;
    }
    return [];
  }, [fetchedData, nodeResult, sampleRows]);

  const columns: string[] = useMemo(() => {
    if (fetchedData?.columns && Array.isArray(fetchedData.columns) && fetchedData.columns.length > 0) {
      return fetchedData.columns;
    }
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      return Object.keys(rows[0]);
    }
    return [];
  }, [fetchedData, rows]);

  const availableSheets: string[] = useMemo(() => {
    if (fetchedData?.sheets && fetchedData.sheets.length > 0) {
      return fetchedData.sheets;
    }
    return sheets || [];
  }, [fetchedData, sheets]);

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

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  if (!isOpen) return null;

  const displayFormat = format || (fileName?.endsWith('.csv') ? 'CSV' : 'Excel');
  const totalCount = fetchedData?.totalRows ?? (totalRows || rows.length);

  const handleDownloadFile = () => {
    if (filePath) {
      const cleanName = fileName || filePath.split(/[/\\]/).pop() || 'datos';
      triggerBrowserDownload(`http://localhost:3001/api/files/${cleanName}`, cleanName);
    }
  };

  const handleSheetChange = (sheet: string) => {
    setActiveSheet(sheet);
    setPage(1);
    if (onSelectSheet) {
      onSelectSheet(sheet);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-surface rounded-lg shadow-raised border border-border w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-bg/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-fg">
                  Previsualización de Datos
                </h2>
                <span className="font-mono text-xs bg-bg px-2 py-0.5 rounded border border-border font-medium text-muted">
                  {nodeLabel}
                </span>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono px-2 py-0.5 rounded uppercase font-semibold">
                  {displayFormat}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {fileName || filePath || 'Archivo de origen de datos'}
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

        {/* Multi-sheet bar for Excel workbooks */}
        {availableSheets.length > 1 && (
          <div className="px-4 py-2 border-b border-border bg-bg/30 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-muted flex items-center gap-1 shrink-0 font-medium text-[11px]">
              <Layers size={13} />
              Hojas disponibles:
            </span>
            <div className="flex items-center gap-1.5">
              {availableSheets.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSheetChange(s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeSheet === s
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-surface hover:bg-bg border border-border text-fg'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 min-h-0 bg-bg/20">
          {!filePath && rows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3 bg-surface rounded-md border border-dashed border-border">
              <div className="w-12 h-12 rounded-full bg-warn/10 text-warn flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-sm font-semibold text-fg">
                  Sin archivo configurado
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  Este nodo no tiene ningún archivo cargado. Selecciona o arrastra un archivo Excel (.xlsx, .xls) o CSV en el panel de configuración del nodo para visualizar su información.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-12 text-muted">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
              <span className="text-xs">Cargando registros del archivo...</span>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3 bg-surface rounded-md border border-danger/30 bg-danger/5">
              <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-sm font-semibold text-danger">
                  Error al leer el archivo
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  {loadError}
                </p>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-2 bg-surface rounded-md border border-border">
              <span className="text-sm font-medium text-muted">El archivo está vacío o no contiene filas con datos.</span>
            </div>
          ) : (
            <>
              {/* Controls bar: Search, record stats, download */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative w-full">
                    <Search
                      size={14}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <Input
                      placeholder="Buscar en filas..."
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
                      {totalCount.toLocaleString()}
                    </strong>{' '}
                    registros •{' '}
                    <strong className="text-fg font-semibold">
                      {columns.length}
                    </strong>{' '}
                    columnas
                  </span>

                  {filePath && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleDownloadFile}
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
                  <thead className="bg-bg/80 sticky top-0 z-10 border-b border-border backdrop-blur-xs font-semibold">
                    <tr>
                      <th className="p-2.5 w-12 text-center text-muted font-mono text-[11px] border-r border-border/60">
                        #
                      </th>
                      {columns.map(col => (
                        <th
                          key={col}
                          className="p-2.5 whitespace-nowrap border-r border-border/60 last:border-r-0 font-medium text-fg"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {paginatedRows.map((row, idx) => {
                      const absoluteIndex = (page - 1) * pageSize + idx + 1;
                      return (
                        <tr
                          key={idx}
                          className="hover:bg-bg/50 transition-colors group"
                        >
                          <td className="p-2 text-center text-[10px] text-muted font-mono border-r border-border/40 select-none">
                            {absoluteIndex}
                          </td>
                          {columns.map(col => {
                            const val = row[col];
                            const isNumber = typeof val === 'number';
                            return (
                              <td
                                key={col}
                                className={`p-2 border-r border-border/40 last:border-r-0 whitespace-nowrap truncate max-w-xs ${
                                  isNumber ? 'font-mono text-right' : ''
                                }`}
                                title={String(val ?? '')}
                              >
                                {val !== null && val !== undefined && val !== '' ? (
                                  String(val)
                                ) : (
                                  <span className="text-muted/40 italic">null</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <div className="text-muted text-[11px]">
                  Mostrando{' '}
                  <strong className="text-fg font-medium">
                    {Math.min((page - 1) * pageSize + 1, filteredRows.length)}
                  </strong>{' '}
                  a{' '}
                  <strong className="text-fg font-medium">
                    {Math.min(page * pageSize, filteredRows.length)}
                  </strong>{' '}
                  de{' '}
                  <strong className="text-fg font-medium">
                    {filteredRows.length.toLocaleString()}
                  </strong>{' '}
                  {searchTerm ? 'registros filtrados' : 'registros'}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs gap-1 bg-surface border-border hover:bg-bg disabled:opacity-40"
                  >
                    <ChevronLeft size={13} />
                    <span>Anterior</span>
                  </Button>

                  <span className="text-muted font-mono text-[11px] px-2">
                    {page} / {totalPages}
                  </span>

                  <Button
                    variant="default"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="h-7 px-2 text-xs gap-1 bg-surface border-border hover:bg-bg disabled:opacity-40"
                  >
                    <span>Siguiente</span>
                    <ChevronRight size={13} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-end bg-bg/40">
          <Button variant="default" size="sm" onClick={onClose} className="h-8 text-xs">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
