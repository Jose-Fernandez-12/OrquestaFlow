import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { InspectorProps } from '../types';
import { getFlowParameters } from '../../flowParameters';

export function StartInspector({ nodes }: Pick<InspectorProps, 'node' | 'nodes'>) {
  const params = getFlowParameters(nodes || []);
  const promptCount = params.filter(p => p.promptOnRun).length;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-md">
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">
          Nodo de inicio
        </p>
        <p className="text-[11px] text-muted leading-relaxed">
          Este nodo es el punto de entrada del flujo. La ejecución comienza aquí y sigue hacia los nodos conectados a su salida.
        </p>
      </div>

      <div className="p-3 bg-surface border border-border rounded-md space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <SlidersHorizontal size={13} className="text-violet-600" />
            <span>Parámetros de ejecución</span>
          </div>
          {params.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 border border-violet-500/20">
              {promptCount} {promptCount === 1 ? 'solicitado al ejecutar' : 'solicitados al ejecutar'}
            </span>
          )}
        </div>

        {params.length === 0 ? (
          <p className="text-[11px] text-muted leading-relaxed">
            Añade un nodo <strong>Variables</strong> al lienzo y marca <em>"Pedir al ejecutar"</em> en las variables que quieras ajustar antes de lanzar el flujo o recibir desde un subflujo.
          </p>
        ) : (
          <div className="space-y-1.5">
            {params.map(p => (
              <div
                key={p.key}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-bg border border-border text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="font-mono font-semibold text-violet-600 dark:text-violet-400">
                      {p.key}
                    </code>
                    <span className="text-[10px] text-muted uppercase">{p.type}</span>
                    {p.promptOnRun && (
                      <span className="text-[10px] px-1 py-0.2 rounded bg-violet-500/10 text-violet-600 border border-violet-500/20">
                        Pedir al ejecutar
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-[10px] text-muted truncate mt-0.5">{p.description}</p>
                  )}
                </div>
                <span className="text-[11px] font-mono text-muted truncate max-w-[110px]">
                  {String(p.defaultValue ?? '')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
