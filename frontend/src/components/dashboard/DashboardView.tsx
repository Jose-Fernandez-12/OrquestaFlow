import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, Calendar, CalendarX, CheckCircle2, Circle, CircleDashed, Clock, Code2, Database, Download,
  FileCode2, GitMerge, Loader2, Lock, Plus, RefreshCw, Square,
} from 'lucide-react';
import { io } from 'socket.io-client';
import cronstrue from 'cronstrue/i18n';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchFlows, stopFlow } from '../../store/flowSlice';
import { fetchScripts, type Script } from '../../store/scriptSlice';
import { showToast } from '../../store/uiSlice';
import { SOCKET_URL, getApiUrl, getFileUrl } from '../../lib/api';
import { parseDbDate, relativeTime } from '../scripts/scriptDisplay';
import { envRequest, type PythonEnvState } from '../scripts/pythonEnvApi';
import { ScriptConsoleModal } from '../scripts/ScriptConsoleModal';
import { PythonEnvPanel } from '../scripts/PythonEnvPanel';
import { FlowExecutionHistoryModal } from '../flow/FlowExecutionHistoryModal';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { ActivityChart } from './ActivityChart';
import { buildAttention, headline, type AttentionItem } from './attention';
import { fetchDashboardSummary, type DashboardRange, type DashboardSummary, type RecentRun, type TargetType, type UpcomingRun } from './dashboardApi';
import { TARGET_LABEL, countDelta, failedBreakdown, formatDuration, formatRate, plural, rateDelta, timeUntil, triggerLabel } from './dashboardFormat';

const RANGES: Array<{ id: DashboardRange; label: string; period: string }> = [
  { id: '24h', label: '24 h', period: 'Últimas 24 horas' },
  { id: '7d', label: '7 días', period: 'Últimos 7 días' },
  { id: '30d', label: '30 días', period: 'Últimos 30 días' },
];
const RANGE_KEY = 'orquesta-dashboard-range';
const REFRESH_MS = 30_000;

type ConsoleTab = 'code' | 'deps' | 'history';

function storedRange(): DashboardRange {
  try {
    const value = localStorage.getItem(RANGE_KEY);
    if (RANGES.some(r => r.id === value)) return value as DashboardRange;
  } catch { /* storage blocked: use the default */ }
  return '7d';
}

/** Loads the summary and keeps it fresh: every 30 s, when the tab comes back, and when a run ends */
function useDashboardSummary(range: DashboardRange, onlyFailed: boolean) {
  const [state, setState] = useState<{ summary: DashboardSummary; loadedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    return fetchDashboardSummary(range, onlyFailed).then(
      summary => {
        // A slower, older request must not overwrite a newer answer
        if (request !== latest.current) return;
        setState({ summary, loadedAt: Date.now() });
        setError(null);
      },
      (err: any) => {
        if (request === latest.current) setError(err?.message || 'Error de red');
      },
    );
  }, [range, onlyFailed]);

  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const run = () => { if (!document.hidden) void refreshRef.current(); };
    const interval = setInterval(run, REFRESH_MS);
    document.addEventListener('visibilitychange', run);
    const socket = io(SOCKET_URL);
    for (const event of ['flow-completed', 'flow-failed', 'flow-stopped', 'script-exit']) socket.on(event, run);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', run);
      socket.disconnect();
    };
  }, []);

  return { summary: state?.summary ?? null, loadedAt: state?.loadedAt ?? mountedAt, error, refresh };
}

async function executeFlowRequest(id: string): Promise<{ status?: string; duration?: number; recordCount?: number }> {
  const res = await fetch(getApiUrl(`/flows/${id}/execute`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'normal' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `Error ${res.status}`);
  return json.data ?? {};
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 min-h-[24px]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const panelClass = 'bg-surface border-border divide-y divide-border overflow-hidden';
const rowClass = 'flex items-center gap-3 px-4 py-2.5 min-w-0';
const rowButtonClass = 'h-7 min-h-0 px-2.5 gap-1.5 text-xs shrink-0';
const emptyClass = 'p-6 text-sm text-muted text-center';

function StatTile({ label, value, sub, valueClass, to, onClick }: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  valueClass?: string;
  to?: string;
  onClick?: () => void;
}) {
  const className = 'block w-full text-left rounded-md border border-border bg-surface shadow-raised p-4 min-w-0';
  const interactive = 'transition-colors hover:border-accent/50';
  const body = (
    <>
      <div className="text-xs font-medium text-muted truncate">{label}</div>
      <div className={cn('text-xl font-semibold mt-1 tabular-nums truncate', valueClass ?? 'text-fg')}>{value}</div>
      <div className="text-xs text-muted mt-1 truncate">{sub}</div>
    </>
  );
  if (to) return <Link to={to} className={cn(className, interactive)}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(className, interactive)}>{body}</button>;
  return <div className={className}>{body}</div>;
}

function StatusChip({ to, icon, children, tone = 'muted' }: { to: string; icon: React.ReactNode; children: React.ReactNode; tone?: 'muted' | 'success' | 'warn' | 'accent' }) {
  const tones = {
    muted: 'bg-bg text-muted border-border',
    success: 'bg-success/10 text-fg border-success/20',
    warn: 'bg-warn/15 text-fg border-warn/30',
    accent: 'bg-accent-light text-accent border-accent/20',
  };
  return (
    <Link to={to} className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-sm border whitespace-nowrap transition-colors hover:border-fg/30', tones[tone])}>
      {icon}
      {children}
    </Link>
  );
}

const ATTENTION_ICON: Record<AttentionItem['kind'], React.ComponentType<{ size?: number; className?: string }>> = {
  failed: AlertCircle,
  missed: CalendarX,
  'invalid-flow': AlertTriangle,
  'python-base': FileCode2,
  'script-env': Code2,
};

function RunStatusIcon({ status }: { status: RecentRun['status'] }) {
  if (status === 'running') return <Loader2 size={15} className="text-accent animate-spin shrink-0" />;
  if (status === 'completed') return <CheckCircle2 size={15} className="text-success shrink-0" />;
  if (status === 'error') return <AlertCircle size={15} className="text-danger shrink-0" />;
  return <Square size={13} className="text-muted shrink-0" />;
}

const RUN_STATUS_TEXT: Record<RecentRun['status'], string> = { running: 'En ejecución', completed: 'Completada', error: 'Falló', cancelled: 'Cancelada' };

function cronText(expression: string): string {
  try {
    return cronstrue.toString(expression, { locale: 'es' });
  } catch {
    return expression;
  }
}

function describeUpcoming(job: UpcomingRun, now: number): string {
  const parts = [timeUntil(job.nextRunAt ? new Date(job.nextRunAt) : null, now), cronText(job.cronExpression)];
  if (job.lastStatus === 'error') parts.push('falló la última vez');
  if (job.lastStatus === null) parts.push('aún sin ejecutar');
  return parts.join(' · ');
}

export function DashboardView() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const flows = useAppSelector(state => state.flows.flows);
  const scripts = useAppSelector(state => state.scripts.scripts);

  const [range, setRange] = useState<DashboardRange>(storedRange);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const { summary, loadedAt, error, refresh } = useDashboardSummary(range, onlyFailed);

  const [pythonReady, setPythonReady] = useState<boolean | null>(null);
  const [busyFlows, setBusyFlows] = useState<Set<string>>(new Set());
  const [historyFlow, setHistoryFlow] = useState<{ id: string; name: string } | null>(null);
  const [consoleFor, setConsoleFor] = useState<{ script: Script; autoRun: boolean; tab: ConsoleTab } | null>(null);
  const [envPanelOpen, setEnvPanelOpen] = useState(false);
  const activityRef = useRef<HTMLDivElement>(null);

  const loadLocalState = useCallback(() => {
    dispatch(fetchFlows());
    dispatch(fetchScripts());
    envRequest<PythonEnvState>('/')
      .then(env => setPythonReady(!!(env.uv && env.venv)))
      .catch(() => setPythonReady(false));
  }, [dispatch]);

  useEffect(() => {
    loadLocalState();
  }, [loadLocalState]);

  const refreshAll = useCallback(() => {
    loadLocalState();
    refresh();
  }, [loadLocalState, refresh]);

  const changeRange = (next: DashboardRange) => {
    setRange(next);
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch { /* storage blocked: the choice lasts for this visit */ }
  };

  const attention = useMemo(
    () => buildAttention({ summary, flows, scripts, pythonReady, now: loadedAt }),
    [summary, flows, scripts, pythonReady, loadedAt],
  );
  const status = headline(attention);

  const recentlyEdited = useMemo(() => [...flows]
    .sort((a, b) => (parseDbDate(b.updated_at)?.getTime() ?? 0) - (parseDbDate(a.updated_at)?.getTime() ?? 0))
    .slice(0, 4), [flows]);

  // ── Actions ──

  const openScript = (scriptId: string | undefined, tab: ConsoleTab, autoRun = false) => {
    const script = scripts.find(s => s.id === scriptId);
    if (script) setConsoleFor({ script, autoRun, tab });
    else navigate('/scripts');
  };

  const runFlow = async (id: string, name: string) => {
    if (busyFlows.has(id)) return;
    setBusyFlows(prev => new Set(prev).add(id));
    // The run shows up under recent activity as soon as the server has logged it
    setTimeout(refresh, 600);
    try {
      const result = await executeFlowRequest(id);
      if (result.status === 'cancelled') {
        dispatch(showToast(`Ejecución de «${name}» detenida.`));
      } else {
        const records = result.recordCount ? ` Registros procesados: ${result.recordCount.toLocaleString('es')}.` : '';
        dispatch(showToast(`Flujo «${name}» ejecutado en ${formatDuration(result.duration)}.${records}`));
      }
    } catch (err: any) {
      dispatch(showToast(`Error al ejecutar «${name}»: ${err?.message || 'fallo desconocido'}`));
    } finally {
      setBusyFlows(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      refreshAll();
    }
  };

  const stopRunningFlow = async (id: string, name: string) => {
    try {
      await dispatch(stopFlow(id)).unwrap();
      dispatch(showToast(`Ejecución de «${name}» detenida.`));
    } catch (err: any) {
      dispatch(showToast(`Error al detener «${name}»: ${err?.message || 'fallo desconocido'}`));
    }
    refresh();
  };

  const runTarget = (type: TargetType | undefined, id: string | undefined, name: string) => {
    if (!id) return;
    if (type === 'flow') runFlow(id, name);
    else if (type === 'script') openScript(id, 'code', true);
  };

  const openDetail = (type: TargetType, id: string, name: string | null) => {
    if (type === 'flow') setHistoryFlow({ id, name: name ?? 'Flujo eliminado' });
    else if (type === 'script') openScript(id, 'history');
    else navigate('/bases');
  };

  const showFailedRuns = () => {
    setOnlyFailed(true);
    activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const runButton = (item: AttentionItem, label: string) => {
    const busy = item.targetType === 'flow' && !!item.targetId && busyFlows.has(item.targetId);
    return (
      <Button variant="default" size="sm" className={rowButtonClass} disabled={busy}
        onClick={() => runTarget(item.targetType, item.targetId, item.targetName ?? '')}>
        {busy && <Loader2 size={12} className="animate-spin" />}
        {busy ? 'Ejecutando…' : label}
      </Button>
    );
  };

  const attentionActions = (item: AttentionItem) => {
    switch (item.kind) {
      case 'failed':
        return (
          <>
            <Button variant="default" size="sm" className={rowButtonClass}
              onClick={() => item.targetType && item.targetId && openDetail(item.targetType, item.targetId, item.targetName ?? null)}>
              Ver error
            </Button>
            {runButton(item, 'Reintentar')}
          </>
        );
      case 'missed':
        return item.targetType === 'query' ? null : runButton(item, 'Ejecutar ahora');
      case 'invalid-flow':
        return <Link to={`/flujos/${item.targetId}`}><Button variant="default" size="sm" className={rowButtonClass}>Abrir flujo</Button></Link>;
      case 'python-base':
        return <Button variant="default" size="sm" className={rowButtonClass} onClick={() => setEnvPanelOpen(true)}>Preparar</Button>;
      case 'script-env':
        return <Button variant="default" size="sm" className={rowButtonClass} onClick={() => openScript(item.targetId, 'deps')}>Ver dependencias</Button>;
    }
  };

  // ── Derived figures ──

  const totals = summary?.totals;
  const previous = summary?.previous;
  const period = RANGES.find(r => r.id === range)!.period;
  const nextJob = summary?.upcoming[0] ?? null;
  const success = totals && previous ? rateDelta(totals, previous) : null;
  const finished = totals ? totals.completed + totals.error : 0;

  const firstSteps = summary ? [
    { done: summary.inventory.connections > 0, label: 'Conecta una base de datos', to: '/bases' },
    { done: summary.inventory.flows > 0, label: 'Crea tu primer flujo', to: '/flujos?nuevo=1' },
    { done: summary.hasFlowRuns, label: 'Ejecuta un flujo de principio a fin', to: '/flujos' },
    { done: summary.inventory.schedules > 0, label: 'Prográmalo para que corra solo', to: '/programacion' },
  ] : [];
  const showFirstSteps = firstSteps.some(step => !step.done);

  const inventory = summary ? [
    { to: '/flujos', text: plural(summary.inventory.flows, 'flujo', 'flujos') },
    { to: '/scripts', text: plural(summary.inventory.scripts, 'script', 'scripts') },
    { to: '/bases', text: plural(summary.inventory.queries, 'consulta', 'consultas') },
    { to: '/bases', text: plural(summary.inventory.connections, 'conexión', 'conexiones') },
    { to: '/programacion', text: plural(summary.inventory.schedules, 'programación', 'programaciones') },
  ] : [];

  const statusIcon = status.tone === 'ok'
    ? <CheckCircle2 size={18} className="text-success shrink-0" />
    : status.tone === 'danger'
      ? <AlertCircle size={18} className="text-danger shrink-0" />
      : <AlertTriangle size={18} className="text-warn shrink-0" />;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-1 flex items-center gap-2">
            {summary
              ? `Actualizado a las ${new Date(loadedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · se actualiza solo`
              : error ? 'Sin datos de actividad' : 'Cargando actividad…'}
            <button type="button" onClick={refreshAll} title="Actualizar ahora" aria-label="Actualizar ahora" className="text-muted hover:text-fg p-1 rounded">
              <RefreshCw size={13} />
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-surface" role="group" aria-label="Periodo">
            {RANGES.map(r => (
              <button key={r.id} type="button" onClick={() => changeRange(r.id)} aria-pressed={range === r.id}
                className={cn('px-2.5 py-1 rounded text-xs transition-colors', range === r.id ? 'bg-accent-light text-accent font-medium' : 'text-muted hover:text-fg')}>
                {r.label}
              </button>
            ))}
          </div>
          <Link to="/flujos?nuevo=1"><Button variant="primary" size="sm" className="gap-2"><Plus size={16} /> Nuevo flujo</Button></Link>
        </div>
      </div>

      <div className="space-y-6">
        {error && (
          <Card className="bg-surface border-danger/30 flex flex-wrap items-center gap-3 px-4 py-3">
            <AlertCircle size={16} className="text-danger shrink-0" />
            <span className="flex-1 min-w-0 text-sm">No se pudo cargar la actividad. Comprueba que el servidor está en marcha. <span className="text-muted">({error})</span></span>
            <Button variant="default" size="sm" className={rowButtonClass} onClick={refreshAll}>Reintentar</Button>
          </Card>
        )}

        {/* ¿Hay algo roto? */}
        <Card className="bg-surface border-border flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
            {statusIcon}
            <span className="text-sm font-semibold">{status.text}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {totals && totals.running > 0 && (
              <StatusChip to="/flujos" tone="accent" icon={<Loader2 size={12} className="animate-spin" />}>{totals.running} en ejecución</StatusChip>
            )}
            {summary && (
              <StatusChip to="/programacion" tone={summary.schedules.active > 0 ? 'success' : 'muted'} icon={<Calendar size={12} />}>
                {summary.schedules.active > 0 ? plural(summary.schedules.active, 'programación activa', 'programaciones activas') : 'Sin programaciones activas'}
              </StatusChip>
            )}
            {summary && (
              <StatusChip to="/bases" tone={summary.connections.active > 0 ? 'success' : 'muted'} icon={<Database size={12} />}>
                {summary.connections.total === 0 ? 'Sin conexiones' : `${summary.connections.active} de ${plural(summary.connections.total, 'conexión activa', 'conexiones activas')}`}
              </StatusChip>
            )}
            <StatusChip to="/scripts" tone={pythonReady === null ? 'muted' : pythonReady ? 'success' : 'warn'} icon={<FileCode2 size={12} />}>
              {pythonReady === null ? 'Comprobando Python…' : pythonReady ? 'Python listo' : 'Python sin preparar'}
            </StatusChip>
          </div>
        </Card>

        {/* ¿Cómo va? */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatTile
            label={`Ejecuciones · ${period.toLowerCase()}`}
            value={totals ? totals.total.toLocaleString('es') : '—'}
            sub={totals && previous ? countDelta(totals.total, previous.total) ?? (totals.total > 0 ? `Media de ${formatDuration(totals.avgDurationMs)} por ejecución` : 'Nada se ha ejecutado en este periodo') : ' '}
          />
          <StatTile
            label="Tasa de éxito"
            value={formatRate(totals?.successRate ?? null)}
            sub={success
              ? <span className={cn(success.better === true && 'text-success', success.better === false && 'text-danger')}>{success.text}</span>
              : finished > 0 ? `${totals!.completed} de ${plural(finished, 'terminada', 'terminadas')}` : 'Sin ejecuciones terminadas'}
          />
          <StatTile
            label="Fallidas"
            value={totals ? totals.error.toLocaleString('es') : '—'}
            valueClass={totals && totals.error > 0 ? 'text-danger' : undefined}
            sub={totals && totals.error > 0 ? failedBreakdown(summary!.failedByTrigger) : 'Ninguna en este periodo'}
            onClick={totals && totals.error > 0 ? showFailedRuns : undefined}
          />
          <StatTile
            label="Próxima ejecución"
            value={nextJob ? timeUntil(nextJob.nextRunAt ? new Date(nextJob.nextRunAt) : null, loadedAt).replace(/^en /, '') : '—'}
            sub={nextJob ? nextJob.scheduleName : 'Nada programado'}
            to="/programacion"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-3 space-y-6 min-w-0">
            {showFirstSteps && (
              <Section title="Primeros pasos">
                <Card className={panelClass}>
                  {firstSteps.map(step => (
                    <Link key={step.label} to={step.to} className={cn(rowClass, 'hover:bg-bg transition-colors')}>
                      {step.done ? <CheckCircle2 size={15} className="text-success shrink-0" /> : <CircleDashed size={15} className="text-muted shrink-0" />}
                      <span className={cn('flex-1 min-w-0 truncate text-sm', step.done ? 'text-muted line-through' : 'font-medium')}>{step.label}</span>
                      {!step.done && <span className="text-xs text-accent shrink-0">Empezar</span>}
                    </Link>
                  ))}
                </Card>
              </Section>
            )}

            <Section title={attention.length > 0 ? `Requiere atención · ${attention.length}` : 'Requiere atención'}>
              <Card className={panelClass}>
                {attention.length === 0 && <div className={emptyClass}>Nada pendiente. Las ejecuciones fallidas y lo que falte por configurar aparecerán aquí.</div>}
                {attention.map(item => {
                  const Icon = ATTENTION_ICON[item.kind];
                  return (
                    <div key={item.key} className={cn(rowClass, 'flex-wrap sm:flex-nowrap')}>
                      <Icon size={16} className={cn('shrink-0', item.severity === 'danger' ? 'text-danger' : 'text-warn')} />
                      <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-medium truncate" title={item.title}>{item.title}</div>
                        <div className="text-xs text-muted line-clamp-2" title={item.detail}>{item.detail}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">{attentionActions(item)}</div>
                    </div>
                  );
                })}
              </Card>
            </Section>

            <div ref={activityRef}>
              <Section
                title="Actividad reciente"
                action={(
                  <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-surface" role="group" aria-label="Filtrar actividad">
                    {[{ failed: false, label: 'Todas' }, { failed: true, label: 'Fallidas' }].map(option => (
                      <button key={option.label} type="button" onClick={() => setOnlyFailed(option.failed)} aria-pressed={onlyFailed === option.failed}
                        className={cn('px-2.5 py-0.5 rounded text-xs transition-colors', onlyFailed === option.failed ? 'bg-accent-light text-accent font-medium' : 'text-muted hover:text-fg')}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              >
                <Card className={panelClass}>
                  {summary && summary.recent.length === 0 && (
                    <div className={emptyClass}>{onlyFailed ? 'Ninguna ejecución ha fallado.' : 'Ejecuta un flujo o un script y aparecerá aquí.'}</div>
                  )}
                  {!summary && !error && <div className={emptyClass}>Cargando…</div>}
                  {summary?.recent.map(run => (
                    <div key={run.id}>
                      <div className={rowClass}>
                        <button type="button" onClick={() => openDetail(run.targetType, run.targetId, run.targetName)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left group" title="Ver el detalle de la ejecución">
                          <RunStatusIcon status={run.status} />
                          <span className="flex-1 min-w-0">
                            <span className={cn('block text-sm font-medium truncate group-hover:text-accent transition-colors', !run.targetName && 'text-muted italic')}>
                              {run.targetName ?? `${TARGET_LABEL[run.targetType]} eliminado`}
                            </span>
                            <span className="block text-xs text-muted truncate" title={run.error ?? undefined}>
                              {[
                                RUN_STATUS_TEXT[run.status],
                                TARGET_LABEL[run.targetType],
                                triggerLabel(run.trigger),
                                run.status !== 'running' && run.durationMs !== null ? formatDuration(run.durationMs) : null,
                                run.status === 'completed' && run.recordCount ? plural(run.recordCount, 'registro', 'registros') : null,
                                run.status !== 'completed' ? run.error : null,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>
                        {run.status === 'running' && run.targetType === 'flow' ? (
                          <Button variant="default" size="sm" className={rowButtonClass} onClick={() => stopRunningFlow(run.targetId, run.targetName ?? 'flujo')}>Detener</Button>
                        ) : (
                          <span className="text-xs text-muted shrink-0">{relativeTime(run.startedAt ? new Date(run.startedAt) : null, loadedAt)}</span>
                        )}
                      </div>
                      {run.files.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-4 pb-2.5 pl-[43px]">
                          {run.files.map(file => (
                            <a key={file.fileName} href={getFileUrl(file.downloadUrl)} download={file.fileName}
                              className="flex items-center gap-1.5 max-w-full text-[11px] px-2 py-0.5 rounded border border-border bg-bg text-muted hover:text-accent hover:border-accent/40 transition-colors"
                              title={`Descargar ${file.fileName}`}>
                              <Download size={11} className="shrink-0" />
                              <span className="truncate font-mono">{file.fileName}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </Card>
              </Section>
            </div>
          </div>

          <div className="xl:col-span-2 space-y-6 min-w-0">
            <Section title={`Ejecuciones · ${period.toLowerCase()}`}>
              <Card className="bg-surface border-border p-4">
                {summary ? <ActivityChart series={summary.series} hourly={range === '24h'} /> : <div className={emptyClass}>{error ? 'Sin datos.' : 'Cargando…'}</div>}
              </Card>
            </Section>

            <Section title="Próximas ejecuciones" action={<Link to="/programacion" className="text-xs text-accent hover:underline">Ver todas</Link>}>
              <Card className={panelClass}>
                {summary && summary.upcoming.length === 0 && (
                  <div className={emptyClass}>Nada programado. Programa un flujo o un script para que corra solo.</div>
                )}
                {summary?.upcoming.map(job => (
                  <Link key={job.scheduleId} to="/programacion" className={cn(rowClass, 'hover:bg-bg transition-colors')}>
                    {job.lastStatus === 'completed' ? <CheckCircle2 size={15} className="text-success shrink-0" />
                      : job.lastStatus === 'error' ? <AlertCircle size={15} className="text-danger shrink-0" />
                      : <Circle size={15} className="text-muted shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{job.scheduleName}</span>
                      <span className="block text-xs text-muted truncate" title={describeUpcoming(job, loadedAt)}>{describeUpcoming(job, loadedAt)}</span>
                    </span>
                    <Clock size={13} className="text-muted shrink-0" />
                  </Link>
                ))}
              </Card>
            </Section>

            <Section title="Seguir editando" action={<Link to="/flujos" className="text-xs text-accent hover:underline">Ver todos</Link>}>
              <Card className={panelClass}>
                {recentlyEdited.length === 0 && <div className={emptyClass}>Todavía no hay flujos.</div>}
                {recentlyEdited.map(flow => (
                  <Link key={flow.id} to={`/flujos/${flow.id}`} className={cn(rowClass, 'hover:bg-bg transition-colors')}>
                    <GitMerge size={14} className="text-muted shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{flow.name}</span>
                    {flow.is_locked === 1 && <Lock size={12} className="text-muted shrink-0" />}
                    <span className="text-xs text-muted shrink-0">{relativeTime(parseDbDate(flow.updated_at), loadedAt)}</span>
                  </Link>
                ))}
              </Card>
            </Section>
          </div>
        </div>

        {inventory.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-xs text-muted pb-2">
            {inventory.map((entry, index) => (
              <React.Fragment key={entry.text}>
                {index > 0 && <span aria-hidden="true">·</span>}
                <Link to={entry.to} className="hover:text-accent hover:underline">{entry.text}</Link>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <FlowExecutionHistoryModal flow={historyFlow} isOpen={!!historyFlow} onClose={() => setHistoryFlow(null)} />

      {consoleFor && (
        <ScriptConsoleModal
          script={consoleFor.script}
          autoRun={consoleFor.autoRun}
          initialTab={consoleFor.tab}
          onClose={() => setConsoleFor(null)}
          onFinished={refreshAll}
          onOpenBaseEnv={() => { setConsoleFor(null); setEnvPanelOpen(true); }}
        />
      )}

      {envPanelOpen && <PythonEnvPanel startSetup onClose={() => setEnvPanelOpen(false)} onChanged={refreshAll} />}
    </div>
  );
}
