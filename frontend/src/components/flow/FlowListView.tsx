import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchFlows, createFlow, deleteFlow, duplicateFlow, saveFlow, executeFlow, stopFlow, setCurrentFlow, type Flow } from '../../store/flowSlice';
import { triggerBrowserDownload } from '../../lib/exportUtils';
import {
  GitMerge,
  Plus,
  Search,
  Filter,
  Play,
  Square,
  Lock,
  Unlock,
  Copy,
  Trash2,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Activity,
  Layers,
  History,
  Download
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { format } from 'date-fns';
import { io } from 'socket.io-client';
import { showToast } from '../../store/uiSlice';
import { FlowExecutionHistoryModal } from './FlowExecutionHistoryModal';

export function FlowListView() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { flows, loading } = useAppSelector(state => state.flows);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'saved' | 'draft' | 'locked'>('all');
  const [executingFlowId, setExecutingFlowId] = useState<string | null>(null);
  const [historyModalFlow, setHistoryModalFlow] = useState<Flow | null>(null);
  const [exportNotifications, setExportNotifications] = useState<Array<{ id: number; fileName: string; downloadUrl: string; records?: number; format?: string }>>([]);
  const downloadedUrlsRef = useRef(new Set<string>());

  const autoDownloadFile = (downloadUrl: string, fileName: string) => {
    if (downloadedUrlsRef.current.has(downloadUrl)) return;
    downloadedUrlsRef.current.add(downloadUrl);
    triggerBrowserDownload(downloadUrl, fileName);
    setTimeout(() => {
      downloadedUrlsRef.current.delete(downloadUrl);
    }, 3000);
  };

  // New flow modal state
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDesc, setNewFlowDesc] = useState('');

  // Delete modal state
  const [flowToDelete, setFlowToDelete] = useState<Flow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    dispatch(fetchFlows());
  }, [dispatch]);

  useEffect(() => {
    const socket = io('http://localhost:3001');
    socket.on('flow-export-ready', (data: { flowId: string; fileName: string; downloadUrl: string; records: number; format: string }) => {
      const id = Date.now() + Math.random();
      setExportNotifications(prev => {
        if (prev.some(n => n.fileName === data.fileName)) return prev;
        return [...prev, { ...data, id }];
      });
      autoDownloadFile(data.downloadUrl, data.fileName);

      setTimeout(() => {
        setExportNotifications(prev => prev.filter(n => n.id !== id));
      }, 10000);
    });
    socket.on('flow-stopped', (data: { flowId: string }) => {
      setExecutingFlowId(prev => (prev === data.flowId ? null : prev));
      dispatch(fetchFlows());
    });
    return () => {
      socket.disconnect();
    };
  }, [dispatch]);

  // Metrics
  const totalFlows = flows.length;
  const savedFlows = flows.filter(f => f.status === 'saved').length;
  const lockedFlows = flows.filter(f => f.is_locked === 1).length;
  const executedRecently = flows.filter(f => f.last_run_at).length;

  // Filtered flows
  const filteredFlows = useMemo(() => {
    return flows.filter(f => {
      if (statusFilter === 'saved' && f.status !== 'saved') return false;
      if (statusFilter === 'draft' && f.status !== 'draft') return false;
      if (statusFilter === 'locked' && f.is_locked !== 1) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = f.name.toLowerCase().includes(q);
        const matchDesc = (f.description || '').toLowerCase().includes(q);
        return matchName || matchDesc;
      }
      return true;
    });
  }, [flows, statusFilter, searchTerm]);

  const handleOpenFlow = (flow: Flow) => {
    dispatch(setCurrentFlow(flow));
    navigate(`/flujos/${flow.id}`);
  };

  const handleCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFlowName.trim()) return;

    const result = await dispatch(createFlow({
      name: newFlowName.trim(),
      description: newFlowDesc.trim(),
      definition: JSON.stringify({ nodes: [], edges: [] }),
      is_locked: 0
    })).unwrap();

    setIsNewModalOpen(false);
    setNewFlowName('');
    setNewFlowDesc('');
    navigate(`/flujos/${result.id}`);
  };

  const handleToggleLock = async (flow: Flow, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLockState = flow.is_locked === 1 ? 0 : 1;
    await dispatch(saveFlow({
      id: flow.id,
      is_locked: newLockState
    }));
    dispatch(fetchFlows());
  };

  const handleDuplicate = async (flow: Flow, e: React.MouseEvent) => {
    e.stopPropagation();
    await dispatch(duplicateFlow(flow));
  };

  const handleDeleteConfirm = async () => {
    if (!flowToDelete) return;
    setIsDeleting(true);
    try {
      await dispatch(deleteFlow(flowToDelete.id));
      setFlowToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExecute = async (flow: Flow, e: React.MouseEvent) => {
    e.stopPropagation();
    setExecutingFlowId(flow.id);
    try {
      const resultAction = await dispatch(executeFlow(flow.id));
      if (executeFlow.fulfilled.match(resultAction)) {
        const payload = resultAction.payload as any;
        const durationSec = payload?.duration ? (payload.duration / 1000).toFixed(2) : null;
        const recordCount = payload?.recordCount || 0;
        const exportedFiles = payload?.exportedFiles || [];

        let msg = `Flujo «${flow.name}» ejecutado con éxito.`;
        if (durationSec) msg += ` Duración: ${durationSec}s.`;
        if (recordCount > 0) msg += ` Registros procesados: ${recordCount.toLocaleString()}.`;

        dispatch(showToast(msg));

        if (exportedFiles.length > 0) {
          exportedFiles.forEach((file: any, index: number) => {
            setTimeout(() => {
              autoDownloadFile(file.downloadUrl, file.fileName);
            }, (index + 1) * 600);

            const id = Date.now() + Math.random() + index;
            setExportNotifications((prev) => {
              if (prev.some((n) => n.fileName === file.fileName)) return prev;
              return [...prev, { ...file, id }];
            });

            setTimeout(() => {
              setExportNotifications((prev) => prev.filter((n) => n.id !== id));
            }, 10000);
          });
        }
      } else {
        const errMsg = resultAction.error?.message || 'Error al ejecutar flujo';
        dispatch(showToast(`Error al ejecutar «${flow.name}»: ${errMsg}`));
      }
      dispatch(fetchFlows());
    } catch (err: any) {
      console.error('Error executing flow', err);
      dispatch(showToast(`Error inesperado al ejecutar «${flow.name}»: ${err.message}`));
    } finally {
      setExecutingFlowId(null);
    }
  };

  const handleStop = async (flow: Flow, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dispatch(stopFlow(flow.id)).unwrap();
      dispatch(showToast(`Ejecución de «${flow.name}» detenida por el usuario.`));
    } catch (err: any) {
      dispatch(showToast(`No se pudo detener el flujo: ${err.message}`));
    } finally {
      setExecutingFlowId(null);
      dispatch(fetchFlows());
    }
  };

  const parseFlowStats = (definition: string) => {
    try {
      const parsed = JSON.parse(definition);
      const nodeCount = parsed.nodes?.length || 0;
      const edgeCount = parsed.edges?.length || 0;
      return { nodeCount, edgeCount };
    } catch {
      return { nodeCount: 0, edgeCount: 0 };
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flujos de trabajo</h1>
          <p className="text-sm text-muted mt-1">Diseña, automatiza y monitorea pipelines visuales de integración de datos.</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setNewFlowName('');
            setNewFlowDesc('');
            setIsNewModalOpen(true);
          }}
          className="gap-2 shrink-0"
        >
          <Plus size={16} />
          Nuevo Flujo
        </Button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 shrink-0">
        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-accent-light text-accent flex items-center justify-center shrink-0">
            <GitMerge size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Total Flujos</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{totalFlows}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-success/10 text-success flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Guardados</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{savedFlows}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-slate-500/10 text-slate-700 flex items-center justify-center shrink-0">
            <Lock size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Protegidos</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{lockedFlows}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <Activity size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Con ejecuciones</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{executedRecently}</div>
          </div>
        </Card>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-6 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar flujo por nombre o descripción..."
            className="w-full pl-9 pr-4 py-1.5 text-sm bg-surface border border-border rounded-sm focus:outline-none focus:border-accent text-fg"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <Button
            variant={statusFilter === 'all' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setStatusFilter('all')}
            className="text-xs h-8"
          >
            Todos ({totalFlows})
          </Button>
          <Button
            variant={statusFilter === 'saved' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setStatusFilter('saved')}
            className="text-xs h-8 gap-1.5"
          >
            <CheckCircle2 size={13} />
            Guardados ({savedFlows})
          </Button>
          <Button
            variant={statusFilter === 'locked' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setStatusFilter('locked')}
            className="text-xs h-8 gap-1.5"
          >
            <Lock size={13} />
            Protegidos ({lockedFlows})
          </Button>
          <Button
            variant={statusFilter === 'draft' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setStatusFilter('draft')}
            className="text-xs h-8"
          >
            Borradores ({totalFlows - savedFlows})
          </Button>
        </div>
      </div>

      {/* Grid of Flows */}
      <div className="flex-1 min-h-0">
        {loading && flows.length === 0 ? (
          <div className="py-16 text-center text-muted flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-sm">Cargando flujos...</span>
          </div>
        ) : flows.length === 0 ? (
          <div className="py-16 px-4 text-center border border-dashed border-border rounded-md bg-surface flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent-light text-accent flex items-center justify-center">
              <GitMerge size={24} />
            </div>
            <div className="max-w-md">
              <h3 className="text-base font-semibold text-fg">No hay flujos de trabajo</h3>
              <p className="text-xs text-muted mt-1">
                Crea tu primer flujo para orquestar consultas SQL, scripts de transformación y exportación automática.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setNewFlowName('Mi primer flujo');
                setNewFlowDesc('');
                setIsNewModalOpen(true);
              }}
              className="mt-2 gap-2"
            >
              <Plus size={15} />
              Crear primer flujo
            </Button>
          </div>
        ) : filteredFlows.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-border rounded-md bg-surface text-muted flex flex-col items-center gap-2">
            <Filter size={20} className="text-muted" />
            <span className="text-sm font-medium">No se encontraron flujos con los filtros actuales</span>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}
              className="text-xs mt-2"
            >
              Limpiar filtros
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredFlows.map(flow => {
              const { nodeCount, edgeCount } = parseFlowStats(flow.definition);
              const isExecuting = executingFlowId === flow.id;
              const isLocked = flow.is_locked === 1;

              return (
                <Card
                  key={flow.id}
                  onClick={() => handleOpenFlow(flow)}
                  className={cn(
                    "p-5 flex flex-col justify-between gap-4 bg-surface border transition-all duration-fast hover:shadow-raised cursor-pointer relative group",
                    isLocked ? "border-slate-300" : "border-border"
                  )}
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="w-9 h-9 rounded-md bg-accent-light text-accent flex items-center justify-center shrink-0">
                        <GitMerge size={18} />
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isExecuting && (
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/30 animate-pulse">
                            <Loader2 size={10} className="animate-spin" />
                            <span>Ejecutando...</span>
                            <button
                              onClick={(e) => handleStop(flow, e)}
                              className="ml-1 text-danger hover:underline font-bold cursor-pointer"
                              title="Detener flujo"
                            >
                              Detener
                            </button>
                          </div>
                        )}
                        {isLocked && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
                            <Lock size={10} />
                            Protegido
                          </span>
                        )}
                        {flow.status === 'draft' ? (
                          <span className="text-[10px] font-medium bg-warn/10 text-warn px-2 py-0.5 rounded border border-warn/20">
                            Borrador
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium bg-success/10 text-success px-2 py-0.5 rounded border border-success/20">
                            Guardado
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="text-base font-semibold text-fg tracking-tight mb-1 truncate group-hover:text-accent transition-colors" title={flow.name}>
                      {flow.name}
                    </h3>
                    <p className="text-xs text-muted line-clamp-2 min-h-[32px]">
                      {flow.description || 'Sin descripción configurada.'}
                    </p>

                    {/* Stats Pill */}
                    <div className="p-2.5 rounded-sm bg-bg border border-border/70 flex items-center justify-between text-xs text-muted mt-3">
                      <div className="flex items-center gap-1.5">
                        <Layers size={13} className="text-accent shrink-0" />
                        <span>{nodeCount} {nodeCount === 1 ? 'nodo' : 'nodos'}</span>
                        <span className="text-muted/40">•</span>
                        <span>{edgeCount} {edgeCount === 1 ? 'conexión' : 'conexiones'}</span>
                      </div>

                      {flow.last_run_at ? (
                        <div className="flex items-center gap-1 text-[11px] text-fg font-medium" title={`Última corrida: ${new Date(flow.last_run_at).toLocaleString()}`}>
                          <Clock size={11} className="text-muted" />
                          <span>{format(new Date(flow.last_run_at), 'dd MMM, HH:mm')}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted">Sin ejecuciones</span>
                      )}
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div className="border-t border-border pt-3 flex items-center justify-between text-xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenFlow(flow);
                      }}
                      className="flex items-center gap-1.5 text-accent hover:text-accent-hover font-semibold transition-colors py-1 px-2 rounded hover:bg-accent-light"
                    >
                      <span>Abrir diseñador</span>
                      <ArrowRight size={13} />
                    </button>

                    <div className="flex items-center gap-1">
                      {/* Lock Toggle */}
                      <button
                        onClick={(e) => handleToggleLock(flow, e)}
                        className={cn(
                          "p-1.5 rounded transition-colors",
                          isLocked
                            ? "text-slate-700 hover:bg-slate-100"
                            : "text-muted hover:text-fg hover:bg-bg"
                        )}
                        title={isLocked ? "Desbloquear edición del flujo" : "Bloquear edición (modo protegido)"}
                      >
                        {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>

                      {/* Execute or Stop */}
                      {isExecuting ? (
                        <button
                          onClick={(e) => handleStop(flow, e)}
                          className="p-1.5 rounded text-danger hover:bg-danger/10 transition-colors animate-pulse"
                          title="Detener ejecución del flujo"
                        >
                          <Square size={13} className="fill-danger" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleExecute(flow, e)}
                          className="p-1.5 rounded text-muted hover:text-success hover:bg-success/10 transition-colors"
                          title="Ejecutar flujo ahora"
                        >
                          <Play size={14} />
                        </button>
                      )}

                      {/* History Logs */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistoryModalFlow(flow);
                        }}
                        className="p-1.5 rounded text-muted hover:text-accent hover:bg-accent-light transition-colors"
                        title="Historial de ejecuciones"
                      >
                        <History size={14} />
                      </button>

                      {/* Duplicate */}
                      <button
                        onClick={(e) => handleDuplicate(flow, e)}
                        className="p-1.5 rounded text-muted hover:text-fg hover:bg-bg transition-colors"
                        title="Duplicar flujo"
                      >
                        <Copy size={14} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFlowToDelete(flow);
                        }}
                        className="p-1.5 rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                        title="Eliminar flujo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* New Flow Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-md p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-fast">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Nuevo flujo de trabajo</h2>
                <p className="text-xs text-muted mt-0.5">Asigna un nombre para empezar a construir en el diseñador.</p>
              </div>
              <button onClick={() => setIsNewModalOpen(false)} className="text-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateFlow} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Nombre del flujo</label>
                <Input
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  placeholder="Ej. Extracción y liquidación mensual"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Descripción (opcional)</label>
                <Input
                  value={newFlowDesc}
                  onChange={(e) => setNewFlowDesc(e.target.value)}
                  placeholder="Ej. Consulta SQL a bases de datos y exportación a Excel"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="default" size="sm" onClick={() => setIsNewModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!newFlowName.trim()}>
                  Crear y abrir diseñador
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {flowToDelete && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-sm p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-fast">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-fg">¿Eliminar flujo?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  ¿Estás seguro de que deseas eliminar permanentemente <strong>«{flowToDelete.name}»</strong>? Esta acción borrará sus nodos, conexiones y cancelará las programaciones vinculadas.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setFlowToDelete(null)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="bg-danger text-white hover:bg-danger/90 gap-1.5"
              >
                {isDeleting && <Loader2 size={13} className="animate-spin" />}
                Eliminar flujo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Execution History Modal */}
      <FlowExecutionHistoryModal
        flow={historyModalFlow}
        isOpen={!!historyModalFlow}
        onClose={() => setHistoryModalFlow(null)}
      />

      {/* Floating Export Alerts - Stacking upwards above global toast with flex-col-reverse and bottom-[115px] */}
      <div className="fixed bottom-[115px] right-4 z-40 flex flex-col-reverse gap-2.5 pointer-events-none max-w-sm w-full">
        {exportNotifications.map(notification => (
          <div key={notification.id} className="bg-surface border border-border rounded-md shadow-raised p-3.5 flex items-center gap-3 animate-in slide-in-from-bottom-3 pointer-events-auto">
            <div className="w-8 h-8 rounded bg-accent-light text-accent flex items-center justify-center shrink-0">
              <Download size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-fg truncate">Archivo generado</div>
              <div className="text-xs text-muted truncate">{notification.fileName}</div>
            </div>
            <a
              href={`http://localhost:3001${notification.downloadUrl}`}
              download={notification.fileName}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded transition-colors shrink-0 inline-flex items-center gap-1"
            >
              <span>Descargar</span>
            </a>
            <button
              onClick={() => setExportNotifications(prev => prev.filter(n => n.id !== notification.id))}
              className="text-muted hover:text-fg p-1 rounded"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
