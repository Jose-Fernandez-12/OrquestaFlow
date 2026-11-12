import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { downloadAsXMLSpreadsheet, getHeaderTextColor, normalizeHexColor, toExportCell } from '../../lib/exportUtils';
import {
  QUERY_EXPORT_COLOR_PRESETS,
  buildExportColumns,
  defaultQueryExportFileName,
  loadQueryExportHeaderColor,
  sanitizeFileName,
  saveQueryExportHeaderColor,
  selectExportRows,
  type QueryExportScope,
} from '../../lib/queryExport';
import { cn } from '../../lib/utils';

interface QueryExportModalProps {
  queryName?: string;
  columns: string[];
  allRows: Array<Record<string, any>>;
  pageRows: Array<Record<string, any>>;
  onClose: () => void;
}

const PREVIEW_COLUMN_LIMIT = 4;

export function QueryExportModal({ queryName, columns, allRows, pageRows, onClose }: QueryExportModalProps) {
  const [scope, setScope] = useState<QueryExportScope>('all');
  const [fileName, setFileName] = useState(() => defaultQueryExportFileName(queryName));
  const [color, setColor] = useState(loadQueryExportHeaderColor);

  const exportRows = selectExportRows(scope, allRows, pageRows);
  const previewColumns = columns.slice(0, PREVIEW_COLUMN_LIMIT);
  const sampleRow = exportRows[0] ?? {};
  const headerTextColor = getHeaderTextColor(color);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleExport = () => {
    saveQueryExportHeaderColor(color);
    downloadAsXMLSpreadsheet(
      exportRows,
      buildExportColumns(columns),
      sanitizeFileName(fileName) || defaultQueryExportFileName(queryName),
      color
    );
    onClose();
  };

  const scopeOptions: Array<{ value: QueryExportScope; label: string }> = [
    { value: 'all', label: `Todas las filas (${allRows.length.toLocaleString('es')})` },
    { value: 'page', label: `Solo la página actual (${pageRows.length.toLocaleString('es')})` },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-export-title"
        className="bg-surface rounded-lg shadow-raised border border-border w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 bg-bg/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-md bg-orange-500/10 text-orange-600 flex items-center justify-center">
              <FileSpreadsheet size={18} />
            </div>
            <div className="min-w-0">
              <h2 id="query-export-title" className="text-base font-semibold text-fg">
                Exportar a Excel
              </h2>
              <p className="text-xs text-muted truncate" title={queryName || 'Resultados de la consulta'}>
                {queryName || 'Resultados de la consulta'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="shrink-0 p-1.5 hover:bg-bg rounded-md text-muted hover:text-fg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-5 overflow-y-auto min-h-0">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-fg mb-1">Filas a exportar</legend>
            {scopeOptions.map(option => (
              <label key={option.value} className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                <input
                  type="radio"
                  name="query-export-scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="query-export-file-name" className="text-xs font-medium text-fg">
              Nombre del archivo
            </label>
            <Input
              id="query-export-file-name"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              aria-describedby="query-export-file-hint"
              className="h-9 text-xs font-mono"
              autoFocus
            />
            <p id="query-export-file-hint" className="text-[11px] text-muted">
              Se descargará como hoja de cálculo de Excel (.xls).
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-fg mb-1">Color de la cabecera</legend>
            <div className="flex flex-wrap items-center gap-2">
              {QUERY_EXPORT_COLOR_PRESETS.map(preset => (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => setColor(preset.hex)}
                  aria-label={`Color ${preset.label}`}
                  aria-pressed={color === preset.hex}
                  title={`${preset.label} (${preset.hex})`}
                  style={{ backgroundColor: preset.hex }}
                  className={cn(
                    'h-7 w-7 rounded-sm border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    color === preset.hex && 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                  )}
                />
              ))}
              <span className="text-border">|</span>
              <input
                type="color"
                value={color.toLowerCase()}
                onChange={e => {
                  const picked = normalizeHexColor(e.target.value);
                  if (picked) setColor(picked);
                }}
                aria-label="Color personalizado"
                title="Color personalizado"
                className="h-7 w-9 cursor-pointer rounded-sm border border-border bg-surface p-0.5"
              />
              <span className="font-mono text-xs text-muted">{color}</span>
            </div>
          </fieldset>

          {/* Preview */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg">Vista previa</span>
            <div className="rounded-md border border-border overflow-hidden bg-surface">
              <table className="w-full table-fixed text-xs">
                <thead>
                  <tr style={{ backgroundColor: color, color: headerTextColor }}>
                    {previewColumns.map(col => (
                      <th key={col} title={col} className="px-2.5 py-2 text-left font-semibold truncate">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {previewColumns.map(col => {
                      const text = toExportCell(sampleRow[col]).text;
                      return (
                        <td key={col} title={text} className="px-2.5 py-1.5 font-mono text-fg truncate border-t border-border">
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
              {columns.length > PREVIEW_COLUMN_LIMIT && (
                <p className="px-2.5 py-1.5 text-[11px] text-muted border-t border-border">
                  y {columns.length - PREVIEW_COLUMN_LIMIT} columna(s) más
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-end gap-2 bg-surface">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleExport} className="gap-2">
            <Download size={14} />
            Exportar
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
