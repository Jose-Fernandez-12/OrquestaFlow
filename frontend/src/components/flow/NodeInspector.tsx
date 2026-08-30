import React from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

export function NodeInspector() {
  const selectedNodeId = useAppSelector(state => state.flows.selectedNodeId);
  const currentFlow = useAppSelector(state => state.flows.currentFlow);

  if (!selectedNodeId) {
    return (
      <div className="w-[300px] bg-surface border-l border-border flex flex-col items-center justify-center h-full z-10 shrink-0 p-8 text-center text-muted">
        Selecciona un nodo en el canvas para ver y editar sus propiedades.
      </div>
    );
  }

  // Parse definition to get node data
  let node = null;
  if (currentFlow && currentFlow.definition) {
    try {
      const def = JSON.parse(currentFlow.definition);
      node = def.nodes?.find((n: any) => n.id === selectedNodeId);
    } catch (e) {
      // ignore parse error
    }
  }

  if (!node) {
    return (
      <div className="w-[300px] bg-surface border-l border-border flex flex-col p-4 z-10 shrink-0">
        Nodo no encontrado
      </div>
    );
  }

  return (
    <div className="w-[300px] bg-surface border-l border-border flex flex-col h-full z-10 shrink-0">
      <div className="p-4 border-b border-border font-medium flex items-center justify-between">
        Configuración
        <span className="text-xs text-muted px-2 py-1 bg-bg rounded-sm font-mono">{node.type}</span>
      </div>
      <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
        
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Etiqueta del nodo</label>
          <Input defaultValue={node.data?.label || ''} />
        </div>

        {node.type.startsWith('http') && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Endpoint URL</label>
              <Input defaultValue={node.data?.endpoint || ''} placeholder="https://api.example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato de respuesta</label>
              <select className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70">
                <option value="JSON">JSON</option>
                <option value="XML">XML</option>
                <option value="Text">Texto plano</option>
              </select>
            </div>
            {/* Headers / Auth placeholder */}
            <div className="pt-2 border-t border-border mt-2">
              <Button variant="textLink">Configurar Headers...</Button>
            </div>
          </>
        )}

        {node.type === 'scraping' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">URL a scrapear</label>
              <Input defaultValue={node.data?.url || ''} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Script de extracción (.py)</label>
              <select className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70">
                <option value="">Seleccionar script...</option>
                <option value="1">extraer_precios.py</option>
                <option value="2">parse_table.py</option>
              </select>
            </div>
          </>
        )}

        {node.type === 'export' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nombre de archivo</label>
              <Input defaultValue={node.data?.fileName || 'export'} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato</label>
              <select className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70">
                <option value="CSV">CSV</option>
                <option value="Excel">Excel (.xlsx)</option>
              </select>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
