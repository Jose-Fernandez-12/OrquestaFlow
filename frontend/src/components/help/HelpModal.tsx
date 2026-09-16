import React, { useState, useEffect } from 'react';
import {
  X,
  HelpCircle,
  BookOpen,
  Code2,
  Activity,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  GitMerge,
  Globe,
  Database,
  FileSpreadsheet,
  Repeat,
  Clock,
  Terminal,
  Server
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { closeHelpModal } from '../../store/uiSlice';
import { API_BASE_URL, getApiUrl } from '../../lib/api';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export function HelpModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.helpModalOpen);

  const [activeTab, setActiveTab] = useState<'nodes' | 'syntax' | 'health' | 'shortcuts'>('nodes');
  const [healthStatus, setHealthStatus] = useState<{
    status: string;
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-accent/10 text-accent">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-fg">Centro de Ayuda y Referencia</h2>
              <p className="text-xs text-muted">Documentación rápida, sintaxis de variables y diagnóstico de estado</p>
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
        <div className="flex border-b border-border bg-bg/50 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('nodes')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'nodes'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <BookOpen size={14} />
            Catálogo de Nodos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('syntax')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'syntax'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <Code2 size={14} />
            Sintaxis y Variables
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('health')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'health'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <Activity size={14} />
            Diagnóstico de Servidor
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'shortcuts'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <Lightbulb size={14} />
            Buenas Prácticas
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'nodes' && (
            <div className="space-y-3">
              <p className="text-xs text-muted mb-3">
                OrquestaFlow permite componer pipelines secuenciales o paralelos mediante grafos dirigidos acíclicos (DAG). Conoce los bloques fundamentales:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-emerald-500/10 text-emerald-600 shrink-0">
                    <GitMerge size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Inicio (Start)</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Punto de entrada de todo flujo. Marca el arranque de ejecución de la orquestación.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-blue-500/10 text-blue-600 shrink-0">
                    <Globe size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Peticiones HTTP (GET / POST)</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Invoca APIs REST externas. Soporta query parameters dinámicos, headers, Bearer tokens y modo iterativo interno.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-amber-500/10 text-amber-600 shrink-0">
                    <Database size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Consultas SQL (Query)</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Ejecuta sentencias SQL Server o SQLite contra conexiones registradas e inyecta parámetros dinámicos con `#param_nombre`.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-purple-500/10 text-purple-600 shrink-0">
                    <FileSpreadsheet size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Exportación (Excel / CSV)</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Transforma registros estructurados en archivos descargables (`.xlsx` con estilos o `.csv`), con soporte multi-hoja.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-rose-500/10 text-rose-600 shrink-0">
                    <Repeat size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Iterador ForEach</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Itera sobre listas de elementos (ej. IDs o filas) ejecutando el sub-grafo conectado por cada elemento.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border flex items-start gap-3">
                  <div className="p-2 rounded bg-indigo-500/10 text-indigo-600 shrink-0">
                    <Clock size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-fg">Temporizador (Delay)</h4>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Pausa la ejecución durante segundos o minutos antes de continuar con el siguiente paso para respetar límites de tasa (rate limits).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'syntax' && (
            <div className="space-y-4">
              <div className="p-3 bg-accent-light border border-accent/20 rounded-md text-xs text-fg leading-relaxed">
                Utiliza estas convenciones en URLs, cuerpos JSON, encabezados o parámetros de consulta para referenciar datos entre nodos.
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-bg rounded-md border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-accent">{`{{ID_NODO.propiedad}}`}</span>
                    <span className="text-[11px] bg-surface px-2 py-0.5 rounded border border-border text-muted">Acceso Directo</span>
                  </div>
                  <p className="text-xs text-muted">
                    Extrae una propiedad específica del resultado emitido por un nodo anterior.
                  </p>
                  <div className="bg-surface p-2 rounded border border-border text-[11px] font-mono text-fg">
                    {`https://api.empresa.com/v1/ordenes/{{http_login.data.token}}`}
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-accent">{`{{_item.campo}}`} o {`{{item.campo}}`}</span>
                    <span className="text-[11px] bg-surface px-2 py-0.5 rounded border border-border text-muted">Iterador ForEach</span>
                  </div>
                  <p className="text-xs text-muted">
                    En nodos dentro de un bucle ForEach o en modo iteración, representa el elemento actual que se está procesando.
                  </p>
                  <div className="bg-surface p-2 rounded border border-border text-[11px] font-mono text-fg">
                    {`{"clienteId": "{{_item.id}}", "monto": {{_item.total}}}`}
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-accent">#param_nombre</span>
                    <span className="text-[11px] bg-surface px-2 py-0.5 rounded border border-border text-muted">Parámetros SQL</span>
                  </div>
                  <p className="text-xs text-muted">
                    Sintaxis nativa para definir parámetros seguros en consultas SQL Server / SQLite sin concatenación vulnerable.
                  </p>
                  <div className="bg-surface p-2 rounded border border-border text-[11px] font-mono text-fg">
                    SELECT * FROM Clientes WHERE Ciudad = #param_ciudad AND Estado = 1
                  </div>
                </div>

                <div className="p-3 bg-bg rounded-md border border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-accent">{`{{_index}}`}</span>
                    <span className="text-[11px] bg-surface px-2 py-0.5 rounded border border-border text-muted">Índice Numérico</span>
                  </div>
                  <p className="text-xs text-muted">
                    Representa la posición numérica actual (iniciando en 0) dentro de una iteración.
                  </p>
                </div>
              </div>
            </div>
          )}

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
                    <span className="text-sm font-mono font-bold text-fg">v1.2.0</span>
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

          {activeTab === 'shortcuts' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-bg rounded-md border border-border space-y-1">
                <h4 className="text-xs font-semibold text-fg">Modo Depuración Paso a Paso</h4>
                <p className="text-xs text-muted leading-relaxed">
                  En el editor de flujos, utiliza el botón "Depurar" para pausar antes y después de cada petición HTTP o nodo pesado. Te permite inspeccionar el payload exacto antes de ser enviado.
                </p>
              </div>

              <div className="p-3.5 bg-bg rounded-md border border-border space-y-1">
                <h4 className="text-xs font-semibold text-fg">Cancelación en Vivo de Consultas</h4>
                <p className="text-xs text-muted leading-relaxed">
                  Al ejecutar consultas en Bases de Datos, si el servidor tarda demasiado puedes presionar "Cancelar" en cualquier momento. Esto emitirá un `request.cancel()` directamente al motor MSSQL, liberando memoria y CPU de inmediato.
                </p>
              </div>

              <div className="p-3.5 bg-bg rounded-md border border-border space-y-1">
                <h4 className="text-xs font-semibold text-fg">Protección contra Sobrecarga</h4>
                <p className="text-xs text-muted leading-relaxed">
                  Ajusta los tiempos de espera en el menú de Configuración para evitar que un servicio externo caído o una base de datos bloqueada congele tu pipeline de trabajo.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-surface">
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
