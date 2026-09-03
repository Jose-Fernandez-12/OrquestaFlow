import React, { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Play, Check, AlertCircle, Loader2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    icon: React.ElementType;
    color?: string;
  };
  selected?: boolean;
  type: 'start' | 'httpGet' | 'httpPost' | 'scraping' | 'export';
}

export function BaseNode({ id, data, selected, type }: BaseNodeProps) {
  const executing = useAppSelector(state => state.flows.executingNodeIds.includes(id));
  const completed = useAppSelector(state => state.flows.completedNodeIds.includes(id));
  const hasError = useAppSelector(state => state.flows.errorNodeIds.includes(id));
  const nodeResult = useAppSelector(state => state.flows.nodeResults[id]);
  const progress = useAppSelector(state => state.flows.nodeProgress[id]);
  
  const Icon = data.icon;
  
  // Custom colors per node type based on the design
  const typeColors = {
    start: 'text-green-600',
    httpGet: 'text-blue-600',
    httpPost: 'text-indigo-600',
    scraping: 'text-purple-600',
    export: 'text-orange-600',
  };

  const dispatchEvent = () => {
    // We dispatch a custom event to tell FlowEditor to open the modal
    if (completed || hasError) {
      window.dispatchEvent(new CustomEvent('inspect-node-result', { detail: { id, result: nodeResult, hasError, label: data.label } }));
    }
  };

  return (
    <div 
      onDoubleClick={dispatchEvent}
      className={cn(
        "bg-surface rounded-md border min-w-[200px] shadow-sm transition-all relative group",
        selected ? "border-accent shadow-focus" : "border-border hover:border-muted",
        executing && "border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/10",
        completed && !hasError && "border-success",
        hasError && "border-red-500 ring-2 ring-red-500/30 bg-red-50",
      )}
    >
      {/* Node Status Badge */}
      {executing && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-surface border border-blue-500 rounded-full flex items-center justify-center text-blue-500 shadow-sm">
          <Loader2 size={12} className="animate-spin" />
        </div>
      )}
      {completed && !executing && !hasError && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-success text-white rounded-full flex items-center justify-center shadow-sm">
          <Check size={12} strokeWidth={3} />
        </div>
      )}
      {hasError && !executing && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm">
          <X size={12} strokeWidth={3} />
        </div>
      )}

      {/* Handles */}
      {type !== 'start' && (
        <Handle 
          type="target" 
          position={Position.Left} 
          className="w-3 h-3 border-2 border-surface bg-muted group-hover:bg-accent" 
        />
      )}
      {type !== 'export' && (
        <Handle 
          type="source" 
          position={Position.Right} 
          className="w-3 h-3 border-2 border-surface bg-muted group-hover:bg-accent" 
        />
      )}

      {/* Content */}
      <div className="p-3 flex items-center gap-3">
        <div className={cn("p-2 rounded-sm bg-bg", typeColors[type] || 'text-fg')}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{data.label}</div>
          <div className="text-xs text-muted truncate capitalize">{
            type === 'httpGet' ? 'HTTP Request' : 
            type === 'httpPost' ? 'HTTP Request' : 
            type
          }</div>
          {executing && progress && (
            <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-blue-500">
              <div className="flex-1 mr-2 bg-blue-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
              <span>{progress.current}/{progress.total}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
