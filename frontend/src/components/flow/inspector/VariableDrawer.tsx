import React, { useState, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { ChevronDown, ChevronRight, Copy, Check, X, Braces, Repeat, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { getUpstreamNodes, isDataProducerNode, getForEachItems, findParentForEachNode } from './utils';
import { useAppSelector } from '../../../store/hooks';
import type { VariableGroup, VariableItem } from './types';

interface VariableDrawerProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  isOpen?: boolean;
  onClose: () => void;
}

export function VariableDrawer({ node, nodes, edges, isOpen = true, onClose }: VariableDrawerProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['loop', 'upstream-0']));

  const nodeResults = useAppSelector(state => (state as any).flows?.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);

  const parentForEachNode = useMemo(() => findParentForEachNode(node, edges, nodes), [node, edges, nodes]);

  const parentLoopItems = useMemo(() => {
    if (!parentForEachNode) return [];
    return getForEachItems(parentForEachNode, nodes, edges, nodeResults, intermediateContext);
  }, [parentForEachNode, nodes, edges, nodeResults, intermediateContext]);

  const parentLoopKeys = useMemo(() => {
    if (!parentLoopItems || parentLoopItems.length === 0) return [];
    const first = parentLoopItems[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return Object.keys(first);
    }
    return [];
  }, [parentLoopItems]);

  const upstreamNodes = useMemo(() => getUpstreamNodes(node, edges, nodes), [node, edges, nodes]);

  const groups: VariableGroup[] = useMemo(() => {
    const result: VariableGroup[] = [];

    // Loop variables (if inside forEach)
    if (parentForEachNode) {
      const loopVars: VariableItem[] = [];
      if (parentLoopKeys.length > 0) {
        parentLoopKeys.forEach(k => {
          loopVars.push({
            label: k,
            expression: `{{_item.${k}}}`,
            type: 'campo',
          });
        });
      }
      loopVars.push({ label: 'Elemento completo', expression: '{{_item}}', type: 'objeto' });
      loopVars.push({ label: 'Indice actual', expression: '{{_index}}', type: 'numero' });
      loopVars.push({ label: 'Total elementos', expression: '{{_total}}', type: 'numero' });

      result.push({
        id: 'loop',
        label: `Bucle: ${String(parentForEachNode.data?.label || parentForEachNode.id)}`,
        color: 'text-sky-600',
        variables: loopVars,
      });
    }

    // Upstream node variables
    upstreamNodes.forEach((upNode, idx) => {
      const upResult = nodeResults[upNode.id] || intermediateContext?.[upNode.id];
      const vars: VariableItem[] = [];

      // Try to detect keys from the result
      if (upResult) {
        let sample = upResult;
        if (Array.isArray(sample) && sample.length > 0) sample = sample[0];
        if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
          Object.keys(sample).forEach(k => {
            vars.push({
              label: k,
              expression: `{{${upNode.id}.${k}}}`,
              type: typeof sample[k] === 'number' ? 'numero' : typeof sample[k],
            });
          });
        }
      }

      // Always add a reference to the full node result
      vars.push({
        label: 'Resultado completo',
        expression: `{{${upNode.id}}}`,
        type: 'referencia',
      });

      result.push({
        id: `upstream-${idx}`,
        label: String(upNode.data?.label || upNode.type || upNode.id),
        color: isDataProducerNode(upNode.type) ? 'text-accent' : 'text-muted',
        variables: vars,
      });
    });

    return result;
  }, [parentForEachNode, parentLoopKeys, upstreamNodes, nodeResults, intermediateContext]);

  const totalVariables = useMemo(() => {
    return groups.reduce((acc, g) => acc + g.variables.length, 0);
  }, [groups]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groups;
    const lower = searchTerm.toLowerCase().trim();
    return groups
      .map(g => ({
        ...g,
        variables: g.variables.filter(
          v => v.label.toLowerCase().includes(lower) || v.expression.toLowerCase().includes(lower)
        ),
      }))
      .filter(g => g.variables.length > 0);
  }, [groups, searchTerm]);

  const copyVariable = (expression: string) => {
    navigator.clipboard.writeText(expression);
    setCopiedKey(expression);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="border-b border-border bg-bg/60 p-3 space-y-2.5 animate-fade-in text-xs select-text">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-fg">
          <Braces size={13} className="text-accent" />
          <span>Variables disponibles</span>
          {totalVariables > 0 && (
            <span className="text-[10px] text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-border">
              {totalVariables}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-muted hover:text-fg hover:bg-surface transition-colors"
          title="Cerrar panel de variables"
        >
          <X size={14} />
        </button>
      </div>

      {/* Quick search input */}
      {totalVariables > 4 && (
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar variable por nombre o expresión..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full h-7 pl-7 pr-7 bg-surface border border-border rounded text-[11px] placeholder:text-muted focus:outline-none focus:border-accent"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg p-0.5"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Helper text */}
      <p className="text-[10px] text-muted leading-tight">
        Haz clic en una variable para copiar su expresión <code>{'{{...}}'}</code> al portapapeles.
      </p>

      {/* Groups list */}
      <div className="max-h-[260px] overflow-y-auto pr-0.5 space-y-1.5">
        {groups.length === 0 && (
          <div className="text-[11px] text-muted text-center py-4 bg-surface border border-border border-dashed rounded">
            No hay variables de nodos previos. Conecta un nodo anterior productor de datos.
          </div>
        )}

        {groups.length > 0 && filteredGroups.length === 0 && (
          <div className="text-[11px] text-muted text-center py-4 bg-surface border border-border border-dashed rounded">
            No se encontraron variables para "{searchTerm}".
          </div>
        )}

        {filteredGroups.map(group => {
          const isExpanded = expandedGroups.has(group.id) || Boolean(searchTerm);
          const isLoop = group.id === 'loop';

          return (
            <div
              key={group.id}
              className={cn(
                'border rounded overflow-hidden bg-surface',
                isLoop ? 'border-sky-500/30' : 'border-border'
              )}
            >
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-bg/60 transition-colors',
                  group.color || 'text-fg'
                )}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {isLoop && <Repeat size={12} />}
                <span className="truncate flex-1 text-left">{group.label}</span>
                <span className="text-[9px] font-mono text-muted bg-bg px-1.5 py-0.5 rounded border border-border">
                  {group.variables.length}
                </span>
              </button>

              {/* Variables */}
              {isExpanded && (
                <div className="px-1.5 pb-1.5 space-y-1 border-t border-border/50 pt-1">
                  {group.variables.map(v => {
                    const isCopied = copiedKey === v.expression;
                    return (
                      <button
                        key={v.expression}
                        type="button"
                        onClick={() => copyVariable(v.expression)}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left transition-colors group',
                          isCopied
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600'
                            : 'hover:bg-bg border border-transparent hover:border-border'
                        )}
                        title={`Clic para copiar ${v.expression}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-[11px] font-mono font-medium text-fg truncate">
                            {v.label}
                          </span>
                          <span className="text-[9px] text-muted font-mono truncate hidden sm:inline opacity-60">
                            {v.expression}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {v.type && (
                            <span className="text-[8px] text-muted font-mono bg-bg px-1 py-0.5 rounded border border-border">
                              {v.type}
                            </span>
                          )}
                          <div className="w-4 h-4 flex items-center justify-center">
                            {isCopied ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={11} className="text-muted opacity-40 group-hover:opacity-100 group-hover:text-accent transition-opacity" />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VariablePanel = VariableDrawer;
