import React, { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { ArrowRight, Plus, Trash2, Bug, ListPlus } from 'lucide-react';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import { cn } from '../../../../lib/utils';
import { useAppSelector } from '../../../../store/hooks';
import { VariableField } from '../editors/VariableField';
import { findParentForEachNode, getForEachItems, getUpstreamNodes } from '../utils';

interface JsonTransformInspectorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
  debugPreview?: any;
}

interface FieldMapping {
  from: string;
  to: string;
}

const JS_TEMPLATES: Array<{ label: string; code: string }> = [
  { label: 'Mapear', code: 'return data.map(row => ({\n  id: row.id,\n  nombre: row.nombre\n}));' },
  { label: 'Filtrar', code: 'return data.filter(row => row.estado === "activo");' },
  { label: 'Agrupar y sumar', code: 'const totales = {};\nfor (const row of data) {\n  totales[row.categoria] = (totales[row.categoria] || 0) + Number(row.total || 0);\n}\nreturn Object.entries(totales).map(([categoria, total]) => ({ categoria, total }));' },
  { label: 'Resumen', code: 'return {\n  registros: data.length,\n  procesadoEn: new Date().toISOString()\n};' },
];

function getMappings(data: Record<string, any>): FieldMapping[] {
  if (Array.isArray(data.mappings)) return data.mappings.map((m: any) => ({ from: String(m?.from ?? ''), to: String(m?.to ?? '') }));
  return String(data.pickFields ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(f => ({ from: f, to: f }));
}

function firstRow(value: any): any {
  if (Array.isArray(value)) return value[0];
  if (value && typeof value === 'object') {
    for (const key of ['rows', 'data', 'items']) {
      if (Array.isArray(value[key])) return value[key][0];
    }
  }
  return value;
}

export function JsonTransformInspector({ node, nodes, edges, updateNodeData, nodeResult, debugPreview }: JsonTransformInspectorProps) {
  const data = (node.data || {}) as Record<string, any>;
  const mode = data.transformType === 'map' || data.transformType === 'pick' ? 'map' : 'javascript';
  const mappings = getMappings(data);
  const nodeResults = useAppSelector(state => state.flows.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);

  // Fields of the incoming rows, used to suggest mapping sources
  const detectedFields = useMemo(() => {
    const explicit = String(data.inputData || '').match(/^\s*\{\{\s*([^}.\s]+)/);
    let sample: any;
    if (explicit) {
      sample = firstRow(nodeResults[explicit[1]] ?? intermediateContext?.[explicit[1]]);
    } else {
      const upstream = getUpstreamNodes(node, edges, nodes)[0];
      if (upstream?.type === 'forEach') {
        sample = getForEachItems(upstream, nodes, edges, nodeResults, intermediateContext)[0];
      } else if (upstream) {
        sample = firstRow(nodeResults[upstream.id] ?? intermediateContext?.[upstream.id]);
      } else {
        const loop = findParentForEachNode(node, edges, nodes);
        if (loop) sample = getForEachItems(loop, nodes, edges, nodeResults, intermediateContext)[0];
      }
    }
    return sample && typeof sample === 'object' && !Array.isArray(sample) ? Object.keys(sample) : [];
  }, [data.inputData, node, nodes, edges, nodeResults, intermediateContext]);

  const setMappings = (next: FieldMapping[]) => updateNodeData('mappings', next);
  const updateMapping = (idx: number, patch: Partial<FieldMapping>) =>
    setMappings(mappings.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const addDetectedFields = () => {
    const existing = new Set(mappings.map(m => m.from));
    setMappings([...mappings, ...detectedFields.filter(f => !existing.has(f)).map(f => ({ from: f, to: f }))]);
  };

  const inputPreview = debugPreview?.kind === 'transform' ? debugPreview.input : null;
  const datalistId = `fields-${node.id}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 p-0.5 bg-bg rounded border border-border">
        {([
          ['map', 'Mapear campos'],
          ['javascript', 'JavaScript'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => updateNodeData('transformType', value)}
            className={cn(
              'text-xs py-1.5 px-2 rounded font-medium transition-colors',
              mode === value ? 'bg-surface text-accent shadow-sm border border-accent/30' : 'text-muted hover:text-fg'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Datos de entrada</span>
          <span className="text-[10px] text-muted font-normal">Vacío = nodo anterior conectado</span>
        </label>
        <VariableField
          node={node}
          nodes={nodes}
          edges={edges}
          value={String(data.inputData ?? '')}
          onChange={v => updateNodeData('inputData', v)}
          placeholder="{{nodo_anterior}}"
        />
      </div>

      {mode === 'map' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Campos de salida ({mappings.length})</label>
            {detectedFields.length > 0 && (
              <button
                type="button"
                onClick={addDetectedFields}
                className="text-[10px] text-accent hover:underline flex items-center gap-1"
                title={detectedFields.join(', ')}
              >
                <ListPlus size={11} /> Agregar los {detectedFields.length} campos detectados
              </button>
            )}
          </div>

          <datalist id={datalistId}>
            {detectedFields.map(f => <option key={f} value={f} />)}
          </datalist>

          {mappings.length > 0 && (
            <div className="grid grid-cols-[1fr_14px_1fr_22px] gap-1.5 text-[10px] text-muted px-0.5">
              <span>Campo de origen</span>
              <span />
              <span>Nombre en la salida</span>
              <span />
            </div>
          )}
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
            {mappings.map((m, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_14px_1fr_22px] gap-1.5 items-center">
                <input
                  list={datalistId}
                  value={m.from}
                  onChange={e => updateMapping(idx, { from: e.target.value })}
                  placeholder="cliente.nombre"
                  className="h-8 min-w-0 rounded-sm border border-border bg-surface px-2 text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                />
                <ArrowRight size={12} className="text-muted" />
                <input
                  value={m.to}
                  onChange={e => updateMapping(idx, { to: e.target.value })}
                  placeholder={m.from.includes('{{') ? 'nombre_campo' : m.from || 'nombre_campo'}
                  className="h-8 min-w-0 rounded-sm border border-border bg-surface px-2 text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                />
                <button
                  type="button"
                  onClick={() => setMappings(mappings.filter((_, i) => i !== idx))}
                  className="p-1 text-muted hover:text-danger justify-self-center"
                  title="Quitar campo"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setMappings([...mappings, { from: '', to: '' }])}
            className="w-full h-8 flex items-center justify-center gap-1.5 text-xs text-muted border border-dashed border-border rounded hover:text-accent hover:border-accent transition-colors"
          >
            <Plus size={13} /> Agregar campo
          </button>

          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(data.keepOthers)}
              onChange={e => updateNodeData('keepOthers', e.target.checked)}
              className="accent-accent"
            />
            <span>Conservar también el resto de campos (solo renombrar / agregar)</span>
          </label>

          <p className="text-[10px] text-muted leading-relaxed">
            El origen puede ser una ruta (<code>cliente.nombre</code>) o una plantilla que combine campos de la fila:
            <code> {'{{nombre}} {{apellido}}'}</code>. Se aplica a cada registro si la entrada es una lista.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {JS_TEMPLATES.map(t => (
              <button
                key={t.label}
                type="button"
                onClick={() => updateNodeData('expression', t.code)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-fg hover:border-muted"
              >
                {t.label}
              </button>
            ))}
          </div>

          <VariableField
            node={node}
            nodes={nodes}
            edges={edges}
            multiline
            rows={9}
            value={String(data.expression ?? '')}
            onChange={v => updateNodeData('expression', v)}
            placeholder={'// data = datos de entrada\nreturn data.map(row => ({ id: row.id, total: row.total }));'}
            className="bg-bg"
          />

          <ul className="text-[10px] text-muted space-y-0.5 list-disc pl-4">
            <li><code>data</code>: datos de entrada · <code>context</code>: resultados de todos los nodos · <code>item</code> / <code>index</code>: elemento del bucle</li>
            <li><code>{'{{nodo.campo}}'}</code> se reemplaza por su valor ya entre comillas (texto) o como número/objeto.</li>
            <li>Se ejecuta en el servidor, aislado y con un límite de 5 segundos.</li>
          </ul>
        </div>
      )}

      {inputPreview && (
        <div className="p-2.5 border border-amber-400/50 bg-amber-500/5 rounded text-xs space-y-1.5">
          <p className="font-medium text-fg flex items-center gap-1.5">
            <Bug size={12} className="text-amber-600" />
            Entrada que recibirá ({inputPreview.type === 'lista' ? `${inputPreview.count} registros` : inputPreview.type})
          </p>
          <div className="max-h-40 overflow-auto border border-border rounded p-1.5 bg-surface text-[11px]">
            <JsonTreeViewer data={inputPreview.sample} />
          </div>
        </div>
      )}

      {nodeResult !== undefined && !nodeResult?.skipped && !nodeResult?.error && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg flex items-center justify-between">
            <span>Resultado</span>
            {Array.isArray(nodeResult) && <span className="text-[10px] text-muted font-mono">{nodeResult.length} registros</span>}
          </label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={Array.isArray(nodeResult) ? nodeResult.slice(0, 20) : nodeResult} />
          </div>
        </div>
      )}
    </div>
  );
}
