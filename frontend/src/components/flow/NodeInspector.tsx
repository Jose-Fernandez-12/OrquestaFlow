import React, { useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { JsonTreeViewer } from './JsonTreeViewer';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

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
            
            {/* JSON Selector Modal Trigger */}
            <div className="pt-2 border-t border-border mt-2">
              <JsonSelectorTrigger node={node} />
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

function JsonSelectorTrigger({ node }: { node: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');

  // Sample data to navigate
  const sampleJson = {
    status: "success",
    code: 200,
    data: {
      items: [
        { id: "prod_01", name: "Laptop Pro", price: 1299.99, stock: 45 },
        { id: "prod_02", name: "Mouse Inalámbrico", price: 49.99, stock: 120 }
      ],
      pagination: {
        page: 1,
        total_pages: 5,
        total_items: 10
      }
    }
  };

  const handleSelectKey = (path: string) => {
    // Convert e.g. "response.data.items[0].price" to flow variable format like "{{nodeId.data.items[0].price}}"
    const variableFormat = `{{${node.id}.${path}}}`;
    setSelectedKey(variableFormat);
    navigator.clipboard.writeText(variableFormat);
    alert(`Copiado al portapapeles: ${variableFormat}`);
  };

  return (
    <>
      <Button variant="textLink" onClick={() => setIsOpen(true)}>
        Visualizar Respuesta (JSON)
      </Button>

      {isOpen && createPortal(
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-lg p-6 relative flex flex-col gap-4">
            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-fg"
            >
              <X size={18} />
            </button>

            <div>
              <h2 className="text-lg font-semibold">Selector de campos JSON</h2>
              <p className="text-xs text-muted mt-1">Haz clic en cualquier propiedad para copiar su variable de referencia del flujo.</p>
            </div>

            <JsonTreeViewer data={sampleJson} onSelectKey={handleSelectKey} />

            {selectedKey && (
              <div className="p-3 bg-bg border border-border rounded-sm">
                <span className="text-xs text-muted block mb-1">Variable seleccionada</span>
                <code className="text-xs text-accent font-semibold">{selectedKey}</code>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="default" size="sm" onClick={() => setIsOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
