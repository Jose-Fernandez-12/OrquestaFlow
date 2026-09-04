import React, { useEffect, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchSchedules, createSchedule, updateSchedule } from '../../store/scheduleSlice';
import { fetchFlows } from '../../store/flowSlice';
import { fetchScripts } from '../../store/scriptSlice';
import { Calendar, Plus, Clock, ToggleLeft, ToggleRight, X, Play, Loader2, History, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import cronstrue from 'cronstrue/i18n';

export function ScheduleView() {
  const dispatch = useAppDispatch();
  const { schedules, loading } = useAppSelector(state => state.schedules);
  const { flows } = useAppSelector(state => state.flows);
  const { scripts } = useAppSelector(state => state.scripts);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetType, setTargetType] = useState<'flow' | 'script'>('flow');
  const [targetId, setTargetId] = useState('');
  const [cronExpr, setCronExpr] = useState('0 8 * * 1'); // Monday 8am
  const [scheduleName, setScheduleName] = useState('');

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedScheduleName, setSelectedScheduleName] = useState('');
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const cronDescription = useMemo(() => {
    if (!cronExpr) return '';
    try {
      return cronstrue.toString(cronExpr, { locale: 'es' });
    } catch (e) {
      return 'Expresión Cron inválida';
    }
  }, [cronExpr]);

  // Fetch schedules on mount and set up auto-refresh every 30 seconds
  useEffect(() => {
    dispatch(fetchSchedules());
    dispatch(fetchFlows());
    dispatch(fetchScripts());

    const intervalId = setInterval(() => {
      dispatch(fetchSchedules());
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, [dispatch]);

  // Set default target ID when tab changes or lists load
  useEffect(() => {
    if (targetType === 'flow' && flows.length > 0) {
      setTargetId(flows[0].id);
      setScheduleName(`Programación de ${flows[0].name}`);
    } else if (targetType === 'script' && scripts.length > 0) {
      setTargetId(scripts[0].id);
      setScheduleName(`Programación de ${scripts[0].name}`);
    }
  }, [targetType, flows, scripts]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;

    await dispatch(createSchedule({
      target_type: targetType,
      target_id: targetId,
      name: scheduleName || `Tarea programada`,
      cron_expression: cronExpr
    }));

    setIsModalOpen(false);
    dispatch(fetchSchedules());
  };

  const handleToggleActive = async (id: string, currentStatus: number) => {
    await dispatch(updateSchedule({
      id,
      is_active: currentStatus === 1 ? 0 : 1
    }));
    dispatch(fetchSchedules());
  };

  const openHistory = async (id: string, name: string) => {
    setSelectedScheduleName(name);
    setHistoryModalOpen(true);
    setLoadingHistory(true);
    try {
      const res = await fetch(`http://localhost:3001/api/schedules/${id}/logs`);
      const data = await res.json();
      setHistoryLogs(data.data || []);
    } catch (e) {
      console.error('Failed to load history', e);
      setHistoryLogs([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Programación de tareas</h1>
          <p className="text-sm text-muted">Configura temporizadores cron para ejecutar tus flujos y scripts automáticamente.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)} className="gap-2">
          <Plus size={16} />
          Nueva Programación
        </Button>
      </div>

      {/* Grid of Scheduled Jobs */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && schedules.length === 0 ? (
          <div className="p-8 text-center text-muted">Cargando programaciones...</div>
        ) : schedules.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-md text-muted">
            No hay tareas programadas actualmente. Crea una arriba.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {schedules.map(job => (
              <Card key={job.id} className="p-5 flex flex-col justify-between gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-accent-light rounded-sm text-accent">
                        <Clock size={18} />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted bg-bg px-2 py-0.5 rounded border border-border">
                        {job.target_type === 'flow' ? 'Flujo' : 'Script'}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold mt-3">{job.name}</h2>
                    <div className="text-xs font-mono text-muted mt-1 bg-bg px-2 py-1 rounded border border-border/60 inline-block">
                      Cron: {job.cron_expression}
                    </div>
                  </div>
                  <button 
                    onClick={() => handleToggleActive(job.id, job.is_active)}
                    className="text-muted hover:text-fg transition-colors"
                  >
                    {job.is_active === 1 ? (
                      <ToggleRight size={36} className="text-success" />
                    ) : (
                      <ToggleLeft size={36} />
                    )}
                  </button>
                </div>

                <div className="border-t border-border pt-4 flex items-center justify-between text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted">Próxima ejecución:</span>
                    <span className="font-medium text-fg">
                      {job.next_run_at 
                        ? `En ${formatDistanceToNow(new Date(job.next_run_at), { locale: es })}`
                        : 'Pendiente'}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={job.is_active === 1 ? 'text-success font-medium' : 'text-muted'}>
                      {job.is_active === 1 ? 'Activa' : 'Inactiva'}
                    </span>
                    <button 
                      onClick={() => openHistory(job.id, job.name)}
                      className="flex items-center gap-1 text-accent hover:text-accent-light transition-colors"
                    >
                      <History size={14} />
                      <span>Historial</span>
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-md overflow-hidden relative p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-fast">
            <button 
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-fg"
            >
              <X size={18} />
            </button>

            <div>
              <h2 className="text-lg font-semibold tracking-tight">Nueva programación</h2>
              <p className="text-xs text-muted mt-1">Configura la ejecución automática de flujos o scripts.</p>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Tipo de tarea</label>
                <div className="flex gap-2 p-1 bg-bg rounded-sm border border-border">
                  <button
                    type="button"
                    onClick={() => setTargetType('flow')}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors",
                      targetType === 'flow' ? "bg-surface text-fg shadow-sm border border-border/40" : "text-muted"
                    )}
                  >
                    Flujo de trabajo
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetType('script')}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors",
                      targetType === 'script' ? "bg-surface text-fg shadow-sm border border-border/40" : "text-muted"
                    )}
                  >
                    Script Python/JS
                  </button>
                </div>
              </div>

              {targetType === 'flow' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Seleccionar flujo</label>
                  <select 
                    value={targetId} 
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      const f = flows.find(x => x.id === e.target.value);
                      if (f) setScheduleName(`Programación de ${f.name}`);
                    }}
                    className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-accent"
                  >
                    {flows.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Seleccionar script</label>
                  <select 
                    value={targetId} 
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      const s = scripts.find(x => x.id === e.target.value);
                      if (s) setScheduleName(`Programación de ${s.name}`);
                    }}
                    className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-accent"
                  >
                    {scripts.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Nombre de la programación</label>
                <Input 
                  value={scheduleName}
                  onChange={(e) => setScheduleName(e.target.value)}
                  placeholder="Ej. Ejecución semanal"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Expresión Cron</label>
                <Input 
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="Ej. 0 8 * * 1"
                  className="font-mono text-sm"
                />
                <div className="flex flex-col gap-1 mt-1">
                  <span className={cn(
                    "text-[11px] font-medium transition-colors",
                    cronDescription === 'Expresión Cron inválida' ? "text-red-500" : "text-accent"
                  )}>
                    {cronDescription || 'Escribe una expresión cron'}
                  </span>
                  <span className="text-[10px] text-muted">Minuto Hora Día-Mes Mes Día-Semana</span>
                </div>
                
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button type="button" onClick={() => setCronExpr('*/5 * * * *')} className="text-[10px] px-2 py-1 rounded bg-surface border border-border hover:border-accent hover:text-accent transition-colors">Cada 5 min</button>
                  <button type="button" onClick={() => setCronExpr('0 * * * *')} className="text-[10px] px-2 py-1 rounded bg-surface border border-border hover:border-accent hover:text-accent transition-colors">Cada hora</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * *')} className="text-[10px] px-2 py-1 rounded bg-surface border border-border hover:border-accent hover:text-accent transition-colors">Diario 8am</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * 1')} className="text-[10px] px-2 py-1 rounded bg-surface border border-border hover:border-accent hover:text-accent transition-colors">Lunes 8am</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * 1-5')} className="text-[10px] px-2 py-1 rounded bg-surface border border-border hover:border-accent hover:text-accent transition-colors">Lun-Vie 8am</button>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="default" size="sm" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!targetId}>
                  Crear Tarea
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* History Modal Dialog */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-2xl max-h-[80vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-fast">
            <div className="p-5 border-b border-border flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Historial de Ejecución</h2>
                <p className="text-xs text-muted mt-1">{selectedScheduleName}</p>
              </div>
              <button 
                onClick={() => setHistoryModalOpen(false)}
                className="text-muted hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-10 text-muted">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="text-center py-10 text-muted border border-dashed border-border rounded-md">
                  No hay ejecuciones previas para esta programación.
                </div>
              ) : (
                <div className="space-y-3">
                  {historyLogs.map(log => (
                    <div key={log.id} className="border border-border/60 rounded-md p-3 flex flex-col gap-2 bg-bg text-sm">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {log.status === 'completed' ? (
                            <CheckCircle2 size={16} className="text-success" />
                          ) : log.status === 'error' ? (
                            <AlertCircle size={16} className="text-danger" />
                          ) : (
                            <Loader2 size={16} className="text-accent animate-spin" />
                          )}
                          <span className="font-medium capitalize">{log.status}</span>
                        </div>
                        <span className="text-xs text-muted">
                          {format(new Date(log.started_at), 'dd MMM yyyy, HH:mm:ss')}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-muted mt-1">
                        {log.duration_ms !== null && <span>Duración: {log.duration_ms}ms</span>}
                        {log.record_count !== null && <span>Registros: {log.record_count}</span>}
                      </div>

                      {log.error_message && (
                        <div className="mt-2 p-2 bg-danger/10 border border-danger/20 rounded text-danger text-xs break-all">
                          {log.error_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
