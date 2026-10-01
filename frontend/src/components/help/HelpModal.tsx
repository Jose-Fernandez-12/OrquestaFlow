import { useState, useEffect } from 'react';
import {
  X,
  HelpCircle,
  BookOpen,
  Code2,
  Activity,
  Lightbulb,
  AlertCircle,
  RotateCw,
  Bug,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { closeHelpModal } from '../../store/uiSlice';
import { API_BASE_URL, getApiUrl } from '../../lib/api';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { NODE_GROUPS, SYNTAX_ITEMS, DEBUG_GUIDE, TIPS, type GuideItem } from './helpContent';

type HelpTab = 'nodes' | 'syntax' | 'debug' | 'tips' | 'health';

const TABS: Array<{ id: HelpTab; label: string; icon: typeof BookOpen }> = [
  { id: 'nodes', label: 'Nodos', icon: BookOpen },
  { id: 'syntax', label: 'Sintaxis', icon: Code2 },
  { id: 'debug', label: 'Probar y depurar', icon: Bug },
  { id: 'tips', label: 'Buenas prácticas', icon: Lightbulb },
  { id: 'health', label: 'Diagnóstico', icon: Activity },
];

function GuideList({ items }: { items: GuideItem[] }) {
  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.title} className="p-3.5 bg-bg rounded-md border border-border space-y-1">
          <h4 className="text-xs font-semibold text-fg">{item.title}</h4>
          <p className="text-xs text-muted leading-relaxed">{item.text}</p>
        </div>
      ))}
    </div>
  );
}

export function HelpModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.helpModalOpen);

  const [activeTab, setActiveTab] = useState<HelpTab>('nodes');
  const [healthStatus, setHealthStatus] = useState<{
    status: string;
    version?: string;
    timestamp?: string;
    latencyMs?: number;
    checked: boolean;
    error?: string;
  }>({ status: 'unknown', checked: false });
  const [checkingHealth, setCheckingHealth] = useState(false);

  const checkHealth = async () => {
    setCheckingHealth(true);
    const start = Date.now();
    try {
      const res = await fetch(getApiUrl('/health'));
      const latencyMs = Date.now() - start;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealthStatus({
        status: data.status || 'ok',
        version: data.version,
        timestamp: data.timestamp || new Date().toISOString(),
        latencyMs,
        checked: true,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      setHealthStatus({
        status: 'error',
        latencyMs,
        checked: true,
        error: err.message || 'No se pudo contactar el servidor backend',
      });
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'health' && !healthStatus.checked) {
      checkHealth();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-accent/10 text-accent">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-fg">Centro de Ayuda y Referencia</h2>
              <p className="text-xs text-muted">Nodos, sintaxis de variables, pruebas y depuración, y estado del servidor</p>
            </div>
          </div>
          <button
            onClick={() => dispatch(closeHelpModal())}
            className="p-1 rounded-md text-muted hover:text-fg hover:bg-bg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex shrink-0 border-b border-border bg-bg/50 px-6 overflow-x-auto [scrollbar-width:thin]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                activeTab === tab.id
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-muted hover:text-fg"
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'nodes' && (
            <div className="space-y-5">
              <p className="text-xs text-muted">
                Un flujo es un grafo de nodos conectados: cada nodo se ejecuta cuando terminan los nodos que lo alimentan,
                y los que no dependen entre sí corren en paralelo.
              </p>
              {NODE_GROUPS.map(group => (
                <div key={group.title} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{group.title}</h3>
                    {group.note && <span className="text-[11px] text-muted">· {group.note}</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {group.nodes.map(node => (
                      <div key={node.name} className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                        <node.icon size={16} className={cn('mt-0.5 shrink-0', node.color)} />
                        <div className="space-y-0.5">
                          <h4 className="text-xs font-semibold text-fg">{node.name}</h4>
                          <p className="text-[11px] text-muted leading-relaxed">{node.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'syntax' && (
            <div className="space-y-4">
              <div className="p-3 bg-accent-light border border-accent/20 rounded-md text-xs text-fg leading-relaxed">
                Úsalas en URLs, parámetros, encabezados, cuerpos JSON y consultas para tomar datos de otros nodos.
                En modo Debug, "Referencias resueltas" muestra el valor que tomó cada una.
              </div>
              <div className="space-y-3">
                {SYNTAX_ITEMS.map(item => (
                  <div key={item.code} className="p-3 bg-bg rounded-md border border-border space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-semibold text-accent break-all">{item.code}</span>
                      <span className="text-[11px] bg-surface px-2 py-0.5 rounded border border-border text-muted whitespace-nowrap">{item.tag}</span>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">{item.desc}</p>
                    {item.example && (
                      <div className="bg-surface p-2 rounded border border-border text-[11px] font-mono text-fg break-all">{item.example}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'debug' && <GuideList items={DEBUG_GUIDE} />}

          {activeTab === 'tips' && <GuideList items={TIPS} />}

          {activeTab === 'health' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-bg rounded-md border border-border">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-3 h-3 rounded-full shrink-0",
                    healthStatus.status === 'ok' ? "bg-emerald-500 animate-pulse" : healthStatus.status === 'error' ? "bg-rose-500" : "bg-amber-500"
                  )} />
                  <div>
                    <h4 className="text-xs font-semibold text-fg">
                      Servidor API Backend: {healthStatus.status === 'ok' ? 'Operativo y Conectado' : healthStatus.status === 'error' ? 'Desconectado o Error' : 'Sin Verificar'}
                    </h4>
                    <p className="text-[11px] text-muted font-mono">
                      Endpoint: {API_BASE_URL}/api/health
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={checkHealth}
                  disabled={checkingHealth}
                  className="h-8 text-xs gap-1.5"
                >
                  <RotateCw size={13} className={checkingHealth ? 'animate-spin' : ''} />
                  Verificar estado
                </Button>
              </div>

              {healthStatus.checked && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-bg rounded border border-border">
                    <span className="text-[10px] text-muted uppercase font-semibold block">Latencia</span>
                    <span className="text-sm font-mono font-bold text-fg">
                      {healthStatus.latencyMs !== undefined ? `${healthStatus.latencyMs} ms` : '-'}
                    </span>
                  </div>
                  <div className="p-3 bg-bg rounded border border-border">
                    <span className="text-[10px] text-muted uppercase font-semibold block">Versión de API</span>
                    <span className="text-sm font-mono font-bold text-fg">
                      {healthStatus.version ? (healthStatus.version.startsWith('v') ? healthStatus.version : `v${healthStatus.version}`) : '-'}
                    </span>
                  </div>
                  <div className="p-3 bg-bg rounded border border-border">
                    <span className="text-[10px] text-muted uppercase font-semibold block">Hora Servidor</span>
                    <span className="text-xs font-mono text-muted truncate block">
                      {healthStatus.timestamp ? new Date(healthStatus.timestamp).toLocaleTimeString() : '-'}
                    </span>
                  </div>
                </div>
              )}

              {healthStatus.error && (
                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{healthStatus.error}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between px-6 py-3 border-t border-border bg-surface">
          <span className="text-[11px] text-muted">OrquestaFlow • Sistema de Orquestación y Automatización</span>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => dispatch(closeHelpModal())}
            className="text-xs h-8"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
