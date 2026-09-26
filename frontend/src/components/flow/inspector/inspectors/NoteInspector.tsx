import React from 'react';
import { cn } from '../../../../lib/utils';
import { NOTE_COLORS } from '../../nodes/noteColors';
import type { InspectorProps } from '../types';

type NoteInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function NoteInspector({ node, updateNodeData }: NoteInspectorProps) {
  const color = String(node.data?.color || 'amarillo');
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Texto de la nota</label>
        <textarea
          className="w-full min-h-[160px] rounded-sm border border-border bg-surface px-2.5 py-2 text-xs leading-relaxed focus-visible:outline-none focus-visible:border-accent resize-y"
          value={String(node.data?.text || '')}
          onChange={e => updateNodeData('text', e.target.value)}
          placeholder="Explica qué hace esta parte del flujo, a quién avisar si falla, supuestos de los datos…"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Color</label>
        <div className="flex gap-2">
          {Object.entries(NOTE_COLORS).map(([key, tone]) => (
            <button
              key={key}
              type="button"
              onClick={() => updateNodeData('color', key)}
              title={tone.label}
              className={cn(
                'w-8 h-8 rounded-md border-2 transition-all',
                tone.card,
                color === key ? 'border-accent ring-2 ring-accent/20' : tone.border
              )}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">
        Las notas solo documentan el flujo: no se ejecutan ni se conectan. En la exportación a Python aparecen en el README.
      </p>
    </div>
  );
}
