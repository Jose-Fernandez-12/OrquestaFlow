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
    <div className="flex border-b border-border bg-bg/50 px-1 gap-0.5 overflow-x-auto shrink-0">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap rounded-t-md',
              isActive
                ? 'text-accent bg-surface border-b-2 border-accent -mb-px'
                : 'text-muted hover:text-fg hover:bg-surface/50'
            )}
          >
            {Icon && <Icon size={13} className={isActive ? 'text-accent' : 'text-muted'} />}
            <span>{tab.label}</span>

            {/* Badge count */}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                'ml-0.5 px-1.5 py-0 rounded-full text-[9px] font-mono leading-[16px]',
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'bg-bg text-muted border border-border'
              )}>
                {tab.badge}
              </span>
            )}

            {/* Status indicator */}
            {tab.status === 'ok' && (
              <Check size={10} className="text-emerald-500 ml-0.5" />
            )}
            {tab.status === 'warning' && (
              <AlertTriangle size={10} className="text-amber-500 ml-0.5" />
            )}
            {tab.status === 'error' && (
              <AlertCircle size={10} className="text-red-500 ml-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
