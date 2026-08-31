import React from 'react';
import { Play, Globe, Code, FileOutput, ArrowRight } from 'lucide-react';

const NODE_TEMPLATES = [
  { type: 'start', label: 'Inicio de flujo', icon: Play, desc: 'Punto de entrada' },
  { type: 'httpRequest', label: 'HTTP Request', icon: Globe, desc: 'Petición HTTP personalizable' },
  { type: 'scraping', label: 'Web Scraping', icon: Code, desc: 'Extraer HTML/XML' },
  { type: 'export', label: 'Exportar CSV/Excel', icon: FileOutput, desc: 'Generar archivo' },
];

export function NodeLibrary() {
  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-[260px] bg-surface border-r border-border flex flex-col h-full z-10 shrink-0">
      <div className="p-4 border-b border-border font-medium">Librería de nodos</div>
      <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-3">
        {NODE_TEMPLATES.map(node => (
          <div
            key={node.type}
            className="p-3 border border-border rounded-sm flex items-center gap-3 cursor-grab hover:border-muted hover:bg-bg transition-colors active:cursor-grabbing"
            draggable
            onDragStart={(e) => onDragStart(e, node.type, node.label)}
          >
            <div className="p-2 bg-bg rounded-sm text-fg">
              <node.icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{node.label}</div>
              <div className="text-xs text-muted truncate">{node.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
