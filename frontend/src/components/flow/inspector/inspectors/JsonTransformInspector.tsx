import React, { useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { ArrowRight, Plus, Trash2, Bug, ListPlus, Terminal, Pencil, Code2, FileCode2, AlertTriangle } from 'lucide-react';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import { cn } from '../../../../lib/utils';
import { useAppSelector } from '../../../../store/hooks';
import { VariableField } from '../editors/VariableField';
import { findParentForEachNode, getForEachItems, getUpstreamNodes } from '../utils';
import { JsonTransformModal } from './JsonTransformModal';

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

const LOG_LEVEL_STYLES: Record<string, { color: string; badge: string; badgeBg: string }> = {
  log:   { color: 'text-emerald-400', badge: 'LOG',   badgeBg: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
  info:  { color: 'text-sky-400',     badge: 'INFO',  badgeBg: 'bg-sky-500/20 text-sky-400 border border-sky-500/30' },
  warn:  { color: 'text-amber-400',   badge: 'WARN',  badgeBg: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  error: { color: 'text-rose-400',    badge: 'ERROR', badgeBg: 'bg-rose-500/20 text-rose-400 border border-rose-500/30' },
};

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
  const mappings = getMappings(data);
  const mode = (data.transformType === 'map' || data.transformType === 'pick') && mappings.length > 0 ? 'map' : 'javascript';
  const nodeResults = useAppSelector(state => state.flows.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);

  const [showCodeModal, setShowCodeModal] = useState(false);
  const [customInputOpen, setCustomInputOpen] = useState(false);
  const showCustomInput = customInputOpen || Boolean(String(data.inputData ?? '').trim());

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

  // Where the data comes from when "Datos de entrada" is left empty
  const defaultInput = useMemo(() => {
    const upstream = getUpstreamNodes(node, edges, nodes)[0];
    if (upstream) {
      return { label: String(upstream.data?.label || upstream.id), isLoop: upstream.type === 'forEach' };
    }
    const loop = findParentForEachNode(node, edges, nodes);
    if (loop) return { label: String(loop.data?.label || loop.id), isLoop: true };
    return null;
  }, [node, edges, nodes]);

  const code = String(data.expression ?? '');
  const hasCode = code.trim().length > 0;
  const codeLines = code.replace(/\s+$/, '').split('\n');
  const usesConsole = /console\.(log|info|warn|error)\s*\(/.test(code);

  const inputPreview = debugPreview?.kind === 'transform' ? debugPreview.input : null;
  const datalistId = `fields-${node.id}`;

  // Check for logs in node result
  const hasLogs = nodeResult && typeof nodeResult === 'object' && Array.isArray(nodeResult._logs) && nodeResult._logs.length > 0;
  const logs: Array<{ level: string; args: string[]; ts: number }> = hasLogs ? nodeResult._logs : [];
  const cleanResult = hasLogs
    ? (nodeResult._data !== undefined ? nodeResult._data : Object.fromEntries(Object.entries(nodeResult).filter(([k]) => k !== '_logs')))
    : nodeResult;

  return (
    <div className="space-y-4">
      {/* Legacy field-mapping nodes: offer the move to JavaScript */}
      {mode === 'map' && (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-bg text-[11px] text-muted">
          <span>Este nodo usa el modo antiguo de mapeo de campos.</span>
          <button
            type="button"
            onClick={() => updateNodeData('transformType', 'javascript')}
            className="text-accent font-medium hover:underline shrink-0"
          >
            Usar JavaScript
          </button>
        </div>
      )}

      {/* Input data source: automatic by default, custom expression only on demand */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium">Datos de entrada</label>
          {!showCustomInput && defaultInput && (
            <button type="button" onClick={() => setCustomInputOpen(true)} className="text-[10px] text-muted hover:text-accent">
              Usar otra fuente
            </button>
          )}
        </div>

        {!showCustomInput ? (
          defaultInput ? (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-sm border border-border bg-bg/60 text-[11px]">
              <ArrowRight size={12} className="text-accent shrink-0" />
              <span className="text-muted">Recibe automáticamente la salida de</span>
              <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium truncate">{defaultInput.label}</span>
              {defaultInput.isLoop && <span className="text-muted shrink-0">(elemento del bucle)</span>}
            </div>
          ) : (
            <div className="px-2.5 py-2 rounded-sm border border-amber-400/50 bg-amber-500/5 text-[11px] text-fg">
              Conecta un nodo anterior para que este nodo reciba sus datos.{' '}
              <button type="button" onClick={() => setCustomInputOpen(true)} className="text-accent hover:underline">
                O indica una expresión
              </button>
            </div>
          )
        ) : (
          <>
            <VariableField
              node={node}
              nodes={nodes}
              edges={edges}
              value={String(data.inputData ?? '')}
              onChange={v => updateNodeData('inputData', v)}
              placeholder="{{nodo.campo}}"
            />
            <p className="text-[10px] text-muted">
              Expresión personalizada en lugar del nodo anterior.{' '}
              <button
                type="button"
                onClick={() => { updateNodeData('inputData', ''); setCustomInputOpen(false); }}
                className="text-accent hover:underline"
              >
                Volver a automático
              </button>
            </p>
          </>
        )}
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
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Código JavaScript</label>

          {hasCode ? (
            <div className="border border-border rounded-sm bg-surface overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-bg/60">
                <span className="flex items-center gap-1.5 text-[11px] text-fg font-medium">
                  <FileCode2 size={13} className="text-teal-600" />
                  {codeLines.length} {codeLines.length === 1 ? 'línea' : 'líneas'}
                  {usesConsole && <span className="text-[10px] text-muted font-normal">· con console.log</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setShowCodeModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover font-medium px-2 py-1 rounded bg-accent/5 hover:bg-accent/10 border border-accent/20 transition-colors"
                >
                  <Pencil size={11} />
                  Editar código
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowCodeModal(true)}
                className="w-full text-left px-3 py-2 font-mono text-[11px] text-muted leading-relaxed hover:bg-bg/60 transition-colors"
                title="Abrir el editor de código"
              >
                {codeLines.slice(0, 3).map((l, i) => (
                  <div key={i} className="truncate whitespace-pre">{l || ' '}</div>
                ))}
                {codeLines.length > 3 && <div className="text-[10px] text-muted-light">… {codeLines.length - 3} líneas más</div>}
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-sm border border-amber-400/50 bg-amber-500/5 space-y-2">
              <p className="text-[11px] text-fg flex items-start gap-1.5">
                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-px" />
                <span>
                  <span className="font-medium">No hay código JavaScript.</span> El nodo pasará los datos de entrada sin cambios.
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowCodeModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] text-accent-on font-medium px-2.5 py-1 rounded bg-accent hover:bg-accent-hover transition-colors"
                >
                  <Code2 size={12} />
                  Escribir código
                </button>
                {JS_TEMPLATES.map(t => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => updateNodeData('expression', t.code)}
                    className="text-[10px] px-2 py-1 rounded bg-surface border border-border text-muted hover:text-fg hover:border-muted transition-colors"
                    title={t.code}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted leading-relaxed">
            <code>data</code> = datos de entrada · <code>context</code> = resultados de nodos · límite de 5s.
          </p>
        </div>
      )}

      {/* Debug Preview */}
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

      {/* Console output from console.log calls */}
      {hasLogs && (
        <div className="bg-gray-950 rounded-md border border-gray-800 overflow-hidden shadow-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900/80">
            <Terminal size={12} className="text-emerald-400" />
            <span className="text-[11px] font-mono text-gray-300 font-medium">Consola de depuración</span>
            <span className="text-[10px] text-gray-500 ml-auto font-mono">{logs.length} {logs.length === 1 ? 'mensaje' : 'mensajes'}</span>
          </div>
          <div className="max-h-48 overflow-auto p-1 font-mono text-xs">
            {logs.map((log, i) => {
              const style = LOG_LEVEL_STYLES[log.level] || LOG_LEVEL_STYLES.log;
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-1 text-xs border-b border-gray-800/40 last:border-0 hover:bg-gray-900/50 transition-colors"
                >
                  <span className={cn('text-[9px] px-1.5 py-0.2 rounded font-semibold shrink-0 mt-0.5', style.badgeBg)}>
                    {style.badge}
                  </span>
                  <span className={cn('flex-1 break-all whitespace-pre-wrap leading-relaxed', style.color)}>
                    {log.args.join(' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Node execution result */}
      {cleanResult !== undefined && !cleanResult?.skipped && !cleanResult?.error && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg flex items-center justify-between">
            <span>Resultado</span>
            {Array.isArray(cleanResult) && <span className="text-[10px] text-muted font-mono">{cleanResult.length} registros</span>}
          </label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={Array.isArray(cleanResult) ? cleanResult.slice(0, 20) : cleanResult} />
          </div>
        </div>
      )}

      {/* Expanded CodeMirror Editor Modal */}
      <JsonTransformModal
        isOpen={showCodeModal}
        onClose={() => setShowCodeModal(false)}
        code={String(data.expression ?? '')}
        onChange={newCode => {
          updateNodeData('expression', newCode);
          updateNodeData('transformType', 'javascript');
        }}
        node={node}
        nodes={nodes}
        edges={edges}
        templates={JS_TEMPLATES}
      />
    </div>
  );
}
