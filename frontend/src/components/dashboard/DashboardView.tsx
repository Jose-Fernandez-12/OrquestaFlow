import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Code2, Database, GitMerge, Lock, Plus, Upload, Workflow, Zap,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchFlows, type Flow } from '../../store/flowSlice';
import { fetchScripts } from '../../store/scriptSlice';
import { fetchSchedules } from '../../store/scheduleSlice';
import { fetchConnections } from '../../store/connectionSlice';
import { displayFileName, parseDbDate, relativeTime } from '../scripts/scriptDisplay';
import { needsAttention } from '../scripts/ScriptsView';
import { ENV_VIEW } from '../scripts/envLabels';
import { envRequest, type PythonEnvState } from '../scripts/pythonEnvApi';
import { validateFlow } from '../flow/validation/flowValidation';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

function Kpi({ label, value, icon, iconClass, valueClass }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconClass: string;
  valueClass?: string;
}) {
  return (
    <Card className="p-4 flex items-center gap-4 bg-surface border-border">
      <div className={cn('w-10 h-10 rounded-md flex items-center justify-center shrink-0', iconClass)}>{icon}</div>
      <div>
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className={cn('text-xl font-semibold mt-0.5', valueClass ?? 'text-fg')}>{value}</div>
      </div>
    </Card>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Panel({ count, empty, children }: { count: number; empty: string; children: React.ReactNode }) {
  return (
    <Card className="bg-surface border-border divide-y divide-border overflow-hidden">
      {count === 0 ? <div className="p-6 text-sm text-muted text-center">{empty}</div> : children}
    </Card>
  );
}

const rowClass = 'flex items-center gap-3 px-4 py-2.5 hover:bg-bg transition-colors min-w-0';

interface FlowHealth {
  flow: Flow;
  errors: number;
  warnings: number;
}

/** Checks each flow with the same rules the editor uses, so the dashboard and the canvas agree */
function checkFlow(flow: Flow): FlowHealth {
  let errors = 0;
  let warnings = 0;
  try {
    const def = JSON.parse(flow.definition || '{}');
    const issues = validateFlow(def.nodes ?? [], def.edges ?? []);
    errors = issues.filter(i => i.level === 'error').length;
    warnings = issues.filter(i => i.level === 'warning').length;
  } catch {
    errors = 1;
  }
  return { flow, errors, warnings };
}

export function DashboardView() {
  const dispatch = useAppDispatch();
  const flows = useAppSelector(state => state.flows.flows);
  const { scripts, executedToday } = useAppSelector(state => state.scripts);
  const schedules = useAppSelector(state => state.schedules.schedules);
  const connections = useAppSelector(state => state.connections.connections);
  const [pythonReady, setPythonReady] = useState<boolean | null>(null);

  useEffect(() => {
    dispatch(fetchFlows());
    dispatch(fetchScripts());
    dispatch(fetchSchedules());
    dispatch(fetchConnections());
    envRequest<PythonEnvState>('/')
      .then(e => setPythonReady(!!(e.uv && e.venv)))
      .catch(() => setPythonReady(false));
  }, [dispatch]);

  const flowStats = useMemo(() => ({
    total: flows.length,
    saved: flows.filter(f => f.status === 'saved').length,
    locked: flows.filter(f => f.is_locked === 1).length,
    withRuns: flows.filter(f => f.last_run_at).length,
  }), [flows]);

  const health = useMemo(() => flows.map(checkFlow), [flows]);
  // Flows with errors first, then warnings, then the rest
  const flowsToReview = useMemo(() => health
    .filter(h => h.errors > 0 || h.warnings > 0)
    .sort((a, b) => b.errors - a.errors || b.warnings - a.warnings), [health]);

  const recentlyEdited = useMemo(() => [...flows]
    .sort((a, b) => (parseDbDate(b.updated_at)?.getTime() ?? 0) - (parseDbDate(a.updated_at)?.getTime() ?? 0))
    .slice(0, 6), [flows]);

  const scriptsByAttention = useMemo(() => [...scripts]
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a))), [scripts]);

  // Same source as the list below, so the KPI and the list never disagree
  const activeSchedules = useMemo(() => schedules.filter(s => s.is_active === 1), [schedules]);

  const upcoming = useMemo(() => activeSchedules
    .filter(s => s.next_run_at)
    .sort((a, b) => (parseDbDate(a.next_run_at)?.getTime() ?? 0) - (parseDbDate(b.next_run_at)?.getTime() ?? 0))
    .slice(0, 5), [activeSchedules]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-1">Qué necesita atención hoy en tus flujos, scripts y conexiones.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/flujos"><Button variant="default" size="sm" className="gap-2"><Plus size={14} /> Nuevo flujo</Button></Link>
          <Link to="/scripts"><Button variant="default" size="sm" className="gap-2"><Upload size={14} /> Subir script</Button></Link>
          <Link to="/programacion"><Button variant="default" size="sm" className="gap-2"><Calendar size={14} /> Programar</Button></Link>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Total flujos" value={flowStats.total} icon={<GitMerge size={20} />} iconClass="bg-accent-light text-accent" />
          <Kpi label="Guardados" value={flowStats.saved} icon={<CheckCircle2 size={20} />} iconClass="bg-success/10 text-success" />
          <Kpi label="Protegidos" value={flowStats.locked} icon={<Lock size={20} />} iconClass="bg-slate-500/10 text-slate-700" />
          <Kpi label="Con ejecuciones" value={flowStats.withRuns} icon={<Zap size={20} />} iconClass="bg-accent/10 text-accent" />
        </div>

        <Section title="Flujos por revisar">
          <Panel count={flowsToReview.length} empty="Todos los flujos pasan la validación.">
            {flowsToReview.map(({ flow, errors, warnings }) => (
              <Link key={flow.id} to={`/flujos/${flow.id}`} className={rowClass}>
                {errors > 0 ? <AlertCircle size={14} className="text-danger shrink-0" /> : <AlertTriangle size={14} className="text-warn shrink-0" />}
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{flow.name}</span>
                <span className="text-xs text-muted shrink-0 tabular-nums">
                  {errors > 0 && `${errors} error${errors === 1 ? '' : 'es'}`}
                  {errors > 0 && warnings > 0 && ' · '}
                  {warnings > 0 && `${warnings} aviso${warnings === 1 ? '' : 's'}`}
                </span>
              </Link>
            ))}
          </Panel>
        </Section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <Section title="Editados recientemente">
            <Panel count={recentlyEdited.length} empty="Todavía no hay flujos.">
              {recentlyEdited.map(flow => (
                <Link key={flow.id} to={`/flujos/${flow.id}`} className={rowClass}>
                  <GitMerge size={14} className="text-muted shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{flow.name}</span>
                  {flow.is_locked === 1 && <Lock size={12} className="text-muted shrink-0" />}
                  <span className="text-xs text-muted shrink-0">{relativeTime(parseDbDate(flow.updated_at))}</span>
                </Link>
              ))}
            </Panel>
          </Section>

          <Section title={`Scripts (${scripts.length})`} action={<Link to="/scripts" className="text-xs text-accent hover:underline">Ver todos</Link>}>
            <Panel count={scripts.length} empty="Sube tu primer script.">
              {scriptsByAttention.map(script => {
                const attention = needsAttention(script);
                return (
                  <Link key={script.id} to="/scripts" className={rowClass}>
                    <Code2 size={14} className="text-muted shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{script.name || displayFileName(script.file_path)}</span>
                    {script.env ? (
                      <span className={cn('text-[11px] px-2 py-0.5 rounded shrink-0', attention ? ENV_VIEW[script.env.view].className : 'bg-bg text-muted border border-border')}>
                        {ENV_VIEW[script.env.view].label}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-bg text-muted border border-border shrink-0">Node.js</span>
                    )}
                  </Link>
                );
              })}
            </Panel>
          </Section>

          <Section title="Entorno y conexiones">
            <Card className="bg-surface border-border divide-y divide-border overflow-hidden">
              <Link to="/scripts" className={rowClass}>
                {pythonReady === null ? <Clock size={14} className="text-muted shrink-0" />
                  : pythonReady ? <CheckCircle2 size={14} className="text-success shrink-0" />
                  : <AlertTriangle size={14} className="text-warn shrink-0" />}
                <span className="flex-1 min-w-0 truncate text-sm font-medium">Entorno Python base</span>
                <span className="text-xs text-muted shrink-0">{pythonReady === null ? 'Comprobando…' : pythonReady ? 'Listo' : 'Falta configurar'}</span>
              </Link>
              <Link to="/bases" className={rowClass}>
                <Database size={14} className="text-muted shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm font-medium">Conexiones de bases de datos</span>
                <span className="text-xs text-muted shrink-0 tabular-nums">{connections.filter(c => c.is_active === 1).length} activas de {connections.length}</span>
              </Link>
            </Card>
          </Section>

          <Section title="Ejecución de scripts">
            <div className="grid grid-cols-2 gap-4">
              <Kpi label="Programaciones activas" value={activeSchedules.length} icon={<Calendar size={20} />} iconClass="bg-accent/10 text-accent" valueClass="text-accent" />
              <Kpi label="Ejecutados hoy" value={executedToday} icon={<Workflow size={20} />} iconClass="bg-success/10 text-success" valueClass="text-success" />
            </div>
          </Section>
        </div>

        <Section title="Próximas programaciones" action={<Link to="/programacion" className="text-xs text-accent hover:underline">Ver todas</Link>}>
          <Panel count={upcoming.length} empty="No hay programaciones activas. Programa un flujo o script para verlo aquí.">
            {upcoming.map(job => (
              <Link key={job.id} to="/programacion" className={rowClass}>
                <Clock size={14} className="text-muted shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{job.name}</span>
                <span className="text-xs text-muted shrink-0">{parseDbDate(job.next_run_at)?.toLocaleString()}</span>
              </Link>
            ))}
          </Panel>
        </Section>
      </div>
    </div>
  );
}
