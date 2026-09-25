import React from 'react';
import { cn } from '../../../lib/utils';
import type { TabDefinition } from './types';
import { Check, AlertTriangle, AlertCircle } from 'lucide-react';

interface InspectorTabsProps {
  tabs: TabDefinition[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function InspectorTabs({ tabs, activeTab, onChange }: InspectorTabsProps) {
  return (
    <div className="flex border-b border-border bg-bg/50 px-1 gap-1 overflow-x-auto shrink-0">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all whitespace-nowrap rounded-t-lg border-b-2',
              isActive
                ? 'text-accent bg-surface border-accent shadow-sm -mb-px z-10'
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
  );
}
