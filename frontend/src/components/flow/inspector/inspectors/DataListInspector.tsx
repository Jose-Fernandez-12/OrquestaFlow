import React from 'react';
import type { InspectorProps } from '../types';
import { JsonCodeField } from '../editors/JsonCodeField';

type DataListInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function DataListInspector({ node, updateNodeData }: DataListInspectorProps) {
  const items = (node.data?.items as string) || '';

  const summary = (() => {
    if (!items.trim()) return null;
    try {
      const parsed = JSON.parse(items);
      if (!Array.isArray(parsed)) return { valid: false, msg: 'El contenido debe ser una lista: [ {...}, {...} ]' };
      const fields = parsed[0] && typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) ? Object.keys(parsed[0]) : [];
      return {
        valid: true,
        msg: `${parsed.length} ${parsed.length === 1 ? 'elemento' : 'elementos'}${fields.length ? ` · campos: ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '…' : ''}` : ''}`,
      };
    } catch {
      return null; // the editor already shows the syntax error
    }
  })();

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">Datos (lista JSON)</label>
      <JsonCodeField
        minHeight="200px"
        maxHeight="420px"
        value={items}
        onChange={v => updateNodeData('items', v)}
        placeholder={'[\n  { "id": 1, "nombre": "A" },\n  { "id": 2, "nombre": "B" }\n]'}
      />
      {summary && (
        <p className={`text-[11px] ${summary.valid ? 'text-muted' : 'text-danger'}`}>{summary.msg}</p>
      )}
    </div>
  );
}
