import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Braces, Search, Repeat } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useAvailableVariables } from '../useAvailableVariables';

interface VariablePickerProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onSelect: (expression: string) => void;
  className?: string;
}

export function VariablePicker({ node, nodes, edges, onSelect, className }: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const groups = useAvailableVariables(node, nodes, edges);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map(g => ({
        ...g,
        variables: g.variables.filter(v => v.label.toLowerCase().includes(term) || v.expression.toLowerCase().includes(term)),
      }))
      .filter(g => g.variables.length > 0);
  }, [groups, search]);

  return (
    <div ref={containerRef} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'h-8 px-2 flex items-center gap-1 rounded-sm border text-[11px] font-medium transition-colors',
          open ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted hover:text-accent hover:border-accent bg-surface'
        )}
        title="Insertar una variable de un nodo anterior"
      >
        <Braces size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[80vw] bg-surface border border-border rounded-md shadow-lg z-40 overflow-hidden">
          <div className="p-2 border-b border-border relative">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar campo o nodo…"
              className="w-full h-7 pl-7 pr-2 bg-bg border border-border rounded text-[11px] focus:outline-none focus:border-accent"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && (
              <p className="px-3 py-4 text-[11px] text-muted text-center">
                Conecta un nodo anterior que produzca datos para poder usar sus campos.
              </p>
            )}
            {groups.length > 0 && filtered.length === 0 && (
              <p className="px-3 py-4 text-[11px] text-muted text-center">Sin resultados para "{search}".</p>
            )}
            {filtered.map(group => (
              <div key={group.id} className="py-0.5">
                <div className={cn('px-3 py-1 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1', group.color)}>
                  {group.id === 'loop' && <Repeat size={10} />}
                  <span className="truncate">{group.label}</span>
                </div>
                {group.variables.map(v => (
                  <button
                    key={v.expression}
                    type="button"
                    onClick={() => {
                      onSelect(v.expression);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-bg flex items-center justify-between gap-2 group"
                    title={v.expression}
                  >
                    <span className="text-[11px] font-mono text-fg truncate">{v.label}</span>
                    {v.type && (
                      <span className="text-[9px] text-muted font-mono bg-bg group-hover:bg-surface px-1 rounded border border-border shrink-0">
                        {v.type}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {groups.some(g => g.label.endsWith('sin ejecutar')) && (
            <p className="px-3 py-1.5 border-t border-border text-[10px] text-muted bg-bg/60">
              Ejecuta el flujo (o usa el modo debug) para descubrir los campos de los nodos marcados como "sin ejecutar".
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface VariableFieldProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  type?: string;
}

// Text input with a variable picker that inserts {{...}} at the caret (or replaces the selection)
export function VariableField({ node, nodes, edges, value, onChange, placeholder, multiline, rows = 4, className, type }: VariableFieldProps) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const insert = (expression: string) => {
    const el = inputRef.current;
    const current = value || '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + expression + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + expression.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const fieldClass = cn(
    'flex w-full rounded-sm border border-border bg-surface px-2.5 text-xs font-mono text-fg placeholder:text-muted focus-visible:outline-none focus-visible:border-accent',
    multiline ? 'py-2 min-h-[80px] resize-y' : 'h-8',
    className
  );

  return (
    <div className={cn('flex gap-1.5', multiline ? 'items-start' : 'items-center')}>
      {multiline ? (
        <textarea ref={inputRef} rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={fieldClass} />
      ) : (
        <input ref={inputRef} type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={fieldClass} />
      )}
      <VariablePicker node={node} nodes={nodes} edges={edges} onSelect={insert} />
    </div>
  );
}
