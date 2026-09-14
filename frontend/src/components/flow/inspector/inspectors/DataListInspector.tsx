import React from 'react';
import type { InspectorProps } from '../types';

type DataListInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function DataListInspector({ node, updateNodeData }: DataListInspectorProps) {
  const validationResult = (() => {
    if (!node.data?.items) return null;
    try {
      const parsed = JSON.parse(node.data.items as string);
      if (!Array.isArray(parsed)) return { valid: false, msg: 'Debe ser un array valido.' };
      return { valid: true, msg: `Contiene ${parsed.length} elementos.` };
    } catch {
      return { valid: false, msg: 'JSON invalido.' };
    }
  })();

  const borderClass = validationResult
    ? validationResult.valid
      ? 'border-border'
      : 'border-red-500 ring-1 ring-red-500/30'
    : 'border-border';

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Datos (JSON Array)</label>
        <textarea
          className={`flex w-full min-h-[200px] rounded-sm border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent ${borderClass}`}
          value={(node.data?.items as string) || ''}
          onChange={e => updateNodeData('items', e.target.value)}
          placeholder={'[\n  { "id": 1, "nombre": "A" },\n  { "id": 2, "nombre": "B" }\n]'}
        />
        {validationResult && (
          <p className={`text-[10px] ${validationResult.valid ? 'text-muted' : 'text-red-500'}`}>
            {validationResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}
