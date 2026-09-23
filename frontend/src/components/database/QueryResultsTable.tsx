import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface QueryResultsTableProps {
  rows: Array<Record<string, any>>;
  columns: string[];
}

const PAGE_SIZES = [25, 50, 100, 250, 500];
const PAGE_SIZE_KEY = 'orquesta-query-page-size';

function loadPageSize(): number {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (PAGE_SIZES.includes(saved)) return saved;
  } catch {}
  return 50;
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function QueryResultsTable({ rows, columns }: QueryResultsTableProps) {
  const [pageSize, setPageSize] = useState(loadPageSize);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [prevRows, setPrevRows] = useState(rows);

  // New result set: go back to the first page
  if (rows !== prevRows) {
    setPrevRows(rows);
    setPage(1);
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageRows = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);

  const goTo = (target: number) => {
    setPage(Math.min(pageCount, Math.max(1, target)));
    setPageDraft(null);
  };

  const changePageSize = (size: number) => {
    const firstVisible = start;
    setPageSize(size);
    setPage(Math.floor(firstVisible / size) + 1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {}
  };

  const navButton = (label: string, target: number, disabled: boolean, Icon: React.ElementType) => (
    <button
      type="button"
      onClick={() => goTo(target)}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="h-7 w-7 flex items-center justify-center rounded-sm border border-border text-muted hover:text-fg hover:bg-bg disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon size={14} />
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="overflow-auto max-h-[560px]">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg border-b border-border">
              <th className="p-3 font-mono font-medium text-muted w-12 text-right">#</th>
              {columns.map(col => (
                <th key={col} className="p-3 font-mono font-medium text-muted whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr key={start + idx} className="border-b border-border hover:bg-bg/40 last:border-0">
                <td className="p-3 text-right font-mono text-[10px] text-muted">{start + idx + 1}</td>
                {columns.map(col => {
                  const isNull = row[col] === null || row[col] === undefined;
                  const text = formatCell(row[col]);
                  return (
                    <td key={col} className={cn('p-3 truncate max-w-[240px]', isNull && 'text-muted/50 italic')} title={text}>
                      {isNull ? 'NULL' : text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="p-6 text-center text-muted">
                  La consulta no devolvió registros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-bg/30 text-xs">
          <div className="flex items-center gap-2 text-muted">
            <span>
              Mostrando <b className="text-fg">{start + 1}–{Math.min(start + pageSize, total)}</b> de <b className="text-fg">{total.toLocaleString('es')}</b>
            </span>
            <span className="text-border">|</span>
            <label className="flex items-center gap-1.5">
              Filas por página
              <select
                value={pageSize}
                onChange={e => changePageSize(Number(e.target.value))}
                className="h-7 rounded-sm border border-border bg-surface px-1.5 text-xs focus-visible:outline-none focus-visible:border-accent"
              >
                {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1">
            {navButton('Primera página', 1, currentPage === 1, ChevronsLeft)}
            {navButton('Página anterior', currentPage - 1, currentPage === 1, ChevronLeft)}
            <span className="flex items-center gap-1 px-1.5 text-muted">
              Página
              <input
                value={pageDraft ?? String(currentPage)}
                onChange={e => setPageDraft(e.target.value.replace(/\D/g, ''))}
                onBlur={() => pageDraft !== null && goTo(Number(pageDraft) || 1)}
                onKeyDown={e => e.key === 'Enter' && pageDraft !== null && goTo(Number(pageDraft) || 1)}
                className="h-7 w-12 text-center rounded-sm border border-border bg-surface text-xs text-fg focus-visible:outline-none focus-visible:border-accent"
                aria-label="Número de página"
              />
              de {pageCount}
            </span>
            {navButton('Página siguiente', currentPage + 1, currentPage === pageCount, ChevronRight)}
            {navButton('Última página', pageCount, currentPage === pageCount, ChevronsRight)}
          </div>
        </div>
      )}
    </div>
  );
}
