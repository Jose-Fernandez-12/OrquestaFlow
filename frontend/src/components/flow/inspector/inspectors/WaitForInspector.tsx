import React from 'react';
import { Hourglass } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { TYPE_LABELS } from '../types';
import type { InspectorProps } from '../types';
import { getWaitCandidates, getWaitIssue } from '../../waitForUtils';

type WaitForInspectorProps = Pick<InspectorProps, 'node' | 'nodes' | 'edges' | 'updateNodeData'>;

export function WaitForInspector({ node, nodes, edges, updateNodeData }: WaitForInspectorProps) {
  const selected: string[] = Array.isArray(node.data?.waitForNodeIds) ? (node.data.waitForNodeIds as string[]) : [];
  const candidates = getWaitCandidates(node.id, nodes);
  const knownIds = new Set(nodes.map(n => n.id));
  const missing = selected.filter(id => !knownIds.has(id));

  const toggle = (id: string) => {
    updateNodeData('waitForNodeIds', selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Esperar a que terminen</label>
        <p className="text-[10px] text-muted leading-relaxed">
          Las ramas que salgan de este nodo no continúan hasta que todos los nodos marcados hayan terminado.
          No hace falta conectarlos: los nodos marcados siguen su propio camino.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="p-3 bg-bg rounded-sm border border-border text-xs text-muted">
          No hay otros nodos en el flujo para esperar.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
          {candidates.map(candidate => {
            const checked = selected.includes(candidate.id);
            const issue = checked ? getWaitIssue(node.id, candidate.id, nodes, edges) : null;
            return (
              <label
                key={candidate.id}
                className={cn(
                  'flex items-start gap-2.5 p-2.5 rounded-sm border cursor-pointer transition-colors',
                  checked ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg hover:border-accent/30'
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent,#2563eb)]"
                  checked={checked}
                  onChange={() => toggle(candidate.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{String(candidate.data?.label || candidate.id)}</span>
                  <span className="block text-[10px] text-muted truncate">{TYPE_LABELS[candidate.type || ''] || candidate.type}</span>
                  {issue && <span className="block text-[10px] text-amber-700 mt-1 leading-snug">{issue}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div className="p-3 rounded-sm border border-amber-400/50 bg-amber-500/5 text-amber-700 text-xs leading-relaxed">
          {missing.length === 1 ? 'Un nodo que se esperaba ya no existe' : `${missing.length} nodos que se esperaban ya no existen`}
          {' '}y se ignorará.{' '}
          <button
            type="button"
            className="underline font-medium"
            onClick={() => updateNodeData('waitForNodeIds', selected.filter(id => knownIds.has(id)))}
          >
            Quitarlos
          </button>
        </div>
      )}

      <div className="p-3 bg-bg rounded-sm border border-border flex items-center gap-2 text-xs">
        <Hourglass size={16} className="text-orange-500 shrink-0" />
        <span>
          {selected.length === 0
            ? 'Sin nodos seleccionados: este nodo deja pasar los datos sin esperar.'
            : <>Espera a <strong className="text-fg">{selected.length}</strong> nodo{selected.length === 1 ? '' : 's'} y deja pasar los datos de su entrada.</>}
        </span>
      </div>
    </div>
  );
}
