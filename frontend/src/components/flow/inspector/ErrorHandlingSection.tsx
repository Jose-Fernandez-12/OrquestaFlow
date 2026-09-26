import React, { useState } from 'react';
import type { Node } from '@xyflow/react';
import { ChevronDown, RotateCw, ShieldAlert, OctagonX, ArrowRightCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppSelector } from '../../../store/hooks';
import {
  HTTP_NODE_TYPES,
  describeRetryDelays,
  getNodeRetryConfig,
  supportsContinueOnError,
  supportsRetries,
} from '../nodeDefinitions';

interface ErrorHandlingSectionProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
}

const DELAY_OPTIONS = [
  { value: 500, label: '0.5 s' },
  { value: 1000, label: '1 s' },
  { value: 2000, label: '2 s' },
  { value: 5000, label: '5 s' },
  { value: 10000, label: '10 s' },
  { value: 30000, label: '30 s' },
];

/** Per-node retry and "on error" policy, shared by every inspector */
export function ErrorHandlingSection({ node, updateNodeData }: ErrorHandlingSectionProps) {
  const type = node.type || '';
  const data = (node.data || {}) as Record<string, any>;
  const globalHttpRetries = useAppSelector(state => state.settings.settings.http_max_retries ?? 1);

  const canRetry = supportsRetries(type);
  const canContinue = supportsContinueOnError(type);
  const config = getNodeRetryConfig(data);
  const isHttp = HTTP_NODE_TYPES.includes(type);

  const effectiveRetries = config.retryCount ?? (isHttp ? globalHttpRetries : 0);
  const isCustomized = config.retryCount !== null || config.onError === 'continue';
  const [open, setOpen] = useState(isCustomized);

  if ((!canRetry && !canContinue) || type === 'note') return null;

  const summary = [
    canRetry && (effectiveRetries > 0 ? `${effectiveRetries} ${effectiveRetries === 1 ? 'reintento' : 'reintentos'}` : 'Sin reintentos'),
    config.onError === 'continue' ? 'continúa si falla' : 'detiene el flujo si falla',
  ].filter(Boolean).join(' · ');

  const setRetryCount = (raw: string) => {
    if (raw === '') {
      updateNodeData('retryCount', undefined);
      return;
    }
    const n = Math.max(0, Math.min(10, Math.trunc(Number(raw))));
    if (Number.isFinite(n)) updateNodeData('retryCount', n);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-bg/60 hover:bg-bg text-left transition-colors"
      >
        <ShieldAlert size={14} className={isCustomized ? 'text-accent' : 'text-muted'} />
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-fg">Reintentos y errores</span>
          <span className="block text-[10px] text-muted truncate">{summary}</span>
        </span>
        <ChevronDown size={14} className={cn('text-muted transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="p-3 space-y-4 border-t border-border">
          {canRetry && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium flex items-center gap-1.5">
                  <RotateCw size={12} className="text-muted" />
                  Reintentos si falla
                </label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={config.retryCount ?? ''}
                  placeholder={isHttp ? `Global (${globalHttpRetries})` : '0'}
                  onChange={e => setRetryCount(e.target.value)}
                  className="w-28 h-8 rounded-sm border border-border bg-surface px-2 text-xs font-mono text-center focus-visible:outline-none focus-visible:border-accent"
                />
              </div>

              {effectiveRetries > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted">Espera inicial</span>
                      <select
                        value={DELAY_OPTIONS.some(o => o.value === config.retryDelayMs) ? config.retryDelayMs : 1000}
                        onChange={e => updateNodeData('retryDelayMs', Number(e.target.value))}
                        className="w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
                      >
                        {DELAY_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted">Entre intentos</span>
                      <div className="grid grid-cols-2 gap-0.5 p-0.5 bg-bg rounded-sm border border-border h-8">
                        {([['exponential', 'Duplicar'], ['fixed', 'Igual']] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateNodeData('retryBackoff', value)}
                            className={cn(
                              'text-[11px] rounded font-medium transition-colors',
                              config.retryBackoff === value ? 'bg-surface text-accent shadow-sm' : 'text-muted hover:text-fg'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    Esperas: <span className="font-mono text-fg">{describeRetryDelays(config, effectiveRetries)}</span>.
                    {isHttp && ' Solo se reintentan fallos de red, tiempos de espera y respuestas 408, 429 o 5xx; un 4xx falla de inmediato.'}
                    {isHttp && config.retryCount === null && ' Usa el valor global de Configuración.'}
                  </p>
                </>
              )}
            </div>
          )}

          {canContinue && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Si el nodo falla</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['stop', 'Detener el flujo', OctagonX],
                  ['continue', 'Continuar', ArrowRightCircle],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateNodeData('onError', value === 'stop' ? undefined : value)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 h-9 rounded-sm border text-xs font-medium transition-colors',
                      config.onError === value
                        ? 'border-accent bg-accent/5 text-accent'
                        : 'border-border text-muted hover:text-fg hover:border-border-hover'
                    )}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
              {config.onError === 'continue' && (
                <p className="text-[10px] text-muted leading-relaxed">
                  El nodo queda marcado en ámbar y su salida será{' '}
                  <code className="text-fg">{'{ error, failed: true }'}</code>. Los nodos siguientes se ejecutan igual; puedes
                  detectarlo con una Bifurcación sobre <code className="text-fg">{`{{${node.id}.failed}}`}</code>.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
