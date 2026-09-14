import React from 'react';
import type { InspectorProps } from '../types';

type ForEachEndInspectorProps = Pick<InspectorProps, 'node'>;

export function ForEachEndInspector({ node }: ForEachEndInspectorProps) {
  return (
    <div className="space-y-4">
      <div className="bg-bg/50 border border-border p-3 rounded-sm">
        <p className="text-xs font-medium mb-1">Este nodo marca el final del bucle forEach.</p>
        <p className="text-[11px] text-muted leading-relaxed">
          Los nodos entre 'Para cada elemento' y este nodo se ejecutaran una vez por cada elemento del array.
        </p>
      </div>
    </div>
  );
}
