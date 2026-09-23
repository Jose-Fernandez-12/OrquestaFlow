import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { GitFork, Trash2, Plus } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { cn } from '../../../../lib/utils';

interface ConditionalBranchInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  upstreamNodes: Node[];
  nodeResult?: any;
}

export function ConditionalBranchInspector({
  node,
  updateNodeData,
  upstreamNodes,
  nodeResult,
}: ConditionalBranchInspectorProps) {
  const mode = (node.data?.mode as string) || 'if_else';
  const operator = (node.data?.operator as string) || 'equals';
  const leftOperand = (node.data?.leftOperand as string) || '';
  const rightOperand = (node.data?.rightOperand as string) || '';
  const switchField = (node.data?.switchField as string) || '';
  const cases: string[] = Array.isArray(node.data?.cases) ? (node.data.cases as string[]) : ['caso_1', 'caso_2'];
  const [newCaseInput, setNewCaseInput] = useState('');

  const addCase = () => {
    const trimmed = newCaseInput.trim();
    if (!trimmed || cases.includes(trimmed)) return;
    updateNodeData('cases', [...cases, trimmed]);
    setNewCaseInput('');
  };

  const removeCase = (index: number) => {
    const updated = cases.filter((_, idx) => idx !== index);
    updateNodeData('cases', updated);
  };

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Modo de bifurcación</label>
        <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-bg rounded border border-border">
          <button
            type="button"
            onClick={() => updateNodeData('mode', 'if_else')}
            className={cn(
              "text-xs py-1.5 px-2 rounded font-medium transition-colors text-center",
              mode === 'if_else'
                ? "bg-accent/15 text-accent border border-accent/40 font-semibold"
                : "text-muted hover:text-fg"
            )}
          >
            If / Else (Booleano)
          </button>
          <button
            type="button"
            onClick={() => updateNodeData('mode', 'switch')}
            className={cn(
              "text-xs py-1.5 px-2 rounded font-medium transition-colors text-center",
              mode === 'switch'
                ? "bg-accent/15 text-accent border border-accent/40 font-semibold"
                : "text-muted hover:text-fg"
            )}
          >
            Switch (Múltiples Casos)
          </button>
        </div>
      </div>

      {mode === 'if_else' ? (
        <div className="space-y-3">
          {/* Operando Izquierdo */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center justify-between">
              <span>Operando izquierdo (Valor o Variable)</span>
              {upstreamNodes.length > 0 && (
                <span className="text-[10px] text-muted">{upstreamNodes.length} anterior(es)</span>
              )}
            </label>
            {upstreamNodes.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {upstreamNodes.map(up => (
                  <button
                    key={up.id}
                    type="button"
                    onClick={() => updateNodeData('leftOperand', `{{${up.id}}}`)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-accent hover:border-accent transition-colors"
                  >
                    + {String(up.data?.label || up.id)}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={leftOperand}
              onChange={(e) => updateNodeData('leftOperand', e.target.value)}
              placeholder="{{nodo_anterior.status}} o valor"
              className="font-mono text-xs"
            />
          </div>

          {/* Operador */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Operador</label>
            <select
              value={operator}
              onChange={(e) => updateNodeData('operator', e.target.value)}
              className="flex w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
            >
              <option value="equals">Es igual a (==)</option>
              <option value="not_equals">No es igual a (!=)</option>
              <option value="greater_than">Mayor que (&gt;)</option>
              <option value="greater_equal">Mayor o igual que (&gt;=)</option>
              <option value="less_than">Menor que (&lt;)</option>
              <option value="less_equal">Menor o igual que (&lt;=)</option>
              <option value="contains">Contiene texto</option>
              <option value="is_empty">Está vacío / nulo</option>
              <option value="is_not_empty">Tiene valor (No vacío)</option>
            </select>
          </div>

          {/* Operando Derecho */}
          {operator !== 'is_empty' && operator !== 'is_not_empty' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Operando derecho (Valor esperado)</label>
              <Input
                value={rightOperand}
                onChange={(e) => updateNodeData('rightOperand', e.target.value)}
                placeholder="200, activo, ok..."
                className="font-mono text-xs"
              />
            </div>
          )}

          {/* Diagrama explicativo de puertos */}
          <div className="p-2.5 bg-bg border border-border rounded text-xs space-y-1.5">
            <p className="font-medium text-fg flex items-center gap-1.5">
              <GitFork size={13} className="text-amber-500" />
              <span>Conexiones de salida</span>
            </p>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-emerald-600">Verdadero (True):</span>
                <span className="text-muted">Conector superior lateral</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                <span className="font-semibold text-rose-600">Falso (False):</span>
                <span className="text-muted">Conector inferior lateral</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Switch Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center justify-between">
              <span>Campo o Variable a evaluar</span>
              {upstreamNodes.length > 0 && (
                <span className="text-[10px] text-muted">{upstreamNodes.length} anterior(es)</span>
              )}
            </label>
            {upstreamNodes.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {upstreamNodes.map(up => (
                  <button
                    key={up.id}
                    type="button"
                    onClick={() => updateNodeData('switchField', `{{${up.id}}}`)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-accent hover:border-accent transition-colors"
                  >
                    + {String(up.data?.label || up.id)}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={switchField}
              onChange={(e) => updateNodeData('switchField', e.target.value)}
              placeholder="{{nodo.tipo}}"
              className="font-mono text-xs"
            />
          </div>

          {/* Casos */}
          <div className="space-y-2">
            <label className="text-xs font-medium flex items-center justify-between">
              <span>Casos definidos ({cases.length})</span>
              <span className="text-[10px] text-muted">Genera un conector por caso</span>
            </label>

            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {cases.map((c, idx) => (
                <div key={idx} className="flex items-center justify-between p-1.5 bg-surface border border-border rounded text-xs">
                  <span className="font-mono font-medium text-fg">{c}</span>
                  <button
                    type="button"
                    onClick={() => removeCase(idx)}
                    className="text-muted hover:text-danger p-0.5"
                    title="Eliminar caso"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-1.5 mt-1">
              <Input
                value={newCaseInput}
                onChange={(e) => setNewCaseInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCase())}
                placeholder="Nuevo caso (ej: pendiente)..."
                className="font-mono text-xs"
              />
              <Button type="button" size="sm" onClick={addCase} className="shrink-0 text-xs">
                <Plus size={13} className="mr-1" /> Agregar
              </Button>
            </div>

            <p className="text-[10px] text-muted">
              Se incluye automáticamente un conector <code>default</code> para cuando ningún caso coincida.
            </p>
          </div>
        </div>
      )}

      {/* Node execution preview */}
      {nodeResult && (
        <div className="p-2.5 bg-bg border border-border rounded text-xs space-y-1">
          <p className="font-medium text-fg">Última evaluación:</p>
          <div className="flex items-center gap-2">
            <span className="text-muted">Rama tomada:</span>
            <span className="font-mono font-bold px-1.5 py-0.5 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded">
              {String(nodeResult.selectedBranch)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
