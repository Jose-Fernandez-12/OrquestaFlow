import React, { useEffect, useMemo } from 'react';
import { Workflow, Plus, Trash2, RefreshCw, SlidersHorizontal, ArrowRightCircle } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { fetchFlows } from '../../../../store/flowSlice';
import { Button } from '../../../ui/button';
import { VariableField } from '../editors/VariableField';
import type { InspectorProps } from '../types';
import { getFlowParameters } from '../../flowParameters';

interface FlowParamMapping {
  key: string;
  value: string;
}

export function RunFlowInspector({ node, nodes, edges, updateNodeData }: InspectorProps) {
  const dispatch = useAppDispatch();
  const flows = useAppSelector(state => state.flows.flows);
  const currentFlowId = useAppSelector(state => state.flows.currentFlow?.id);

  useEffect(() => {
    if (flows.length === 0) {
      dispatch(fetchFlows());
    }
  }, [dispatch, flows.length]);

  const data = (node.data || {}) as Record<string, any>;
  const targetFlowId = String(data.targetFlowId || '');
  const outputNodeId = String(data.outputNodeId || '');

  const availableFlows = useMemo(
    () => flows.filter(f => f.id !== currentFlowId),
    [flows, currentFlowId]
  );

  const selectedFlow = useMemo(
    () => flows.find(f => f.id === targetFlowId),
    [flows, targetFlowId]
  );

  const targetParams = useMemo(
    () => (selectedFlow ? getFlowParameters(selectedFlow.definition) : []),
    [selectedFlow]
  );

  const targetNodes = useMemo(() => {
    if (!selectedFlow?.definition) return [];
    try {
      const parsed = JSON.parse(selectedFlow.definition);
      const list = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
      return list.filter((n: any) => n && n.type !== 'start' && n.type !== 'note');
    } catch {
      return [];
    }
  }, [selectedFlow]);

  const mappings: FlowParamMapping[] = useMemo(() => {
    if (Array.isArray(data.flowParams)) {
      return data.flowParams.map((item: any) => ({
        key: String(item?.key ?? ''),
        value: String(item?.value ?? ''),
      }));
    }
    if (data.flowParams && typeof data.flowParams === 'object') {
      return Object.entries(data.flowParams).map(([key, value]) => ({
        key,
        value: String(value ?? ''),
      }));
    }
    return [];
  }, [data.flowParams]);

  const setMappings = (next: FlowParamMapping[]) => {
    updateNodeData('flowParams', next);
  };

  const handleSelectFlow = (newId: string) => {
    const found = flows.find(f => f.id === newId);
    updateNodeData('targetFlowId', newId);
    updateNodeData('targetFlowName', found?.name || '');
    updateNodeData('outputNodeId', '');

    if (found) {
      const detected = getFlowParameters(found.definition);
      if (detected.length > 0) {
        const byKey = new Map(mappings.map(m => [m.key, m.value]));
        const synced = detected.map(p => ({
          key: p.key,
          value: byKey.has(p.key) ? (byKey.get(p.key) as string) : String(p.defaultValue ?? ''),
        }));
        setMappings(synced);
      }
    }
  };

  const handleSyncTargetParams = () => {
    if (!selectedFlow) return;
    const byKey = new Map(mappings.map(m => [m.key, m.value]));
    const next: FlowParamMapping[] = targetParams.map(p => ({
      key: p.key,
      value: byKey.has(p.key) ? (byKey.get(p.key) as string) : String(p.defaultValue ?? ''),
    }));
    for (const existing of mappings) {
      if (existing.key && !next.some(n => n.key === existing.key)) {
        next.push(existing);
      }
    }
    setMappings(next);
  };

  const updateMapping = (idx: number, patch: Partial<FlowParamMapping>) => {
    const next = [...mappings];
    next[idx] = { ...next[idx], ...patch };
    setMappings(next);
  };

  const addMapping = () => {
    setMappings([...mappings, { key: '', value: '' }]);
  };

  const removeMapping = (idx: number) => {
    setMappings(mappings.filter((_, i) => i !== idx));
  };

  const nodeLabel = String(data.label || 'Ejecutar flujo');

  return (
    <div className="space-y-4">
      {/* Flow Selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-fg flex items-center gap-1.5">
          <Workflow size={13} className="text-indigo-600" />
          <span>Flujo a ejecutar (subflujo)</span>
        </label>
        <select
          value={targetFlowId}
          onChange={e => handleSelectFlow(e.target.value)}
          className="w-full h-8 px-2.5 text-xs rounded-sm border border-border bg-bg text-fg focus-visible:outline-none focus-visible:border-indigo-500"
        >
          <option value="">— Selecciona un flujo —</option>
          {availableFlows.map(flow => (
            <option key={flow.id} value={flow.id}>
              {flow.name}
            </option>
          ))}
        </select>
        {availableFlows.length === 0 && (
          <p className="text-[11px] text-muted">
            No hay otros flujos creados todavía. Crea un flujo adicional para poder invocarlo como subflujo.
          </p>
        )}
      </div>

      {/* Output Node Selector */}
      {selectedFlow && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg flex items-center gap-1.5">
            <ArrowRightCircle size={13} className="text-indigo-600" />
            <span>Resultado principal (`data`)</span>
          </label>
          <select
            value={outputNodeId}
            onChange={e => updateNodeData('outputNodeId', e.target.value)}
            className="w-full h-8 px-2.5 text-xs rounded-sm border border-border bg-bg text-fg focus-visible:outline-none focus-visible:border-indigo-500"
          >
            <option value="">Automático (último nodo ejecutado)</option>
            {targetNodes.map((n: any) => (
              <option key={n.id} value={n.id}>
                {n.data?.label || n.id} ({n.type})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted">
            Disponible en nodos siguientes como{' '}
            <code className="font-mono text-indigo-600 bg-indigo-500/10 px-1 rounded">
              {`{{${nodeLabel}.data}}`}
            </code>{' '}
            o cualquier nodo interno vía{' '}
            <code className="font-mono text-indigo-600 bg-indigo-500/10 px-1 rounded">
              {`{{${nodeLabel}.outputs.NombreNodo}}`}
            </code>
            .
          </p>
        </div>
      )}

      {/* Parameters */}
      <div className="space-y-2 pt-1 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <SlidersHorizontal size={13} className="text-indigo-600" />
            <span>Parámetros de entrada</span>
          </div>
          {targetParams.length > 0 && (
            <button
              type="button"
              onClick={handleSyncTargetParams}
              className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
              title="Cargar las variables definidas en el flujo de destino"
            >
              <RefreshCw size={11} />
              <span>Sincronizar ({targetParams.length})</span>
            </button>
          )}
        </div>

        {mappings.length === 0 ? (
          <div className="p-3 rounded-sm border border-dashed border-border bg-bg/40 text-center space-y-2">
            <p className="text-[11px] text-muted">
              {targetParams.length > 0
                ? `El flujo "${selectedFlow?.name}" define ${targetParams.length} variable(s).`
                : 'Sin parámetros configurados. Puedes enviar variables o expresiones al subflujo.'}
            </p>
            <div className="flex items-center justify-center gap-2">
              {targetParams.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSyncTargetParams}
                  className="h-7 text-xs gap-1"
                >
                  <RefreshCw size={12} />
                  <span>Cargar variables del subflujo</span>
                </Button>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={addMapping}
                className="h-7 text-xs gap-1"
              >
                <Plus size={12} />
                <span>Añadir parámetro</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {mappings.map((mapping, idx) => {
              const targetMeta = targetParams.find(p => p.key === mapping.key);
              return (
                <div
                  key={idx}
                  className="p-2 rounded-sm border border-border bg-bg/40 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={mapping.key}
                      onChange={e => updateMapping(idx, { key: e.target.value })}
                      placeholder="nombreParametro"
                      className="flex-1 min-w-0 h-7 px-2 text-xs font-mono rounded-sm border border-border bg-surface text-fg focus-visible:outline-none focus-visible:border-indigo-500"
                    />
                    {targetMeta && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 uppercase shrink-0">
                        {targetMeta.type}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMapping(idx)}
                      className="h-7 w-7 rounded text-muted hover:text-danger hover:bg-danger/10 flex items-center justify-center shrink-0"
                      title="Eliminar parámetro"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <VariableField
                    node={node}
                    nodes={nodes}
                    edges={edges}
                    value={mapping.value}
                    onChange={(val: string) => updateMapping(idx, { value: val })}
                    placeholder={
                      targetMeta
                        ? `Por defecto: ${String(targetMeta.defaultValue ?? '')} (o usa {{variable}})`
                        : 'Valor fijo o {{expresión}}'
                    }
                  />
                  {targetMeta?.description && (
                    <p className="text-[10px] text-muted">{targetMeta.description}</p>
                  )}
                </div>
              );
            })}

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={addMapping}
              className="h-7 text-xs gap-1"
            >
              <Plus size={12} />
              <span>Añadir parámetro</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
