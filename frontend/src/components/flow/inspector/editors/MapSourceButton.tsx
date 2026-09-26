import React, { useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { ChevronDown, Link2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { JsonSelectorModal } from './JsonSelectorModal';

interface MapSourceButtonProps {
  nodes: Node[];
  onSelectValue: (val: string) => void;
  label?: string;
  className?: string;
}

/**
 * Single compact "Mapear" trigger. With one upstream node it opens the selector
 * directly; with several it shows a menu to pick the source node, instead of
 * rendering one chip per node.
 */
export function MapSourceButton({ nodes, onSelectValue, label = 'Mapear', className }: MapSourceButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (nodes.length === 0) return null;

  if (nodes.length === 1) {
    return (
      <JsonSelectorModal
        node={nodes[0]}
        customLabel={label}
        className={cn('max-w-[150px]', className)}
        onSelectValue={onSelectValue}
      />
    );
  }

  return (
    <div ref={ref} className={cn('relative inline-flex shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors',
          open ? 'bg-accent/20 text-accent border-accent/40' : 'bg-accent/10 text-accent border-accent/25 hover:bg-accent/20'
        )}
        title="Elegir el nodo del que tomar el valor"
      >
        <Link2 size={10} />
        <span>{label}</span>
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {/* Kept mounted (only hidden) so the selector modal survives the menu closing */}
      <div
        className={cn(
          'absolute right-0 top-full mt-1 z-30 w-56 p-1 bg-surface border border-border rounded-sm shadow-raised flex-col gap-0.5',
          open ? 'flex' : 'hidden'
        )}
        onClick={() => setOpen(false)}
      >
        <span className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted font-semibold">Tomar valor de</span>
        {nodes.map(n => (
          <JsonSelectorModal
            key={n.id}
            node={n}
            customLabel={(n.data?.label as string) || n.id}
            className="w-full max-w-none justify-start px-2 py-1.5 text-[11px]"
            onSelectValue={onSelectValue}
          />
        ))}
      </div>
    </div>
  );
}
