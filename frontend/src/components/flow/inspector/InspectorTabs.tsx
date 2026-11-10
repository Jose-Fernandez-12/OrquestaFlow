import React from 'react';
import { cn } from '../../../lib/utils';
import type { TabDefinition } from './types';
import { Check, AlertTriangle, AlertCircle } from 'lucide-react';

interface InspectorTabsProps {
  tabs: TabDefinition[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

/**
 * Tabs of a node's properties. They wrap onto a second row when the panel is narrow, so every
 * section stays visible instead of hiding behind a scroll arrow.
 */
export function InspectorTabs({ tabs, activeTab, onChange }: InspectorTabsProps) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex(t => t.id === activeTab);
    if (index < 0) return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus();
  };

  return (
    <div role="tablist" onKeyDown={onKeyDown} className="flex flex-wrap gap-1 px-3 py-2 border-b border-border bg-bg/50 shrink-0">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            data-tab-id={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap rounded-md border transition-colors',
              isActive
                ? 'text-accent bg-surface border-accent/40 shadow-sm'
                : 'text-muted border-transparent hover:text-fg hover:bg-surface/70'
            )}
          >
            {Icon && <Icon size={13} strokeWidth={2.5} />}
            <span>{tab.label}</span>

            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none',
                isActive ? 'bg-accent/10 text-accent' : 'bg-muted/10 text-muted'
              )}>
                {tab.badge}
              </span>
            )}

            {tab.status === 'ok' && <Check size={11} strokeWidth={2.5} className="text-success" aria-label="Completo" />}
            {tab.status === 'warning' && <AlertTriangle size={11} strokeWidth={2.5} className="text-warn" aria-label="Con avisos" />}
            {tab.status === 'error' && <AlertCircle size={11} strokeWidth={2.5} className="text-danger" aria-label="Con errores" />}
          </button>
        );
      })}
    </div>
  );
}
