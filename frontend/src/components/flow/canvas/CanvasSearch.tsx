import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { Search, CornerDownLeft } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { TYPE_LABELS } from '../inspector/types';
import { TYPE_ICONS } from '../inspector/InspectorHeader';

interface CanvasSearchProps {
  nodes: Node[];
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Quick finder for nodes on the canvas (Ctrl+K): matches name, type and id */
export function CanvasSearch({ nodes, onSelect, onClose }: CanvasSearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const scored = nodes.map(n => {
      const label = String(n.data?.label || n.id);
      const type = TYPE_LABELS[n.type || ''] || n.type || '';
      const haystack = normalize(`${label} ${type} ${n.id}`);
      const nl = normalize(label);
      const score = !q ? 1 : nl.startsWith(q) ? 3 : nl.includes(q) ? 2 : haystack.includes(q) ? 1 : 0;
      return { node: n, label, type, score };
    });
    return scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 12);
  }, [nodes, query]);

  const choose = (index: number) => {
    const result = results[index];
    if (result) {
      onSelect(result.node.id);
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex justify-center pt-16 bg-fg/10" onMouseDown={onClose}>
      <div
        className="w-full max-w-md h-fit bg-surface border border-border rounded-md shadow-raised overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={15} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(a => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(a => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(active);
              }
            }}
            placeholder="Buscar nodo por nombre, tipo o id…"
            className="flex-1 h-11 bg-transparent text-sm focus:outline-none"
          />
          <kbd className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">Ningún nodo coincide con «{query}».</p>
          ) : (
            results.map((r, idx) => {
              const Icon = TYPE_ICONS[r.node.type || ''] || Search;
              return (
                <button
                  key={r.node.id}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(idx)}
                  className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-left', idx === active ? 'bg-accent/10' : 'hover:bg-bg')}
                >
                  <Icon size={14} className="text-muted shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-fg truncate">{r.label}</span>
                    <span className="block text-[10px] text-muted truncate">{r.type} · {r.node.id}</span>
                  </span>
                  {idx === active && <CornerDownLeft size={12} className="text-accent shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
