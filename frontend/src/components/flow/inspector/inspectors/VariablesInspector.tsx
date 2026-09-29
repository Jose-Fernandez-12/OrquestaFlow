import React, { useState, useMemo } from 'react';
import type { Node } from '@xyflow/react';
import {
  Plus,
  Trash2,
  Copy,
  Check,
  Calendar,
  Sparkles,
  Braces,
  Table as TableIcon,
  HelpCircle,
  Eye,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { Button } from '../../../ui/button';
import { JsonCodeField } from '../editors/JsonCodeField';
import { cn } from '../../../../lib/utils';

export interface FlowVariable {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  value: any;
  description?: string;
}

interface VariablesInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
  debugPreview?: any;
}

const PRESET_DATES = [
  { label: 'Hoy (YYYYMMDD)', value: '$today_ymd', hint: 'ej. 20260923' },
  { label: 'Hoy (YYYY-MM-DD)', value: '$today_iso', hint: 'ej. 2026-09-23' },
  { label: 'Ayer (YYYYMMDD)', value: '$yesterday_ymd', hint: 'Día anterior' },
  { label: 'Ayer (YYYY-MM-DD)', value: '$yesterday_iso', hint: 'Día anterior ISO' },
  { label: 'Primer día de mes (YYYYMM01)', value: '$month_start', hint: 'ej. 20260901' },
  { label: 'Primer día de mes (YYYY-MM-01)', value: '$month_start_iso', hint: 'ej. 2026-09-01' },
  { label: 'Timestamp (milisegundos)', value: '$timestamp', hint: 'Date.now()' },
  { label: 'Fecha y hora actual (ISO)', value: '$now_iso', hint: 'ISO 8601' },
];

export function resolvePreviewValue(val: any, type: string = 'string'): any {
  if (val === undefined || val === null) return val;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayYMD = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayYMD = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
  const yesterdayISO = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

  const monthStart = `${now.getFullYear()}${pad(now.getMonth() + 1)}01`;
  const monthStartISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

  let processed = val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === '$today' || lower === '$hoy' || lower === '$today_ymd') {
      processed = todayYMD;
    } else if (lower === '$today_iso' || lower === '$hoy_iso') {
      processed = todayISO;
    } else if (lower === '$yesterday' || lower === '$ayer' || lower === '$yesterday_ymd') {
      processed = yesterdayYMD;
    } else if (lower === '$yesterday_iso' || lower === '$ayer_iso') {
      processed = yesterdayISO;
    } else if (lower === '$month_start' || lower === '$inicio_mes') {
      processed = monthStart;
    } else if (lower === '$month_start_iso' || lower === '$inicio_mes_iso') {
      processed = monthStartISO;
    } else if (lower === '$now_timestamp' || lower === '$timestamp') {
      processed = Date.now();
    } else if (lower === '$now_iso') {
      processed = now.toISOString();
    }
  }

  if (type === 'number') {
    const n = Number(processed);
    return isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') {
    return processed === true || processed === 'true' || processed === 1 || processed === '1';
  }
  if (type === 'json') {
    if (typeof processed === 'string') {
      try {
        return JSON.parse(processed);
      } catch {
        return processed;
      }
    }
  }
  return processed;
}

export function VariablesInspector({
  node,
  updateNodeData,
  nodeResult,
  debugPreview,
}: VariablesInspectorProps) {
  const data = (node.data || {}) as Record<string, any>;
  const variables: FlowVariable[] = Array.isArray(data.variables) ? data.variables : [];
  const rawJson: string = typeof data.rawJson === 'string' ? data.rawJson : '';
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [openPresetIndex, setOpenPresetIndex] = useState<number | null>(null);

  const nodeLabel = (data.label as string) || 'Variables';

  const updateVariable = (index: number, patch: Partial<FlowVariable>) => {
    const next = [...variables];
    next[index] = { ...next[index], ...patch };
    updateNodeData('variables', next);
  };

  const addVariable = (initial?: Partial<FlowVariable>) => {
    const next: FlowVariable[] = [
      ...variables,
      {
        key: initial?.key || `variable_${variables.length + 1}`,
        type: initial?.type || 'string',
        value: initial?.value !== undefined ? initial.value : '',
        description: initial?.description || '',
      },
    ];
    updateNodeData('variables', next);
  };

  const removeVariable = (index: number) => {
    const next = variables.filter((_, i) => i !== index);
    updateNodeData('variables', next);
  };

  const addDateRangePreset = () => {
    const next: FlowVariable[] = [
      ...variables,
      {
        key: 'fechaInicio',
        type: 'date',
        value: '$month_start',
        description: 'Primer día del mes (YYYYMM01)',
      },
      {
        key: 'fechaFin',
        type: 'date',
        value: '$today_ymd',
        description: 'Día actual (YYYYMMDD)',
      },
    ];
    updateNodeData('variables', next);
  };

  const handleCopyTag = (expr: string, keyName: string) => {
    navigator.clipboard.writeText(expr);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Preview object of all variables resolved
  const resolvedPreview = useMemo(() => {
    if (viewMode === 'json' && rawJson.trim()) {
      try {
        return JSON.parse(rawJson);
      } catch {
        return { error: 'JSON inválido' };
      }
    }
    const res: Record<string, any> = {};
    for (const v of variables) {
      if (!v || !v.key || !v.key.trim()) continue;
      res[v.key.trim()] = resolvePreviewValue(v.value, v.type);
    }
    return res;
  }, [variables, rawJson, viewMode]);

  const handleCopyResolvedJson = () => {
    navigator.clipboard.writeText(JSON.stringify(resolvedPreview, null, 2));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  // Sync Table to JSON or viceversa
  const handleSwitchToJson = () => {
    const obj: Record<string, any> = {};
    for (const v of variables) {
      if (v.key) obj[v.key] = v.value;
    }
    updateNodeData('rawJson', JSON.stringify(obj, null, 2));
    setViewMode('json');
  };

  const handleSwitchToTable = () => {
    if (rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const nextVars: FlowVariable[] = Object.entries(parsed).map(([k, val]) => {
            let t: FlowVariable['type'] = 'string';
            if (typeof val === 'number') t = 'number';
            else if (typeof val === 'boolean') t = 'boolean';
            else if (typeof val === 'object' && val !== null) t = 'json';
            return {
              key: k,
              type: t,
              value: typeof val === 'object' ? JSON.stringify(val) : val,
              description: '',
            };
          });
          updateNodeData('variables', nextVars);
        }
      } catch {}
    }
    setViewMode('table');
  };

  const activeResult = debugPreview?.nodePreview?.result || nodeResult;

  return (
    <div className="space-y-4">
      {/* Mode Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 bg-bg rounded border border-border text-xs">
          <button
            type="button"
            onClick={handleSwitchToTable}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium',
              viewMode === 'table'
                ? 'bg-surface text-violet-600 shadow-sm border border-violet-500/30'
                : 'text-muted hover:text-fg'
            )}
          >
            <TableIcon size={12} />
            <span>Tabla de Variables</span>
          </button>
          <button
            type="button"
            onClick={handleSwitchToJson}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium',
              viewMode === 'json'
                ? 'bg-surface text-violet-600 shadow-sm border border-violet-500/30'
                : 'text-muted hover:text-fg'
            )}
          >
            <Braces size={12} />
            <span>Editor JSON</span>
          </button>
        </div>

        <span className="text-[11px] text-muted">
          {variables.length} {variables.length === 1 ? 'variable' : 'variables'}
        </span>
      </div>

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="space-y-3">
          {variables.length === 0 ? (
            <div className="p-4 border border-dashed border-border rounded-md text-center bg-bg/50 space-y-3">
              <div className="w-8 h-8 rounded-full bg-violet-500/10 text-violet-600 flex items-center justify-center mx-auto">
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-xs font-semibold text-fg">Sin variables definidas</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Define parámetros reutilizables para consumirlos en tus peticiones o consultas.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => addVariable()}
                  className="text-xs h-7 gap-1 border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
                >
                  <Plus size={12} />
                  <span>Agregar variable</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addDateRangePreset}
                  className="text-xs h-7 gap-1"
                >
                  <Calendar size={12} />
                  <span>Rango de fechas</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {variables.map((variable, idx) => {
                const isPresetOpen = openPresetIndex === idx;
                const isDynamic = typeof variable.value === 'string' && variable.value.startsWith('$');
                const isTemplate = typeof variable.value === 'string' && variable.value.includes('{{');
                const previewVal = resolvePreviewValue(variable.value, variable.type);

                return (
                  <div
                    key={idx}
                    className="p-2.5 bg-surface border border-border rounded-sm space-y-2 hover:border-muted transition-colors relative"
                  >
                    {/* Top Row: Key, Type, Actions */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={variable.key}
                          onChange={e => updateVariable(idx, { key: e.target.value })}
                          placeholder="nombreVariable"
                          className="w-full h-7 px-2 text-xs font-mono font-medium rounded-sm border border-border bg-bg text-fg focus-visible:outline-none focus-visible:border-violet-500"
                        />
                      </div>

                      <div className="w-28 shrink-0">
                        <select
                          value={variable.type}
                          onChange={e => updateVariable(idx, { type: e.target.value as any })}
                          className="w-full h-7 px-1.5 text-xs rounded-sm border border-border bg-bg text-fg focus-visible:outline-none focus-visible:border-violet-500"
                        >
                          <option value="string">Texto</option>
                          <option value="number">Número</option>
                          <option value="boolean">Booleano</option>
                          <option value="date">Fecha</option>
                          <option value="json">JSON</option>
                        </select>
                      </div>

                      {/* Quick copy template */}
                      {variable.key && (
                        <button
                          type="button"
                          onClick={() => handleCopyTag(`{{${variable.key}}}`, variable.key)}
                          title={`Copiar {{${variable.key}}}`}
                          className="h-7 px-1.5 rounded text-muted hover:text-violet-600 hover:bg-violet-500/10 transition-colors flex items-center gap-1 text-[11px]"
                        >
                          {copiedKey === variable.key ? (
                            <Check size={13} className="text-emerald-500" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      )}

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeVariable(idx)}
                        className="h-7 w-7 rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center shrink-0"
                        title="Eliminar variable"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Middle Row: Value Input & Presets */}
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 relative">
                        {variable.type === 'boolean' ? (
                          <div className="flex items-center gap-2 h-7 px-2 bg-bg border border-border rounded-sm">
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-fg">
                              <input
                                type="radio"
                                name={`bool_${idx}`}
                                checked={variable.value === true || variable.value === 'true'}
                                onChange={() => updateVariable(idx, { value: true })}
                                className="accent-violet-600"
                              />
                              <span>true (Verdadero)</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-fg ml-3">
                              <input
                                type="radio"
                                name={`bool_${idx}`}
                                checked={variable.value === false || variable.value === 'false'}
                                onChange={() => updateVariable(idx, { value: false })}
                                className="accent-violet-600"
                              />
                              <span>false (Falso)</span>
                            </label>
                          </div>
                        ) : (
                          <input
                            type={variable.type === 'number' ? 'number' : 'text'}
                            value={variable.value ?? ''}
                            onChange={e => updateVariable(idx, { value: e.target.value })}
                            placeholder={
                              variable.type === 'date'
                                ? 'YYYYMMDD o $today_ymd'
                                : variable.type === 'json'
                                ? '{"clave": "valor"}'
                                : 'Valor'
                            }
                            className={cn(
                              'w-full h-7 px-2 text-xs rounded-sm border bg-bg text-fg focus-visible:outline-none',
                              isDynamic
                                ? 'border-violet-500/50 text-violet-600 font-mono'
                                : isTemplate
                                ? 'border-amber-500/50 text-amber-600 font-mono'
                                : 'border-border focus-visible:border-violet-500'
                            )}
                          />
                        )}
                      </div>

                      {/* Preset button for date/presets */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenPresetIndex(isPresetOpen ? null : idx)}
                          title="Insertar valor dinámico (Fechas automáticas)"
                          className={cn(
                            'h-7 px-2 rounded-sm border text-[11px] font-medium flex items-center gap-1 transition-colors',
                            isPresetOpen
                              ? 'bg-violet-500 text-white border-violet-600'
                              : 'bg-bg border-border text-muted hover:text-fg hover:border-muted'
                          )}
                        >
                          <Calendar size={12} />
                          <span>Dinámico</span>
                        </button>

                        {isPresetOpen && (
                          <div
                            className="absolute right-0 top-8 z-50 w-64 bg-surface border border-border rounded-md shadow-lg p-1.5 space-y-1 text-xs"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="px-2 py-1 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-border">
                              Valores de fecha dinámicos
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {PRESET_DATES.map(p => (
                                <button
                                  key={p.value}
                                  type="button"
                                  onClick={() => {
                                    updateVariable(idx, { value: p.value });
                                    setOpenPresetIndex(null);
                                  }}
                                  className="w-full text-left px-2 py-1.5 rounded hover:bg-violet-500/10 hover:text-violet-600 flex items-center justify-between group transition-colors"
                                >
                                  <div>
                                    <div className="font-medium text-fg group-hover:text-violet-600">
                                      {p.label}
                                    </div>
                                    <div className="text-[10px] text-muted font-mono">{p.hint}</div>
                                  </div>
                                  <span className="text-[10px] font-mono text-violet-600 opacity-0 group-hover:opacity-100">
                                    {p.value}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Preview / Evaluation Pill */}
                    {variable.key && (
                      <div className="flex items-center justify-between text-[10px] text-muted pt-0.5">
                        <div className="flex items-center gap-1 truncate">
                          <span className="text-muted/70">Uso:</span>
                          <code className="text-violet-600 dark:text-violet-400 font-mono bg-violet-500/10 px-1 py-0.2 rounded border border-violet-500/20">
                            {`{{${nodeLabel}.${variable.key}}}`}
                          </code>
                          <span className="text-muted/50">o</span>
                          <code className="text-violet-600 dark:text-violet-400 font-mono bg-violet-500/10 px-1 py-0.2 rounded border border-violet-500/20">
                            {`{{${variable.key}}}`}
                          </code>
                        </div>

                        {previewVal !== undefined && (
                          <div className="flex items-center gap-1 shrink-0 font-mono text-[10px] text-fg/80">
                            <span className="text-muted/70">=</span>
                            <span className="font-semibold text-emerald-600 truncate max-w-[120px]">
                              {typeof previewVal === 'object'
                                ? JSON.stringify(previewVal)
                                : String(previewVal)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => addVariable()}
                  className="text-xs h-7 gap-1 border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
                >
                  <Plus size={12} />
                  <span>Agregar variable</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addDateRangePreset}
                  className="text-[11px] h-7 gap-1 text-muted hover:text-fg"
                >
                  <Calendar size={12} />
                  <span>+ Rango de fechas</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* JSON RAW VIEW */}
      {viewMode === 'json' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs text-muted">Objeto JSON de variables:</label>
            <JsonCodeField
              minHeight="180px"
              value={rawJson}
              onChange={v => updateNodeData('rawJson', v)}
              placeholder={'{\n  "fechaInicio": "$month_start",\n  "fechaFin": "$today_ymd",\n  "estado": "A"\n}'}
            />
          </div>
          <p className="text-[11px] text-muted">
            Los valores que comiencen con <code>$today_ymd</code>, <code>$month_start</code>, etc. se resolverán automáticamente con la fecha correspondiente al ejecutarse.
          </p>
        </div>
      )}

      {/* LIVE PREVIEW CARD */}
      <div className="p-3 bg-bg rounded-sm border border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Eye size={13} className="text-violet-600" />
            <span>Vista previa de salida generada</span>
          </div>
          <button
            type="button"
            onClick={handleCopyResolvedJson}
            className="flex items-center gap-1 text-[11px] text-muted hover:text-fg transition-colors"
            title="Copiar JSON completo resuelto"
          >
            {copiedAll ? (
              <>
                <Check size={11} className="text-emerald-500" />
                <span className="text-emerald-500">Copiado</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copiar JSON</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-2 bg-surface rounded border border-border text-[11px] font-mono text-fg max-h-36 overflow-auto">
          {JSON.stringify(resolvedPreview, null, 2)}
        </pre>
      </div>

      {/* EXECUTION RESULTS CARD IF AVAILABLE */}
      {activeResult && typeof activeResult === 'object' && !activeResult.error && (
        <div className="p-3 bg-emerald-500/5 rounded-sm border border-emerald-500/20 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 size={13} />
              <span>Resultado de última ejecución</span>
            </span>
            <span className="text-[10px] text-emerald-600 font-mono">
              {Object.keys(activeResult).length} claves
            </span>
          </div>
          <pre className="p-2 bg-surface rounded border border-emerald-500/20 text-[11px] font-mono text-fg max-h-32 overflow-auto">
            {JSON.stringify(activeResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
