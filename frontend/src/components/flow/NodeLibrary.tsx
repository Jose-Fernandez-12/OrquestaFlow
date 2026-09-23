import React from 'react';
import {
  Play,
  Globe,
  Code,
  FileOutput,
  Database,
  Clock,
  FileSpreadsheet,
  List,
  Repeat,
  Square,
  GitFork,
  Braces,
  Radio,
  KeyRound,
  Bot,
  FlaskConical
} from 'lucide-react';
import { useAppSelector } from '../../store/hooks';

interface NodeTemplate {
  type: string;
  label: string;
  icon: React.ElementType;
  desc: string;
}

const NODE_GROUPS: Array<{ id: string; title: string; experimental?: boolean; nodes: NodeTemplate[] }> = [
  {
    id: 'sources',
    title: 'Entrada y datos',
    nodes: [
      { type: 'start', label: 'Inicio de flujo', icon: Play, desc: 'Punto de entrada' },
      { type: 'httpRequest', label: 'HTTP Request', icon: Globe, desc: 'Petición HTTP personalizable' },
      { type: 'dataSource', label: 'Obtener datos', icon: FileSpreadsheet, desc: 'Cargar desde Excel o CSV' },
      { type: 'query', label: 'Consulta DB', icon: Database, desc: 'Ejecutar consulta SQL' },
      { type: 'scraping', label: 'Web Scraping', icon: Code, desc: 'Extraer HTML/XML' },
      { type: 'dataList', label: 'Lista de datos', icon: List, desc: 'Definir array de datos JSON' },
    ],
  },
  {
    id: 'logic',
    title: 'Lógica y transformación',
    nodes: [
      { type: 'conditionalBranch', label: 'Bifurcación', icon: GitFork, desc: 'Condiciones Sí/No o Switch' },
      { type: 'jsonTransform', label: 'Transformar datos', icon: Braces, desc: 'Mapear campos o JavaScript' },
      { type: 'forEach', label: 'Para cada elemento', icon: Repeat, desc: 'Inicio de bucle iterativo' },
      { type: 'forEachEnd', label: 'Fin de bucle', icon: Square, desc: 'Cierre del bucle forEach' },
      { type: 'timer', label: 'Temporizador', icon: Clock, desc: 'Pausar ciclo por tiempo' },
    ],
  },
  {
    id: 'output',
    title: 'Salida',
    nodes: [
      { type: 'export', label: 'Exportar CSV/Excel', icon: FileOutput, desc: 'Generar archivo' },
    ],
  },
  {
    id: 'experimental',
    title: 'Experimentales',
    experimental: true,
    nodes: [
      { type: 'webhookTrigger', label: 'Webhook Trigger', icon: Radio, desc: 'Disparador HTTP externo' },
      { type: 'oauth2Connector', label: 'Conector OAuth2', icon: KeyRound, desc: 'Autenticación y tokens' },
      { type: 'aiChatCompletion', label: 'IA / Chat LLM', icon: Bot, desc: 'Prompts a APIs compatibles con OpenAI' },
    ],
  },
];

export function NodeLibrary() {
  const experimentalEnabled = useAppSelector(state => state.settings.settings.experimental_nodes_enabled);

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-[260px] bg-surface border-r border-border flex flex-col h-full z-10 shrink-0">
      <div className="p-4 border-b border-border font-medium">Librería de nodos</div>
      <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
        {NODE_GROUPS.filter(group => !group.experimental || experimentalEnabled).map(group => (
          <div key={group.id} className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
              {group.experimental && <FlaskConical size={11} className="text-fuchsia-600" />}
              {group.title}
              {group.experimental && (
                <span className="text-[8px] font-bold px-1 py-px rounded bg-fuchsia-500/10 text-fuchsia-600 border border-fuchsia-500/25 normal-case tracking-normal">
                  BETA
                </span>
              )}
            </div>
            {group.nodes.map(node => (
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
        ))}
        {!experimentalEnabled && (
          <p className="text-[10px] text-muted leading-relaxed border border-dashed border-border rounded p-2">
            Hay nodos experimentales (Webhook, OAuth2, IA) disponibles. Actívalos en <b>Configuración → Experimental</b>.
          </p>
        )}
      </div>
    </div>
  );
}
