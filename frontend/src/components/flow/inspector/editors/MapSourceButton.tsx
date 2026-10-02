import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Node } from '@xyflow/react';
import { ChevronDown, Link2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { JsonSelectorModal } from './JsonSelectorModal';

interface MapSourceButtonProps {
  nodes: Node[];
  onSelectValue: (val: string) => void;
  label?: string;
  className?: string;
  /** Small link icon instead of the labelled chip, for placing inside inputs */
  iconOnly?: boolean;
}

const MENU_WIDTH = 224;

/**
 * Single compact "Mapear" trigger. With one upstream node it opens the selector
 * directly; with several it shows a menu to pick the source node, instead of
 * rendering one chip per node.
 */
export function MapSourceButton({ nodes, onSelectValue, label = 'Mapear', className, iconOnly = false }: MapSourceButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // The menu is fixed-positioned, so close it instead of letting it drift when the panel scrolls
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as globalThis.Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Rendered in a portal (outside the inspector's overflow/stacking contexts) and placed
  // under the trigger, or above it when there's no room below.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 200;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const placeAbove = below < menuH && above > below;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({
      top: placeAbove ? Math.max(8, r.top - 4 - Math.min(menuH, above)) : r.bottom + 4,
      left,
      maxHeight: Math.max(120, placeAbove ? above : below),
    });
  }, [open]);

  if (nodes.length === 0) return null;

  if (nodes.length === 1) {
    return (
      <JsonSelectorModal
        node={nodes[0]}
        customLabel={label}
        className={cn(!iconOnly && 'max-w-[150px]', className)}
        onSelectValue={onSelectValue}
        iconOnly={iconOnly}
      />
    );
  }

  return (
    <div ref={ref} className={cn('relative inline-flex shrink-0', className)}>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'p-1 rounded transition-colors',
            open ? 'text-accent bg-accent/10' : 'text-muted hover:text-accent hover:bg-accent/10'
          )}
          title={label}
        >
          <Link2 size={12} />
        </button>
      ) : (
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
      )}

      {/* Kept mounted (only hidden) so the selector modal survives the menu closing */}
      {createPortal(
        <div
          ref={menuRef}
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, maxHeight: pos?.maxHeight }}
          className={cn(
            'fixed z-50 p-1 bg-surface border border-border rounded-sm shadow-raised flex-col gap-0.5 overflow-y-auto',
            open ? 'flex' : 'hidden',
            open && !pos && 'invisible'
          )}
          onClick={() => setOpen(false)}
        >
          <span className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted font-semibold">Tomar valor de</span>
          {nodes.map(n => (
            <JsonSelectorModal
              key={n.id}
              node={n}
              customLabel={(n.data?.label as string) || n.id}
              className="w-full max-w-none justify-start px-2 py-1.5 text-[11px] shrink-0"
              onSelectValue={onSelectValue}
            />
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
