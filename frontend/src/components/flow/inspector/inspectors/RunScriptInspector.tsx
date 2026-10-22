import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ExternalLink, FileCode2, Plus } from 'lucide-react';
import { Input } from '../../../ui/input';
import { cn } from '../../../../lib/utils';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { fetchScripts } from '../../../../store/scriptSlice';
import { VariableField } from '../editors/VariableField';
import { RunScriptArgsEditor } from './RunScriptArgsEditor';
import { ScriptRunConsole } from '../../debug/ScriptRunConsole';
import { argRowsOf, argRowsText, type ArgRow } from './runScriptArgs';
import { findParentForEachNode, getUpstreamNodes } from '../utils';
import type { InspectorProps } from '../types';

type RunScriptInspectorProps = Pick<InspectorProps, 'node' | 'nodes' | 'edges' | 'updateNodeData'>;

const INPUT_FILE_TEMPLATE = '{{_inputFile}}';

const INPUT_MODES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'none', label: 'No enviar', hint: 'El script solo recibe los argumentos.' },
  { value: 'file', label: 'Archivo temporal', hint: 'Se escribe en un archivo; su ruta llega en {{_inputFile}} y en ORQUESTA_INPUT_FILE.' },
  { value: 'stdin', label: 'Entrada estándar', hint: 'Se envía por stdin y se cierra (sys.stdin.read() / input()).' },
];

const selectClass =
  'flex w-full h-9 rounded-sm border border-border bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:border-accent';

function firstRow(value: any): any {
  if (Array.isArray(value)) return value[0];
  if (value && typeof value === 'object') {
    for (const key of ['rows', 'data', 'items']) {
      if (Array.isArray(value[key])) return value[key][0];
    }
  }
  return value;
}

export function RunScriptInspector({ node, nodes, edges, updateNodeData }: RunScriptInspectorProps) {
  const dispatch = useAppDispatch();
  const scripts = useAppSelector(state => state.scripts.scripts) || [];
  const loading = useAppSelector(state => state.scripts.loading);
  const nodeResults = useAppSelector(state => state.flows.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);
  const data = (node.data || {}) as Record<string, any>;
  const scriptRun = useAppSelector(state => state.flows.nodeScriptRuns?.[node.id]);
  const lastResult = nodeResults[node.id];

  useEffect(() => {
    if (scripts.length === 0) dispatch(fetchScripts());
    // Only on mount: the list is refreshed from the Scripts section
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const value = String(data.script || '');
  const selected = scripts.find(s => s.id === value || s.name === value);
  const missing = value !== '' && !selected && !loading;

  const rows = useMemo(() => argRowsOf(data), [data.argList, data.args]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rows replace the old command-line text: the engine reads argList first
  const setRows = (next: ArgRow[]) => {
    updateNodeData('argList', next);
    if (data.args !== undefined) updateNodeData('args', undefined);
  };
  const scriptFileName = selected?.file_path.split('/').pop()?.replace(/^[0-9a-f-]{36}_/, '');
  const inputMode = data.inputMode === 'file' || data.inputMode === 'stdin' ? data.inputMode : 'none';
  const inputFormat = data.inputFormat === 'lines' ? 'lines' : 'json';

  const [customInputOpen, setCustomInputOpen] = useState(false);
  const showCustomInput = customInputOpen || Boolean(String(data.inputData ?? '').trim());

  // Where the data comes from when no expression is given: the previous node or the loop element
  const defaultInput = useMemo(() => {
    const upstream = getUpstreamNodes(node, edges, nodes)[0];
    if (upstream) return { id: upstream.id, label: String(upstream.data?.label || upstream.id), isLoop: upstream.type === 'forEach' };
    const loop = findParentForEachNode(node, edges, nodes);
    if (loop) return { id: loop.id, label: String(loop.data?.label || loop.id), isLoop: true };
    return null;
  }, [node, edges, nodes]);

  // Columns of the incoming rows (from the last run), to pick the one sent line by line
  const detectedFields = useMemo(() => {
    const explicit = String(data.inputData || '').match(/^\s*\{\{\s*([^}.\s[]+)/);
    const sourceId = explicit ? explicit[1] : defaultInput && !defaultInput.isLoop ? defaultInput.id : null;
    const sample = sourceId ? firstRow(nodeResults[sourceId] ?? intermediateContext?.[sourceId]) : undefined;
    return sample && typeof sample === 'object' && !Array.isArray(sample) ? Object.keys(sample) : [];
  }, [data.inputData, defaultInput, nodeResults, intermediateContext]);

  const usesInputFile = argRowsText(rows).includes(INPUT_FILE_TEMPLATE);
  const timeout = data.timeoutSeconds ?? '';

  return (
    <div className="space-y-4">
      {/* Script */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Script</label>
          <Link to="/scripts" className="text-[10px] text-accent hover:underline flex items-center gap-1">
            Gestionar scripts <ExternalLink size={10} />
          </Link>
        </div>
        <select className={selectClass} value={selected?.id ?? value} onChange={e => updateNodeData('script', e.target.value)}>
          <option value="">{loading ? 'Cargando scripts…' : 'Seleccionar script…'}</option>
          {scripts.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.file_path.split('/').pop()?.replace(/^[0-9a-f-]{36}_/, '')}
            </option>
          ))}
          {missing && <option value={value}>{value} (no encontrado)</option>}
        </select>
        {missing ? (
          <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-px" />
            El script configurado no existe en la sección Scripts. Súbelo allí y selecciónalo de nuevo.
          </p>
        ) : !loading && scripts.length === 0 ? (
          <p className="text-[11px] text-muted">
            Aún no hay scripts. Súbelos en la sección <Link to="/scripts" className="text-accent hover:underline">Scripts</Link>.
          </p>
        ) : null}
      </div>

      {/* Arguments, one per row */}
      <RunScriptArgsEditor
        node={node}
        nodes={nodes}
        edges={edges}
        rows={rows}
        onChange={setRows}
        scriptId={selected?.id}
        scriptFileName={scriptFileName}
      />

      {/* Data from the previous node */}
      <div className="space-y-2">
        <label className="text-xs font-medium">Datos del nodo anterior</label>
        <div className="grid grid-cols-3 gap-1">
          {INPUT_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => updateNodeData('inputMode', m.value)}
              className={cn(
                'h-8 rounded-sm border text-[11px] transition-colors',
                inputMode === m.value ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-border bg-surface text-muted hover:border-border-hover'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted leading-relaxed">{INPUT_MODES.find(m => m.value === inputMode)?.hint}</p>

        {inputMode !== 'none' && (
          <div className="space-y-3 pl-2.5 border-l-2 border-border">
            {/* Source */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-medium">Origen</label>
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
                    <span className="text-muted">Salida de</span>
                    <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium truncate">{defaultInput.label}</span>
                    {defaultInput.isLoop && <span className="text-muted shrink-0">(elemento del bucle)</span>}
                  </div>
                ) : (
                  <div className="px-2.5 py-2 rounded-sm border border-amber-400/50 bg-amber-500/5 text-[11px] text-fg">
                    Conecta un nodo anterior para enviar sus datos.{' '}
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
                  <button
                    type="button"
                    onClick={() => { updateNodeData('inputData', ''); setCustomInputOpen(false); }}
                    className="text-[10px] text-accent hover:underline"
                  >
                    Volver a automático
                  </button>
                </>
              )}
            </div>

            {/* Format */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium">Formato</label>
              <select className={selectClass} value={inputFormat} onChange={e => updateNodeData('inputFormat', e.target.value)}>
                <option value="json">JSON (las filas completas)</option>
                <option value="lines">Un valor por línea (lista de tickets, ids…)</option>
              </select>
            </div>

            {inputFormat === 'lines' && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium">Columna</label>
                <Input
                  className="h-8 text-xs font-mono"
                  list={`runscript-fields-${node.id}`}
                  value={String(data.inputField ?? '')}
                  onChange={e => updateNodeData('inputField', e.target.value)}
                  placeholder={detectedFields[0] ? `${detectedFields[0]} (primera columna si se deja vacío)` : 'Primera columna si se deja vacío'}
                />
                <datalist id={`runscript-fields-${node.id}`}>
                  {detectedFields.map(f => <option key={f} value={f} />)}
                </datalist>
              </div>
            )}

            {inputMode === 'file' && !usesInputFile && (
              <button
                type="button"
                onClick={() => {
                  // Fills an empty --archivo row (e.g. detected from the script) or adds one
                  const at = rows.findIndex(r => /^--?(archivo|file|input|entrada)/i.test(r.flag) && !r.value.trim());
                  setRows(at >= 0
                    ? rows.map((r, i) => (i === at ? { ...r, value: INPUT_FILE_TEMPLATE } : r))
                    : [...rows, { flag: '--archivo', value: INPUT_FILE_TEMPLATE }]);
                }}
                className="text-[10px] text-accent hover:underline flex items-center gap-1"
              >
                <Plus size={10} /> Pasar la ruta del archivo como argumento ({INPUT_FILE_TEMPLATE})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timeout */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Tiempo límite sin actividad (s)</label>
        <Input
          type="number"
          min={1}
          className="h-8 text-xs"
          value={timeout}
          onChange={e => updateNodeData('timeoutSeconds', e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="El de la configuración del sistema"
        />
        <p className="text-[10px] text-muted">Se detiene si pasa este tiempo sin imprimir nada por consola.</p>
      </div>

      {/* Live output of the current run, or the output of the last one */}
      {(scriptRun || lastResult) && <ScriptRunConsole key={scriptRun?.runId ?? 'sin-ejecucion'} runId={scriptRun?.runId} result={lastResult} className="max-h-[320px]" />}

      <div className="p-2.5 rounded-sm border border-border bg-bg/60 text-[11px] text-muted leading-relaxed flex gap-2">
        <FileCode2 size={13} className="shrink-0 mt-0.5 text-muted" />
        <span>
          Para devolver datos, el script escribe JSON en el archivo de <code className="text-fg">ORQUESTA_OUTPUT_FILE</code> o
          lo imprime al final de la consola. Llega en <code className="text-fg">{`{{${String(data.label || 'nodo')}.data}}`}</code>;
          también están <code className="text-fg">stdout</code>, <code className="text-fg">stderr</code> y{' '}
          <code className="text-fg">exitCode</code>. Si el script termina con un código distinto de 0, el nodo falla.
        </span>
      </div>
    </div>
  );
}
