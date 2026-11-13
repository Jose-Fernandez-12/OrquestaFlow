import React, { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import {
  HEADER_COLOR_PRESETS,
  exportQueryResultsToExcel,
  headerTextColorFor,
  loadHeaderColor,
  normalizeHexColor,
  saveHeaderColor,
} from '../../lib/queryExcelExport';

interface QueryExportMenuProps {
  columns: string[];
  rows: Array<Record<string, any>>;
  fileName: string;
}

export function QueryExportMenu({ columns, rows, fileName }: QueryExportMenuProps) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [color, setColor] = useState(loadHeaderColor);
  const [hexDraft, setHexDraft] = useState(color);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cierra el panel al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pickColor = (next: string) => {
    setColor(next);
    setHexDraft(next);
  };

  const onHexChange = (value: string) => {
    setHexDraft(value);
    const normalized = normalizeHexColor(value);
    if (normalized) setColor(normalized);
  };

  const onHexBlur = () => setHexDraft(color);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportQueryResultsToExcel(columns, rows, fileName, color);
      saveHeaderColor(color);
      dispatch(showToast('Excel exportado correctamente'));
      setOpen(false);
    } catch (err: any) {
      dispatch(showToast(`Error al exportar a Excel: ${err.message}`));
    } finally {
      setExporting(false);
    }
  };

  const previewText = headerTextColorFor(color);
  const hexValid = normalizeHexColor(hexDraft) !== null;

  return (
    <div className="relative" ref={containerRef}>
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="gap-2">
        <FileSpreadsheet size={14} /> Exportar Excel
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-72 p-4 rounded-md border border-border bg-surface shadow-raised space-y-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted">Color de la cabecera</span>
            <div className="flex flex-wrap gap-2">
              {HEADER_COLOR_PRESETS.map(preset => (
                <button
                  key={preset.color}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  onClick={() => pickColor(preset.color)}
                  className={cn(
                    'h-6 w-6 rounded-sm border border-border transition-shadow',
                    color.toUpperCase() === preset.color && 'ring-2 ring-accent ring-offset-1 ring-offset-surface'
                  )}
                  style={{ backgroundColor: preset.color }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color.toLowerCase()}
                onChange={e => pickColor(e.target.value.toUpperCase())}
                aria-label="Selector de color personalizado"
                className="h-7 w-9 cursor-pointer rounded-sm border border-border bg-surface p-0.5"
              />
              <input
                value={hexDraft}
                onChange={e => onHexChange(e.target.value)}
                onBlur={onHexBlur}
                maxLength={7}
                aria-label="Color hexadecimal"
                aria-invalid={!hexValid}
                className={cn(
                  'h-7 w-24 rounded-sm border bg-surface px-2 font-mono text-xs focus-visible:outline-none focus-visible:border-accent',
                  hexValid ? 'border-border' : 'border-danger text-danger'
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted">Vista previa</span>
            <div className="rounded-sm border border-border overflow-hidden text-xs font-mono">
              <div className="flex" style={{ backgroundColor: color, color: previewText, height: 24 }}>
                {columns.slice(0, 3).map(col => (
                  <span key={col} className="flex-1 px-2 flex items-center font-bold truncate">{col}</span>
                ))}
                {columns.length === 0 && <span className="px-2 flex items-center">Sin columnas</span>}
              </div>
              <div className="flex bg-bg text-fg">
                {columns.slice(0, 3).map(col => (
                  <span key={col} className="flex-1 px-2 py-1 truncate text-muted">{String(rows[0]?.[col] ?? '')}</span>
                ))}
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={exporting || !hexValid}
            className="w-full gap-2"
          >
            <Download size={14} /> {exporting ? 'Generando...' : 'Descargar .xlsx'}
          </Button>
        </div>
      )}
    </div>
  );
}
