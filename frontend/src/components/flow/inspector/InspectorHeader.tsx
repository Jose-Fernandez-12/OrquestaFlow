import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { TYPE_LABELS, TYPE_COLORS, TYPE_BG_COLORS } from './types';
import {
  Play, Globe, Code, FileOutput, Database, Clock,
  FileSpreadsheet, List, Repeat, Square, Check, Loader2, X,
  Pause
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';
import type { Node } from '@xyflow/react';

const TYPE_ICONS: Record<string, React.ElementType> = {
  start: Play,
  httpGet: Globe,
  httpPost: Globe,
  httpRequest: Globe,
  scraping: Code,
  export: FileOutput,
  query: Database,
  timer: Clock,
  delay: Clock,
  dataSource: FileSpreadsheet,
  fileSource: FileSpreadsheet,
  dataList: List,
  forEach: Repeat,
  forEachEnd: Square,
};

interface InspectorHeaderProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  onClose?: () => void;
}

export function InspectorHeader({ node, updateNodeData, onClose }: InspectorHeaderProps) {
  const type = node.type || 'unknown';
  const Icon = TYPE_ICONS[type] || FileSpreadsheet;
  const colorClass = TYPE_COLORS[type] || 'text-fg';
  const bgClass = TYPE_BG_COLORS[type] || 'bg-bg';
  const typeLabel = TYPE_LABELS[type] || type;

  const executing = useAppSelector(state => state.flows.executingNodeIds.includes(node.id));
  const completed = useAppSelector(state => state.flows.completedNodeIds.includes(node.id));
  const hasError = useAppSelector(state => state.flows.errorNodeIds.includes(node.id));
  const paused = useAppSelector(state => state.flows.pausedNodeIds.includes(node.id));

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    setEditValue((node.data?.label as string) || '');
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== (node.data?.label as string)) {
      updateNodeData('label', trimmed);
    }
    setIsEditing(false);
  };

  return (
    <div className="p-4 border-b border-border flex flex-col gap-2">
      {/* Top row: icon + type badge + status + close */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn('p-2 rounded-md shrink-0', bgClass, colorClass)}>
            <Icon size={18} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-muted uppercase tracking-wider">
              {typeLabel}
            </span>
            {/* Editable label */}
            {isEditing ? (
              <Input
                autoFocus
                className="h-7 text-sm font-semibold px-1 -ml-1 mt-0.5"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="text-sm font-semibold text-fg text-left truncate max-w-[220px] hover:text-accent transition-colors cursor-text"
                title="Clic para editar nombre"
              >
                {(node.data?.label as string) || 'Sin nombre'}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status indicator */}
          {paused && (
            <div className="w-6 h-6 bg-amber-100 border border-amber-400 text-amber-600 rounded-full flex items-center justify-center">
              <Pause size={11} className="fill-amber-600" />
            </div>
          )}
          {executing && !paused && (
            <div className="w-6 h-6 bg-surface border border-blue-500 text-blue-500 rounded-full flex items-center justify-center">
              <Loader2 size={11} className="animate-spin" />
            </div>
          )}
          {completed && !executing && !hasError && (
            <div className="w-6 h-6 bg-success text-white rounded-full flex items-center justify-center">
              <Check size={11} strokeWidth={3} />
            </div>
          )}
          {hasError && !executing && (
            <div className="w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
              <X size={11} strokeWidth={3} />
            </div>
          )}

          {/* Node ID tooltip */}
          <span
            className="text-[9px] text-muted font-mono bg-bg px-1.5 py-0.5 rounded border border-border cursor-default select-all"
            title={`ID: ${node.id}`}
          >
            {node.id.length > 12 ? node.id.slice(0, 12) + '...' : node.id}
          </span>
        </div>
      </div>
    </div>
  );
}
