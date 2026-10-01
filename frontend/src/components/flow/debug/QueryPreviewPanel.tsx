import { useState } from 'react';
import { Copy, Check, Database, AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { ResolvedReference } from './ResolvedReferences';

export interface QueryPreview {
  kind: 'query';
  queryName: string | null;
  connection: { name: string; database: string | null; driver: string } | null;
  sql: string;
  sqlPreview: string;
  params: Array<{ name: string; template: string | null; value: any; missing: boolean }>;
  references?: ResolvedReference[];
}

function formatValue(value: any): string {
  if (value === undefined || value === null) return "'' (vacío)";
  if (Array.isArray(value)) return value.map(v => JSON.stringify(v)).join(', ');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function SqlBlock({ title, sql, hint }: { title: string; sql: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="p-3 bg-surface rounded-md border border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-fg">{title}</span>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-muted hover:text-fg px-2 py-0.5 rounded border border-border hover:bg-bg transition-colors flex items-center gap-1 cursor-pointer"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
      </div>
      <pre className="p-3 bg-bg rounded border border-border font-mono text-xs text-fg select-text leading-relaxed max-h-72 overflow-auto whitespace-pre-wrap">
        {sql}
      </pre>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/** How a query node's statement is built: its parameters, where each value comes from and the final SQL. */
export function QueryPreviewPanel({ preview }: { preview: QueryPreview }) {
  const missing = preview.params.filter(p => p.missing);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
      <div className="p-3 bg-surface rounded-md border border-border flex items-center gap-3">
        <span className="w-8 h-8 rounded bg-accent/10 text-accent flex items-center justify-center shrink-0">
          <Database size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg truncate">{preview.queryName || 'Consulta sin nombre'}</div>
          <div className="text-[11px] text-muted truncate">
            {preview.connection
              ? `${preview.connection.name}${preview.connection.database ? ` · ${preview.connection.database}` : ''}`
              : 'Conexión no encontrada'}
          </div>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="p-2.5 rounded-md border border-rose-500/30 bg-rose-500/5 text-xs text-rose-700 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {missing.length === 1 ? 'El parámetro' : 'Los parámetros'}{' '}
            <b>{missing.map(p => p.name).join(', ')}</b> no {missing.length === 1 ? 'tiene' : 'tienen'} valor y se
            {missing.length === 1 ? ' enviará' : ' enviarán'} como texto vacío ('').
          </span>
        </div>
      )}

      <div className="p-3 bg-surface rounded-md border border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Parámetros</span>
          <span className="text-[10px] font-mono text-muted">{preview.params.length} parámetros</span>
        </div>
        {preview.params.length === 0 ? (
          <p className="text-xs text-muted italic p-2 bg-bg rounded border border-border">La consulta no usa parámetros (#param_)</p>
        ) : (
          <div className="bg-bg rounded border border-border overflow-hidden">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
                  <th className="p-2 font-medium">Parámetro</th>
                  <th className="p-2 font-medium">Origen</th>
                  <th className="p-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {preview.params.map(p => (
                  <tr key={p.name} className={cn('border-b border-border last:border-b-0 align-top', p.missing && 'bg-rose-500/5')}>
                    <td className="p-2 text-fg">#param_{p.name}</td>
                    <td className="p-2 text-accent break-all">{p.template ?? <span className="text-muted italic">sin configurar</span>}</td>
                    <td className={cn('p-2 break-all', p.missing ? 'text-rose-600 italic' : 'text-fg')}>{formatValue(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SqlBlock
        title="SQL con valores"
        sql={preview.sqlPreview}
        hint="Solo para revisar: la consulta real envía los valores como parámetros, no como texto dentro del SQL."
      />
      <SqlBlock title="SQL guardado" sql={preview.sql} />
    </div>
  );
}
