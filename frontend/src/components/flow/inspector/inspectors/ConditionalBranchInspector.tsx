import React from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Plus, Trash2, CheckCircle2, XCircle, Bug, Info } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { VariableField } from '../editors/VariableField';
import {
  CONDITION_OPERATORS,
  getConditionRules,
  getOperator,
  normalizeSwitchCases,
  type ConditionRule,
  type SwitchCase,
} from '../../nodeDefinitions';

interface ConditionalBranchInspectorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
  debugPreview?: any;
}

const nextId = (items: Array<{ id: string }>) =>
  String(items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1);

function formatValue(value: any): string {
  if (value === undefined) return '(sin resolver)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? '"" (vacío)' : `"${value}"`;
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function ConditionalBranchInspector({ node, nodes, edges, updateNodeData, nodeResult, debugPreview }: ConditionalBranchInspectorProps) {
  const data = (node.data || {}) as Record<string, any>;
  const mode = data.mode === 'switch' ? 'switch' : 'if_else';
  const combinator = data.combinator === 'or' ? 'or' : 'and';
  const rules = getConditionRules(data);
  const cases = normalizeSwitchCases(data.cases);

  const setRules = (next: ConditionRule[]) => updateNodeData('conditions', next);
  const updateRule = (id: string, patch: Partial<ConditionRule>) =>
    setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const setCases = (next: SwitchCase[]) => updateNodeData('cases', next);
  const updateCase = (id: string, patch: Partial<SwitchCase>) =>
    setCases(cases.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const setMode = (next: 'if_else' | 'switch') => {
    updateNodeData('mode', next);
    if (next === 'switch' && cases.length === 0) setCases([{ id: '1', value: '' }]);
  };

  const lastResult = debugPreview?.kind === 'condition' ? debugPreview : nodeResult?.selectedHandle ? nodeResult : null;
  const evaluation = lastResult?.mode === mode ? lastResult : null;
  const isDebugPreview = debugPreview?.kind === 'condition';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 p-0.5 bg-bg rounded border border-border">
        {([
          ['if_else', 'Condiciones (Sí / No)'],
          ['switch', 'Switch por valor'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              'text-xs py-1.5 px-2 rounded font-medium transition-colors',
              mode === value ? 'bg-surface text-accent shadow-sm border border-accent/30' : 'text-muted hover:text-fg'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'if_else' ? (
        <div className="space-y-3">
          {rules.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Tomar la rama <b className="text-emerald-600">Sí</b> cuando se cumpla</span>
              <select
                value={combinator}
                onChange={e => updateNodeData('combinator', e.target.value)}
                className="h-7 rounded-sm border border-border bg-surface px-1.5 text-xs font-medium focus-visible:outline-none focus-visible:border-accent"
              >
                <option value="and">todas (Y)</option>
                <option value="or">alguna (O)</option>
              </select>
            </div>
          )}

          {rules.map((rule, idx) => {
            const op = getOperator(rule.operator);
            return (
              <React.Fragment key={rule.id}>
                {idx > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-bold text-amber-600">{combinator === 'or' ? 'O' : 'Y'}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="p-2.5 bg-bg/60 border border-border rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-fg">Condición {idx + 1}</span>
                    {rules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
                        className="p-1 text-muted hover:text-danger"
                        title="Eliminar condición"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted">Valor a evaluar</label>
                    <VariableField
                      node={node}
                      nodes={nodes}
                      edges={edges}
                      value={rule.left}
                      onChange={v => updateRule(rule.id, { left: v })}
                      placeholder="{{nodo.campo}}"
                    />
                  </div>

                  <select
                    value={op.value}
                    onChange={e => updateRule(rule.id, { operator: e.target.value })}
                    className="flex w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
                  >
                    {CONDITION_OPERATORS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.symbol}  {o.label}
                      </option>
                    ))}
                  </select>

                  {!op.unary && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted">
                        {op.value === 'in_list' ? 'Valores permitidos (separados por coma)' : op.value === 'regex' ? 'Expresión regular' : 'Comparar con'}
                      </label>
                      <VariableField
                        node={node}
                        nodes={nodes}
                        edges={edges}
                        value={rule.right}
                        onChange={v => updateRule(rule.id, { right: v })}
                        placeholder={op.value === 'in_list' ? 'activo, pendiente' : op.value === 'regex' ? '^ABC-\\d+$' : '100, activo, {{otro_nodo.campo}}'}
                      />
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}

          <button
            type="button"
            onClick={() => setRules([...rules, { id: nextId(rules), left: '', operator: 'equals', right: '' }])}
            className="w-full h-8 flex items-center justify-center gap-1.5 text-xs text-muted border border-dashed border-border rounded hover:text-accent hover:border-accent transition-colors"
          >
            <Plus size={13} /> Agregar condición
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Valor a evaluar</label>
            <VariableField
              node={node}
              nodes={nodes}
              edges={edges}
              value={String(data.switchField ?? data.switchValue ?? '')}
              onChange={v => updateNodeData('switchField', v)}
              placeholder="{{nodo.estado}}"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Casos ({cases.length})</label>
              <span className="text-[10px] text-muted">Cada caso es una salida del nodo</span>
            </div>
            <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-[10px] text-muted px-0.5">
              <span>Si el valor es…</span>
              <span>Etiqueta (opcional)</span>
              <span />
            </div>
            {cases.map(c => (
              <div key={c.id} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center">
                <input
                  value={c.value}
                  onChange={e => updateCase(c.id, { value: e.target.value })}
                  placeholder="pendiente"
                  className="h-8 rounded-sm border border-border bg-surface px-2 text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                />
                <input
                  value={c.label || ''}
                  onChange={e => updateCase(c.id, { label: e.target.value })}
                  placeholder={c.value || `Caso ${c.id}`}
                  className="h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
                />
                <button
                  type="button"
                  onClick={() => setCases(cases.filter(x => x.id !== c.id))}
                  className="p-1 text-muted hover:text-danger justify-self-center"
                  title="Eliminar caso (sus conexiones quedarán sin salida)"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setCases([...cases, { id: nextId(cases), value: '' }])}
              className="w-full h-8 flex items-center justify-center gap-1.5 text-xs text-muted border border-dashed border-border rounded hover:text-accent hover:border-accent transition-colors"
            >
              <Plus size={13} /> Agregar caso
            </button>
            <p className="text-[10px] text-muted">
              Si ningún caso coincide se toma la salida <b>Por defecto</b>.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 p-2.5 bg-bg border border-border rounded text-[11px] text-muted leading-relaxed">
        <Info size={13} className="shrink-0 mt-0.5 text-accent" />
        <div>
          Números y fechas (<code>AAAA-MM-DD</code>) se comparan por valor; los textos sin distinguir mayúsculas. Los valores fijos
          pueden ir con o sin comillas. Si el campo viene de una lista de registros se usa la <b>primera fila</b>; dentro de un
          bucle usa <code>{'{{_item.campo}}'}</code>. Los datos pasan sin cambios a la rama elegida.
        </div>
      </div>

      {debugPreview?.kind === 'error' && (
        <div className="p-2.5 border border-red-500/30 bg-red-500/10 rounded text-xs text-red-600">
          No se pudo evaluar: {debugPreview.error}
        </div>
      )}

      {evaluation && (
        <div className={cn('p-2.5 border rounded text-xs space-y-2', isDebugPreview ? 'border-amber-400/50 bg-amber-500/5' : 'border-border bg-bg')}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-fg flex items-center gap-1.5">
              {isDebugPreview && <Bug size={12} className="text-amber-600" />}
              {isDebugPreview ? 'Vista previa (antes de ejecutar)' : 'Última evaluación'}
            </span>
            <span
              className={cn(
                'font-semibold px-1.5 py-0.5 rounded text-[11px]',
                evaluation.selectedHandle === 'true'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : evaluation.selectedHandle === 'false'
                    ? 'bg-rose-500/10 text-rose-600'
                    : 'bg-amber-500/10 text-amber-600'
              )}
            >
              Rama: {String(evaluation.branchLabel ?? evaluation.selectedHandle)}
            </span>
          </div>

          {Array.isArray(evaluation.evaluations) &&
            evaluation.evaluations.map((ev: any, idx: number) => {
              const op = getOperator(ev.operator);
              return (
                <div key={idx} className="flex items-start gap-1.5 font-mono text-[10px]">
                  {ev.passed ? (
                    <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-px" />
                  ) : (
                    <XCircle size={12} className="text-rose-500 shrink-0 mt-px" />
                  )}
                  <span className="break-all">
                    <span className="text-fg">{formatValue(ev.leftValue)}</span>
                    <span className="text-muted"> {op.symbol} </span>
                    {!op.unary && <span className="text-fg">{formatValue(ev.rightValue)}</span>}
                  </span>
                </div>
              );
            })}

          {evaluation.mode === 'switch' && (
            <div className="font-mono text-[10px] text-fg break-all">
              Valor evaluado: {formatValue(evaluation.switchValue)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
