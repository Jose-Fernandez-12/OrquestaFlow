import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { TYPE_LABELS, TYPE_COLORS, TYPE_BG_COLORS } from './types';
import {
  Play, Globe, Code, FileOutput, Database, Clock,
  FileSpreadsheet, List, Repeat, Square, Check, Loader2, X,
  Pause, GitFork, Braces, Radio, KeyRound, Bot, SlidersHorizontal, Copy, StickyNote
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
  note: StickyNote,
};

const hasErrorContinued = (result: any) => Boolean(result && typeof result === 'object' && result.continued);

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
  const continuedAfterError = useAppSelector(state => hasErrorContinued(state.flows.nodeResults[node.id]));

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard?.writeText(node.id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
            <div
              className={cn('w-7 h-7 text-white rounded-full flex items-center justify-center shadow-sm', continuedAfterError ? 'bg-amber-500' : 'bg-danger')}
              title={continuedAfterError ? 'Falló, pero el flujo continuó' : 'Error'}
            >
              <X size={13} strokeWidth={3} />
            </div>
          )}

          {/* Node ID: used in expressions like {{id.campo}} */}
          <button
            type="button"
            onClick={copyId}
            className={cn(
              'flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded border shadow-sm transition-colors',
              copied
                ? 'text-emerald-600 border-emerald-500/40 bg-emerald-500/5'
                : 'text-muted-light bg-bg border-border-light hover:text-accent hover:border-accent/40'
            )}
            title={`ID del nodo: ${node.id}\nÚsalo en expresiones como {{${node.id}.campo}}. Clic para copiar.`}
          >
            {copied ? <Check size={10} strokeWidth={2.5} /> : <Copy size={10} />}
            {copied ? 'Copiado' : node.id.length > 12 ? node.id.slice(0, 12) + '…' : node.id}
          </button>

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
