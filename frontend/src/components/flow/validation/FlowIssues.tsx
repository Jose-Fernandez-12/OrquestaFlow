import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { cn } from '../../../lib/utils';
import type { FlowIssue } from './flowValidation';

/** Small corner badge for a node on the canvas */
export function NodeIssueBadge({ issues }: { issues: FlowIssue[] }) {
  if (issues.length === 0) return null;
  const hasError = issues.some(i => i.level === 'error');
  const Icon = hasError ? AlertCircle : AlertTriangle;
  return (
    <div
      className={cn(
        'absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full flex items-center justify-center shadow-sm z-20 border-2 border-surface',
        hasError ? 'bg-danger text-white' : 'bg-amber-400 text-white'
      )}
      title={issues.map(i => `• ${i.message}`).join('\n')}
    >
      <Icon size={11} strokeWidth={2.75} />
    </div>
  );
}

/** Issues of the selected node, shown at the top of the inspector */
export function NodeIssuesBanner({ issues: all }: { issues: FlowIssue[] }) {
  const issues = all.filter(i => !i.inline);
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {issues.map((issue, idx) => {
        const isError = issue.level === 'error';
        const Icon = isError ? AlertCircle : AlertTriangle;
        return (
          <div
            key={idx}
            className={cn(
              'flex items-start gap-2 px-3 py-2 rounded-sm border text-[11px] leading-relaxed',
              isError ? 'border-danger/30 bg-danger/5 text-danger' : 'border-amber-400/50 bg-amber-500/5 text-amber-700'
            )}
          >
            <Icon size={13} className="shrink-0 mt-px" />
            <span>{issue.message}</span>
          </div>
        );
      })}
    </div>
  );
}

interface FlowIssuesListProps {
  issues: FlowIssue[];
  nodes: Node[];
  onSelect: (nodeId: string) => void;
}

export function FlowIssuesList({ issues, nodes, onSelect }: FlowIssuesListProps) {
  if (issues.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted flex flex-col items-center gap-2">
        <CheckCircle2 size={20} className="text-success" />
        No se encontraron problemas en el flujo.
      </div>
    );
  }
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return (
    <div className="divide-y divide-border">
      {sorted.map((issue, idx) => {
        const node = nodes.find(n => n.id === issue.nodeId);
        const isError = issue.level === 'error';
        const Icon = isError ? AlertCircle : AlertTriangle;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(issue.nodeId)}
            className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-bg transition-colors"
          >
            <Icon size={13} className={cn('shrink-0 mt-0.5', isError ? 'text-danger' : 'text-amber-500')} />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-fg truncate">{String(node?.data?.label || issue.nodeId)}</span>
              <span className="block text-[11px] text-muted leading-snug">{issue.message}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface PreRunDialogProps {
  issues: FlowIssue[];
  nodes: Node[];
  onReview: (nodeId?: string) => void;
  onRunAnyway: () => void;
}

/** Shown when the user runs a flow that has configuration errors */
export function PreRunIssuesDialog({ issues, nodes, onReview, onRunAnyway }: PreRunDialogProps) {
  const errors = issues.filter(i => i.level === 'error');
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-[9999]">
      <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-md overflow-hidden">
        <div className="p-4 border-b border-border flex items-start gap-3">
          <div className="w-8 h-8 rounded bg-danger/10 text-danger flex items-center justify-center shrink-0">
            <AlertCircle size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-fg">
              El flujo tiene {errors.length} {errors.length === 1 ? 'error' : 'errores'} de configuración
            </h2>
            <p className="text-xs text-muted mt-0.5">Probablemente fallará al ejecutarse. Revisa los nodos marcados en rojo.</p>
          </div>
          <button type="button" onClick={() => onReview()} className="p-1 text-muted hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <FlowIssuesList issues={errors} nodes={nodes} onSelect={id => onReview(id)} />
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-bg/40">
          <button
            type="button"
            onClick={onRunAnyway}
            className="h-8 px-3 text-xs rounded-sm border border-border text-muted hover:text-fg hover:border-border-hover"
          >
            Ejecutar de todos modos
          </button>
          <button
            type="button"
            onClick={() => onReview(errors[0]?.nodeId)}
            className="h-8 px-3 text-xs rounded-sm bg-accent text-accent-on font-medium hover:bg-accent-hover"
          >
            Revisar
          </button>
        </div>
      </div>
    </div>
  );
}
