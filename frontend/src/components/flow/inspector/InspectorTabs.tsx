import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import type { TabDefinition } from './types';
import { Check, AlertTriangle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';

interface InspectorTabsProps {
  tabs: TabDefinition[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function InspectorTabs({ tabs, activeTab, onChange }: InspectorTabsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateArrows, tabs.length]);

  // Keep the active tab visible when it changes
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' });
  };

  const arrowClass =
    'absolute top-0 bottom-0 z-20 w-7 flex items-center justify-center text-muted hover:text-accent transition-colors';

  return (
    <div className="relative border-b border-border bg-bg/50 shrink-0">
      {canLeft && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className={cn(arrowClass, 'left-0 bg-gradient-to-r from-surface via-surface to-transparent')}
          title="Pestañas anteriores"
        >
          <ChevronLeft size={15} strokeWidth={2.5} />
        </button>
      )}

      <div
        ref={scrollerRef}
        onScroll={updateArrows}
        className="flex px-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all whitespace-nowrap rounded-t-lg border-b-2',
                isActive
                  ? 'text-accent bg-surface border-accent shadow-sm z-10'
                  : 'text-muted hover:text-fg hover:bg-bg/50 border-transparent hover:border-border-hover'
              )}
            >
              {Icon && <Icon size={14} strokeWidth={2.5} className={isActive ? 'text-accent' : 'text-current'} />}
              <span className="font-medium">{tab.label}</span>

              {/* Badge count */}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none',
                  isActive
                    ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
                    : 'bg-muted/10 text-muted'
                )}>
                  {tab.badge}
                </span>
              )}

              {/* Status indicator */}
              {tab.status === 'ok' && (
                <Check size={11} strokeWidth={2.5} className="text-emerald-500" />
              )}
              {tab.status === 'warning' && (
                <AlertTriangle size={11} strokeWidth={2.5} className="text-amber-500" />
              )}
              {tab.status === 'error' && (
                <AlertCircle size={11} strokeWidth={2.5} className="text-red-500" />
              )}
            </button>
          );
        })}
      </div>

      {canRight && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          className={cn(arrowClass, 'right-0 bg-gradient-to-l from-surface via-surface to-transparent')}
          title="Más pestañas"
        >
          <ChevronRight size={15} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
