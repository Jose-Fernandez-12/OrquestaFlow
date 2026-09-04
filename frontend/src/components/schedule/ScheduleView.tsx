import React, { useEffect, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchSchedules, createSchedule, updateSchedule, deleteSchedule, type Schedule } from '../../store/scheduleSlice';
import { fetchFlows } from '../../store/flowSlice';
import { fetchScripts } from '../../store/scriptSlice';
import {
  Calendar,
  Plus,
  Clock,
  ToggleLeft,
  ToggleRight,
  X,
  Loader2,
  History,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Pencil,
  Trash2,
  Search,
  GitMerge,
  Code2,
  AlertTriangle,
  PlayCircle,
  Activity,
  Filter
} from 'lucide-react';
import { format } from 'date-fns';
import { io } from 'socket.io-client';
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

  // Modal create/edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'flow' | 'script'>('flow');
  const [targetId, setTargetId] = useState('');
  const [cronExpr, setCronExpr] = useState('0 8 * * 1'); // Monday 8am
  const [scheduleName, setScheduleName] = useState('');

  const cronDescription = useMemo(() => {
    if (!cronExpr) return '';
    try {
      return cronstrue.toString(cronExpr, { locale: 'es' });
    } catch (e) {
      return 'Expresión Cron inválida';
    }
  }, [cronExpr]);

  // Delete modal state
  const [scheduleToDelete, setScheduleToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter & Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'flow' | 'script' | 'active'>('all');

  // History modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedScheduleName, setSelectedScheduleName] = useState('');
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Real-time ticker and notification toast
  const [now, setNow] = useState(Date.now());
  const [exportNotification, setExportNotification] = useState<any[]>([]);

  // Fetch schedules on mount and set up auto-refresh
  useEffect(() => {
    dispatch(fetchSchedules());
    dispatch(fetchFlows());
    dispatch(fetchScripts());

    // Sync from server every 30 seconds
    const fetchInterval = setInterval(() => {
      dispatch(fetchSchedules());
    }, 30000);

    // Tick local timer every 10 seconds for the countdown UI
    const tickInterval = setInterval(() => {
      setNow(Date.now());
    }, 10000);

    const socket = io('http://localhost:3001');

    socket.on('flow-export-ready', (data: any) => {
      const id = Date.now() + Math.random();
      setExportNotification(prev => [...prev, { ...data, id }]);
      
      setTimeout(() => {
        setExportNotification(prev => prev.filter(n => n.id !== id));
      }, 5000);
    });

    return () => {
      clearInterval(fetchInterval);
      clearInterval(tickInterval);
      socket.disconnect();
    };
  }, [dispatch]);

  const getPreciseTimeLeft = (targetDate: string) => {
    const diff = new Date(targetDate).getTime() - now;
    if (diff <= 0) return 'Ejecutando pronto...';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    
    if (days > 0) return `En ${days} d y ${hours} h`;
    if (hours > 0) return `En ${hours} h y ${minutes} m`;
    return `En ${minutes} minutos`;
  };

  const getCronHuman = (expr: string) => {
    if (!expr) return 'Sin cron';
    try {
      return cronstrue.toString(expr, { locale: 'es' });
    } catch (e) {
      return expr;
    }
  };

  // Metrics calculations
  const totalCount = schedules.length;
  const activeCount = schedules.filter(s => s.is_active === 1).length;
  const inactiveCount = schedules.filter(s => s.is_active === 0).length;

  const nextJob = useMemo(() => {
    const activeWithNext = schedules
      .filter(s => s.is_active === 1 && s.next_run_at)
      .map(s => ({ ...s, time: new Date(s.next_run_at!).getTime() }))
      .filter(s => s.time > now)
      .sort((a, b) => a.time - b.time);
    return activeWithNext[0] || null;
  }, [schedules, now]);

  // Filtered schedules list
  const filteredSchedules = useMemo(() => {
    return schedules.filter(job => {
      if (filterType === 'flow' && job.target_type !== 'flow') return false;
      if (filterType === 'script' && job.target_type !== 'script') return false;
      if (filterType === 'active' && job.is_active !== 1) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = job.name.toLowerCase().includes(q);
        const matchCron = job.cron_expression.toLowerCase().includes(q);
        const matchTarget = (job.target_name || '').toLowerCase().includes(q);
        const matchHuman = getCronHuman(job.cron_expression).toLowerCase().includes(q);
        return matchName || matchCron || matchTarget || matchHuman;
      }
      return true;
    });
  }, [schedules, filterType, searchTerm]);

  // Modal openers
  const openCreateModal = () => {
    setModalMode('create');
    setEditingId(null);
    setTargetType('flow');
    if (flows.length > 0) {
      setTargetId(flows[0].id);
      setScheduleName(`Programación de ${flows[0].name}`);
    } else {
      setTargetId('');
      setScheduleName('');
    }
    setCronExpr('0 8 * * 1');
    setIsModalOpen(true);
  };

  const openEditModal = (job: Schedule) => {
    setModalMode('edit');
    setEditingId(job.id);
    setTargetType(job.target_type as 'flow' | 'script');
    setTargetId(job.target_id);
    setScheduleName(job.name);
    setCronExpr(job.cron_expression);
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;

    if (modalMode === 'create') {
      await dispatch(createSchedule({
        target_type: targetType,
        target_id: targetId,
        name: scheduleName || 'Tarea programada',
        cron_expression: cronExpr
      }));
    } else if (modalMode === 'edit' && editingId) {
      await dispatch(updateSchedule({
        id: editingId,
        target_type: targetType,
        target_id: targetId,
        name: scheduleName || 'Tarea programada',
        cron_expression: cronExpr
      }));
    }

    setIsModalOpen(false);
    dispatch(fetchSchedules());
  };

  const handleDeleteConfirm = async () => {
    if (!scheduleToDelete) return;
    setIsDeleting(true);
    try {
      await dispatch(deleteSchedule(scheduleToDelete.id));
      setScheduleToDelete(null);
    } finally {
      setIsDeleting(false);
    }
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
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Programación de tareas</h1>
          <p className="text-sm text-muted mt-1">Configura temporizadores cron para ejecutar tus flujos y scripts de forma automática.</p>
        </div>
        <Button variant="primary" size="sm" onClick={openCreateModal} className="gap-2 shrink-0">
          <Plus size={16} />
          Nueva Programación
        </Button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 shrink-0">
        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-accent-light text-accent flex items-center justify-center shrink-0">
            <Calendar size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Total Tareas</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{totalCount}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-success/10 text-success flex items-center justify-center shrink-0">
            <PlayCircle size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Activas</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{activeCount}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-warn/10 text-warn flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Inactivas</div>
            <div className="text-xl font-semibold text-fg mt-0.5">{inactiveCount}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-4 bg-surface border-border">
          <div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <Activity size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted">Próxima en correr</div>
            <div className="text-sm font-semibold text-fg truncate mt-0.5" title={nextJob?.name || 'Ninguna activa'}>
              {nextJob ? getPreciseTimeLeft(nextJob.next_run_at!) : 'Ninguna activa'}
            </div>
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
            placeholder="Buscar por nombre, flujo o expresión cron..."
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
            variant={filterType === 'all' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setFilterType('all')}
            className="text-xs h-8"
          >
            Todas ({totalCount})
          </Button>
          <Button
            variant={filterType === 'flow' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setFilterType('flow')}
            className="text-xs h-8 gap-1.5"
          >
            <GitMerge size={13} />
            Flujos
          </Button>
          <Button
            variant={filterType === 'script' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setFilterType('script')}
            className="text-xs h-8 gap-1.5"
          >
            <Code2 size={13} />
            Scripts
          </Button>
          <Button
            variant={filterType === 'active' ? 'primary' : 'default'}
            size="sm"
            onClick={() => setFilterType('active')}
            className="text-xs h-8"
          >
            Solo activas ({activeCount})
          </Button>
        </div>
      </div>

      {/* Grid of Scheduled Jobs */}
      <div className="flex-1 min-h-0">
        {loading && schedules.length === 0 ? (
          <div className="py-16 text-center text-muted flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-sm">Cargando programaciones...</span>
          </div>
        ) : schedules.length === 0 ? (
          <div className="py-16 px-4 text-center border border-dashed border-border rounded-md bg-surface flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent-light text-accent flex items-center justify-center">
              <Calendar size={24} />
            </div>
            <div className="max-w-md">
              <h3 className="text-base font-semibold text-fg">No hay tareas programadas</h3>
              <p className="text-xs text-muted mt-1">
                Automatiza la ejecución recurrente de tus flujos o scripts definiendo horarios con expresiones cron.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={openCreateModal} className="mt-2 gap-2">
              <Plus size={15} />
              Crear primera programación
            </Button>
          </div>
        ) : filteredSchedules.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-border rounded-md bg-surface text-muted flex flex-col items-center gap-2">
            <Filter size={20} className="text-muted" />
            <span className="text-sm font-medium">No se encontraron programaciones con los filtros actuales</span>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setSearchTerm(''); setFilterType('all'); }}
              className="text-xs mt-2"
            >
              Limpiar filtros
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredSchedules.map(job => (
              <Card
                key={job.id}
                className={cn(
                  "p-5 flex flex-col justify-between gap-4 bg-surface border transition-all duration-fast hover:shadow-raised relative group",
                  job.is_active === 1 ? "border-border" : "border-border/60 opacity-80"
                )}
              >
                {/* Card Top: Type, Target & Toggle */}
                <div>
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {job.target_type === 'flow' ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent-light px-2 py-0.5 rounded border border-accent/20 shrink-0">
                          <GitMerge size={12} />
                          Flujo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 shrink-0">
                          <Code2 size={12} />
                          Script
                        </span>
                      )}
                      {job.target_name && (
                        <span className="text-xs text-muted truncate font-mono" title={job.target_name}>
                          / {job.target_name}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleToggleActive(job.id, job.is_active)}
                      className="text-muted hover:text-fg transition-colors shrink-0 flex items-center gap-1.5"
                      title={job.is_active === 1 ? "Desactivar programación" : "Activar programación"}
                    >
                      <span className={cn(
                        "text-[11px] font-medium hidden sm:inline",
                        job.is_active === 1 ? "text-success" : "text-muted"
                      )}>
                        {job.is_active === 1 ? 'Activa' : 'Inactiva'}
                      </span>
                      {job.is_active === 1 ? (
                        <ToggleRight size={32} className="text-success" />
                      ) : (
                        <ToggleLeft size={32} className="text-muted" />
                      )}
                    </button>
                  </div>

                  {/* Schedule Name */}
                  <h3 className="text-base font-semibold text-fg tracking-tight mb-2 truncate" title={job.name}>
                    {job.name}
                  </h3>

                  {/* Human readable cron & expression pill */}
                  <div className="p-2.5 rounded-sm bg-bg border border-border/80 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-fg min-w-0">
                        <Clock size={13} className="text-accent shrink-0" />
                        <span className="truncate" title={getCronHuman(job.cron_expression)}>
                          {getCronHuman(job.cron_expression)}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] bg-surface px-1.5 py-0.5 rounded border border-border text-muted shrink-0">
                        {job.cron_expression}
                      </span>
                    </div>

                    {/* Next execution countdown */}
                    <div className="flex items-center justify-between text-[11px] pt-2 border-t border-border/60 text-muted">
                      <span>Próxima ejecución:</span>
                      <span className={cn(
                        "font-medium",
                        job.is_active === 1 ? "text-accent font-semibold" : "text-muted"
                      )}>
                        {job.is_active === 1
                          ? (job.next_run_at ? getPreciseTimeLeft(job.next_run_at) : 'Calculando...')
                          : 'Pausada'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Bottom: Actions Toolbar */}
                <div className="border-t border-border pt-3 flex items-center justify-between text-xs">
                  <button
                    onClick={() => openHistory(job.id, job.name)}
                    className="flex items-center gap-1 text-accent hover:text-accent-hover font-medium transition-colors py-1 px-1.5 rounded hover:bg-accent-light"
                  >
                    <History size={14} />
                    <span>Historial</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(job)}
                      className="flex items-center gap-1 text-muted hover:text-fg py-1 px-2 rounded hover:bg-bg transition-colors"
                      title="Editar programación"
                    >
                      <Pencil size={13} />
                      <span>Editar</span>
                    </button>

                    <button
                      onClick={() => setScheduleToDelete({ id: job.id, name: job.name })}
                      className="flex items-center gap-1 text-muted hover:text-danger py-1 px-2 rounded hover:bg-danger/10 transition-colors"
                      title="Eliminar programación"
                    >
                      <Trash2 size={13} />
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-md overflow-hidden relative p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-fast">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-fg"
            >
              <X size={18} />
            </button>

            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {modalMode === 'create' ? 'Nueva programación' : 'Editar programación'}
              </h2>
              <p className="text-xs text-muted mt-1">
                {modalMode === 'create'
                  ? 'Configura la ejecución automática de flujos o scripts.'
                  : 'Modifica los parámetros y la frecuencia cron de esta tarea.'}
              </p>
            </div>

            <form onSubmit={handleModalSubmit} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Tipo de tarea</label>
                <div className="flex gap-2 p-1 bg-bg rounded-sm border border-border">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('flow');
                      if (flows.length > 0 && modalMode === 'create') {
                        setTargetId(flows[0].id);
                        setScheduleName(`Programación de ${flows[0].name}`);
                      }
                    }}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center justify-center gap-1.5",
                      targetType === 'flow' ? "bg-surface text-fg shadow-sm border border-border/40" : "text-muted"
                    )}
                  >
                    <GitMerge size={13} />
                    Flujo de trabajo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('script');
                      if (scripts.length > 0 && modalMode === 'create') {
                        setTargetId(scripts[0].id);
                        setScheduleName(`Programación de ${scripts[0].name}`);
                      }
                    }}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center justify-center gap-1.5",
                      targetType === 'script' ? "bg-surface text-fg shadow-sm border border-border/40" : "text-muted"
                    )}
                  >
                    <Code2 size={13} />
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
                      if (f && modalMode === 'create') setScheduleName(`Programación de ${f.name}`);
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
                      if (s && modalMode === 'create') setScheduleName(`Programación de ${s.name}`);
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
                    cronDescription === 'Expresión Cron inválida' ? "text-danger" : "text-accent"
                  )}>
                    {cronDescription || 'Escribe una expresión cron'}
                  </span>
                  <span className="text-[10px] text-muted">Minuto Hora Día-Mes Mes Día-Semana</span>
                </div>

                {/* Quick Templates */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button type="button" onClick={() => setCronExpr('*/5 * * * *')} className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors">Cada 5 min</button>
                  <button type="button" onClick={() => setCronExpr('0 * * * *')} className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors">Cada hora</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * *')} className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors">Diario 8am</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * 1')} className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors">Lunes 8am</button>
                  <button type="button" onClick={() => setCronExpr('0 8 * * 1-5')} className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors">Lun-Vie 8am</button>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="default" size="sm" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!targetId}>
                  {modalMode === 'create' ? 'Crear Tarea' : 'Guardar Cambios'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {scheduleToDelete && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-sm p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-fast">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-fg">¿Eliminar programación?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  ¿Estás seguro de que deseas eliminar permanentemente la tarea <strong>«{scheduleToDelete.name}»</strong>? Esta acción cancelará las próximas ejecuciones en segundo plano.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setScheduleToDelete(null)}
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
                Eliminar tarea
              </Button>
            </div>
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

                      {log.result && (
                        <div className="mt-2 p-2 bg-accent-light border border-accent/20 rounded text-fg text-xs">
                          <span className="font-semibold block mb-1 text-accent">Resultado:</span>
                          {(() => {
                            try {
                              const parsed = JSON.parse(log.result);
                              if (parsed.exportedFiles && parsed.exportedFiles.length > 0) {
                                return <span>Archivos exportados: {parsed.exportedFiles.join(', ')}</span>;
                              }
                              return <span>Ejecutado con éxito.</span>;
                            } catch (e) {
                              return <span>{log.result}</span>;
                            }
                          })()}
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

      {/* Export Notifications (Global to the Schedule View) */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
        {exportNotification.map((notif) => (
          <div key={notif.id} className="animate-fade-in bg-surface border border-success/40 rounded-md shadow-raised px-5 py-4 flex items-start gap-4 min-w-[380px] max-w-[520px]">
            <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 size={18} className="text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet size={14} className="text-muted shrink-0" />
                <span className="text-sm font-semibold">{notif.fileName}</span>
                <span className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded-sm font-mono">{notif.format}</span>
              </div>
              <p className="text-xs text-muted mb-2">
                {notif.records?.toLocaleString() || 0} registros exportados exitosamente por una tarea programada
              </p>
              <p className="text-[10px] font-mono text-muted/70 break-all bg-bg px-2 py-1.5 rounded-sm border border-border">
                {notif.filePath || `backend/data/${notif.fileName}`}
              </p>
            </div>
            <button
              onClick={() => setExportNotification(prev => prev.filter(n => n.id !== notif.id))}
              className="text-muted hover:text-fg shrink-0 mt-0.5"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
