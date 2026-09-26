import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { TYPE_LABELS, TYPE_COLORS, TYPE_BG_COLORS } from './types';
import {
  Play, Globe, Code, FileOutput, Database, Clock,
  FileSpreadsheet, List, Repeat, Square, Check, Loader2, X,
  Pause, GitFork, Braces, Radio, KeyRound, Bot, SlidersHorizontal
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';
import type { Node } from '@xyflow/react';

export const TYPE_ICONS: Record<string, React.ElementType> = {
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
  variables: SlidersHorizontal,
  forEach: Repeat,
  forEachEnd: Square,
  conditionalBranch: GitFork,
  jsonTransform: Braces,
  webhookTrigger: Radio,
  oauth2Connector: KeyRound,
  aiChatCompletion: Bot,
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
    <div className="p-5 border-b border-border flex flex-col gap-3 bg-gradient-to-b from-surface to-bg/20">
      {/* Top row: icon + type badge + status + close */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('p-2.5 rounded-lg shrink-0 shadow-sm', bgClass, colorClass)}>
            <Icon size={18} />
          </div>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
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
                className="text-sm font-semibold text-fg text-left truncate max-w-[220px] hover:text-accent transition-colors cursor-text leading-tight"
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
            <div className="w-7 h-7 bg-state-paused-bg border-2 border-state-paused text-state-paused rounded-full flex items-center justify-center shadow-sm">
              <Pause size={12} strokeWidth={2.5} className="fill-current" />
            </div>
          )}
          {executing && !paused && (
            <div className="w-7 h-7 bg-state-executing-bg border-2 border-state-executing text-state-executing rounded-full flex items-center justify-center shadow-sm">
              <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
            </div>
          )}
          {completed && !executing && !hasError && (
            <div className="w-7 h-7 bg-success text-white rounded-full flex items-center justify-center shadow-sm">
              <Check size={13} strokeWidth={3} />
            </div>
          )}
          {hasError && !executing && (
            <div className="w-7 h-7 bg-danger text-white rounded-full flex items-center justify-center shadow-sm">
              <X size={13} strokeWidth={3} />
            </div>
          )}

          {/* Node ID tooltip */}
          <span
            className="text-[9px] text-muted-light font-mono bg-bg px-2 py-1 rounded border border-border-light cursor-default select-all shadow-sm"
            title={`ID: ${node.id}`}
          >
            {node.id.length > 12 ? node.id.slice(0, 12) + '...' : node.id}
          </span>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-bg transition-colors cursor-pointer"
              title="Cerrar panel de propiedades"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
