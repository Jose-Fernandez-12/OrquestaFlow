import React, { useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { Check, ChevronDown, Sparkles, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { TYPE_ICONS } from '../InspectorHeader';
import { TYPE_LABELS, TYPE_COLORS, TYPE_BG_COLORS } from '../types';

interface NodeSourcePickerProps {
  nodes: Node[];
  value: string;
  onChange: (nodeId: string) => void;
  autoLabel?: string;
  autoHint?: string;
}

function NodeBadge({ node }: { node: Node }) {
  const type = node.type || '';
  const Icon = TYPE_ICONS[type] || FileSpreadsheet;
  return (
    <span className={cn('p-1.5 rounded-md shrink-0', TYPE_BG_COLORS[type] || 'bg-bg', TYPE_COLORS[type] || 'text-fg')}>
      <Icon size={13} />
    </span>
  );
}

/** Card-style picker for choosing which upstream node feeds this one ("" = automatic). */
export function NodeSourcePicker({
  nodes,
  value,
  onChange,
  autoLabel = 'Automático',
  autoHint = 'Último nodo ejecutado',
}: NodeSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = nodes.find(n => n.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const row = (id: string, content: React.ReactNode) => (
    <button
      key={id || 'auto'}
      type="button"
      onClick={() => pick(id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-left transition-colors',
        value === id ? 'bg-accent/10' : 'hover:bg-bg'
      )}
    >
      {content}
      {value === id && <Check size={13} className="text-accent ml-auto shrink-0" />}
    </button>
  );

  const autoContent = (
    <>
      <span className="p-1.5 rounded-md shrink-0 bg-accent/10 text-accent"><Sparkles size={13} /></span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-fg">{autoLabel}</span>
        <span className="block text-[10px] text-muted">{autoHint}</span>
      </span>
    </>
  );

  const nodeContent = (n: Node) => (
    <>
      <NodeBadge node={n} />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-fg truncate">{(n.data?.label as string) || n.id}</span>
        <span className="block text-[10px] text-muted truncate">{TYPE_LABELS[n.type || ''] || n.type}</span>
      </span>
    </>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-sm border bg-surface text-left transition-colors',
          open ? 'border-accent ring-2 ring-accent/15' : 'border-border hover:border-border-hover'
        )}
      >
        {selected ? nodeContent(selected) : autoContent}
        <ChevronDown size={14} className={cn('ml-auto text-muted shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 p-1 bg-surface border border-border rounded-sm shadow-raised flex flex-col gap-0.5 max-h-72 overflow-y-auto">
          {row('', autoContent)}
          {nodes.length > 0 && (
            <span className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted font-semibold">Nodos anteriores</span>
          )}
          {nodes.map(n => row(n.id, nodeContent(n)))}
        </div>
      )}
    </div>
  );
}
