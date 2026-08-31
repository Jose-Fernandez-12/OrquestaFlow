import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Play, Check, AlertCircle, Loader2 } from 'lucide-react';
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
  
  const Icon = data.icon;
  
  // Custom colors per node type based on the design
  const typeColors = {
    start: 'text-green-600',
    httpGet: 'text-blue-600',
    httpPost: 'text-indigo-600',
    scraping: 'text-purple-600',
    export: 'text-orange-600',
  };

  return (
    <div 
      className={cn(
        "bg-surface rounded-md border min-w-[200px] shadow-sm transition-all relative group",
        selected ? "border-accent shadow-focus" : "border-border hover:border-muted",
        executing && "border-accent ring-2 ring-accent/30 animate-pulse",
        completed && "border-success",
      )}
    >
      {/* Node Status Badge */}
      {executing && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-surface border border-accent rounded-full flex items-center justify-center text-accent shadow-sm">
          <Loader2 size={12} className="animate-spin" />
        </div>
      )}
      {completed && !executing && (
        <div className="absolute -top-3 -right-3 w-6 h-6 bg-success text-white rounded-full flex items-center justify-center shadow-sm">
          <Check size={12} strokeWidth={3} />
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
        </div>
      </div>
    </div>
  );
}
