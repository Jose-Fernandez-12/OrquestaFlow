import React from 'react';
import type { InspectorProps } from '../types';

export function StartInspector({ node }: Pick<InspectorProps, 'node'>) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-md">
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">
          Nodo de inicio
        </p>
        <p className="text-[11px] text-muted leading-relaxed">
          Este nodo es el punto de entrada del flujo. La ejecucion comienza aqui y sigue hacia los nodos conectados a su salida.
        </p>
      </div>
    </div>
  );
}
