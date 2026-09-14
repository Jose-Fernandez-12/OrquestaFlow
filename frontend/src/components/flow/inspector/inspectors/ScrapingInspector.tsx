import React from 'react';
import { Input } from '../../../ui/input';
import type { InspectorProps } from '../types';

type ScrapingInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function ScrapingInspector({ node, updateNodeData }: ScrapingInspectorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">URL a scrapear</label>
        <Input
          value={(node.data?.url as string) || ''}
          onChange={(e) => updateNodeData('url', e.target.value)}
          placeholder="https://ejemplo.com/precios"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Script de extracción (.py)</label>
        <select
          className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
          value={(node.data?.script as string) || ''}
          onChange={(e) => updateNodeData('script', e.target.value)}
        >
          <option value="">Seleccionar script...</option>
          <option value="1">extraer_precios.py</option>
          <option value="2">parse_table.py</option>
        </select>
      </div>
    </div>
  );
}
