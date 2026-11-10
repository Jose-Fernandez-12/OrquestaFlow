import React, { useState } from 'react';
import { Play, Bug, X, SlidersHorizontal, RotateCcw, Calendar } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { FlowParameter } from './flowParameters';
import { resolvePreviewValue } from './inspector/inspectors/VariablesInspector';

interface RunFlowParamsModalProps {
  flowName: string;
  parameters: FlowParameter[];
  initialMode: 'normal' | 'debug';
  onConfirm: (params: Record<string, any>, mode: 'normal' | 'debug') => void;
  onClose: () => void;
}

const DATE_PRESETS = [
  { label: 'Hoy (YYYYMMDD)', value: '$today_ymd' },
  { label: 'Hoy (ISO)', value: '$today_iso' },
  { label: 'Ayer (YYYYMMDD)', value: '$yesterday_ymd' },
  { label: 'Inicio de mes', value: '$month_start' },
];

export function RunFlowParamsModal({
  flowName,
  parameters,
  initialMode,
  onConfirm,
  onClose,
}: RunFlowParamsModalProps) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const p of parameters) {
      init[p.key] = p.defaultValue ?? '';
    }
    return init;
  });

  const handleReset = () => {
    const reset: Record<string, any> = {};
    for (const p of parameters) {
      reset[p.key] = p.defaultValue ?? '';
    }
    setValues(reset);
  };

  const handleSubmit = (e: React.FormEvent, mode: 'normal' | 'debug') => {
    e.preventDefault();
    onConfirm(values, mode);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Parámetros de ejecución para ${flowName}`}
        className="bg-surface border border-border rounded-md shadow-xl w-full max-w-lg flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-bg/50">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-violet-500/10 text-violet-600 flex items-center justify-center shrink-0">
              <SlidersHorizontal size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg truncate">
                Parámetros al ejecutar
              </h3>
              <p className="text-[11px] text-muted truncate">{flowName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-fg p-1 rounded transition-colors"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={e => handleSubmit(e, initialMode)} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-4 space-y-3 overflow-y-auto flex-1">
            <p className="text-xs text-muted leading-relaxed">
              Ajusta los valores para esta ejecución. Los valores por defecto del flujo no se modificarán en el diseño.
            </p>

            <div className="space-y-3">
              {parameters.map(param => {
                const val = values[param.key];
                const resolved = resolvePreviewValue(val, param.type);
                const isDynamic = typeof val === 'string' && val.trim().startsWith('$');

                return (
                  <div
                    key={param.key}
                    className="p-3 rounded-sm border border-border bg-bg/40 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <label
                          htmlFor={`param-${param.key}`}
                          className="text-xs font-mono font-semibold text-fg truncate"
                        >
                          {param.key}
                        </label>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface border border-border text-muted uppercase">
                          {param.type}
                        </span>
                        {param.promptOnRun && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-500/10 text-violet-600 border border-violet-500/20">
                            Solicitado
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted truncate">
                        {param.nodeLabel}
                      </span>
                    </div>

                    {param.description && (
                      <p className="text-[11px] text-muted">{param.description}</p>
                    )}

                    {param.type === 'boolean' ? (
                      <div className="flex items-center gap-4 h-8 px-2.5 bg-surface border border-border rounded-sm">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer text-fg">
                          <input
                            type="radio"
                            name={`run_param_${param.key}`}
                            checked={val === true || val === 'true'}
                            onChange={() => setValues(prev => ({ ...prev, [param.key]: true }))}
                            className="accent-violet-600"
                          />
                          <span>true (Verdadero)</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer text-fg">
                          <input
                            type="radio"
                            name={`run_param_${param.key}`}
                            checked={val === false || val === 'false'}
                            onChange={() => setValues(prev => ({ ...prev, [param.key]: false }))}
                            className="accent-violet-600"
                          />
                          <span>false (Falso)</span>
                        </label>
                      </div>
                    ) : (
                      <input
                        id={`param-${param.key}`}
                        type={param.type === 'number' ? 'number' : 'text'}
                        value={val ?? ''}
                        onChange={e => setValues(prev => ({ ...prev, [param.key]: e.target.value }))}
                        placeholder={String(param.defaultValue ?? '')}
                        className={cn(
                          'w-full h-8 px-2.5 text-xs rounded-sm border bg-surface text-fg focus-visible:outline-none focus-visible:border-violet-500',
                          isDynamic ? 'border-violet-500/50 font-mono text-violet-600' : 'border-border'
                        )}
                      />
                    )}

                    {param.type === 'date' && (
                      <div className="flex items-center flex-wrap gap-1 pt-0.5">
                        <Calendar size={11} className="text-muted mr-0.5" />
                        {DATE_PRESETS.map(preset => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => setValues(prev => ({ ...prev, [param.key]: preset.value }))}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                              val === preset.value
                                ? 'bg-violet-500/15 border-violet-500/40 text-violet-600 font-medium'
                                : 'bg-surface border-border text-muted hover:text-fg'
                            )}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {resolved !== undefined && String(resolved) !== '' && (
                      <div className="flex items-center justify-between text-[10px] text-muted pt-0.5">
                        <span>Valor efectivo en ejecución:</span>
                        <code className="font-mono font-semibold text-emerald-600 truncate max-w-[240px]">
                          {typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved)}
                        </code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border bg-bg/50 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1.5 text-xs text-muted hover:text-fg"
            >
              <RotateCcw size={13} />
              <span>Restaurar por defecto</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={e => handleSubmit(e, 'debug')}
                className={cn(
                  'gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10',
                  initialMode === 'debug' && 'ring-1 ring-amber-500/40'
                )}
              >
                <Bug size={13} />
                <span>Depurar</span>
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="gap-1.5 bg-success hover:bg-success/90"
              >
                <Play size={13} />
                <span>Ejecutar ahora</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

