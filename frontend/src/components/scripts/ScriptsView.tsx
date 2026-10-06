import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchScripts, type Script } from '../../store/scriptSlice';
import { Play, Upload, Calendar, FileCode2, Package, Search, CheckCircle2, AlertCircle, Square, History } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { ScriptConsoleModal } from './ScriptConsoleModal';
import { EnvBaseBar } from './EnvBaseBar';
import { PythonEnvPanel } from './PythonEnvPanel';
import { UploadScriptDialog } from './UploadScriptDialog';
import { ENV_VIEW } from './envLabels';
import { displayFileName, parseDbDate, relativeTime } from './scriptDisplay';
import { envRequest, type PythonEnvState } from './pythonEnvApi';

type ConsoleTarget = { script: Script; autoRun: boolean; tab: 'code' | 'deps' | 'history' };
type Filter = 'todos' | 'python' | 'node' | 'pendientes';

const isPython = (s: Script) => /\.py$/i.test(s.file_path);
const needsAttention = (s: Script) => !!s.env && ['pendiente', 'no-preparado', 'invalido'].includes(s.env.view);

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-4 py-3 rounded-md border border-border bg-surface">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn('text-xl font-semibold leading-tight mt-0.5', tone)}>{value}</div>
    </div>
  );
}

function ScriptCard({ script, onOpen }: { script: Script; onOpen: (tab: ConsoleTarget['tab'], autoRun?: boolean) => void }) {
  const python = isPython(script);
  const env = script.env;
  const lastRun = parseDbDate(script.last_run_at);
  const status = script.last_run_status;
  const deps = env?.dependencies ?? [];

  return (
    <div className="group rounded-md border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all flex flex-col">
      <button type="button" onClick={() => onOpen('code')} className="p-4 pb-3 text-left flex items-start gap-3 min-w-0">
        <span className={cn('w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0',
          python ? 'bg-accent-light text-accent' : 'bg-warn/20 text-fg')}>
          {python ? 'PY' : 'JS'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold truncate group-hover:text-accent transition-colors">{script.name}</span>
          <span className="block text-[11px] text-muted font-mono truncate" title={script.file_path}>{displayFileName(script.file_path)}</span>
        </span>
        {script.schedule_cron && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-muted bg-bg px-1.5 py-0.5 rounded border border-border shrink-0" title="Programado">
            <Calendar size={10} /> {script.schedule_cron}
          </span>
        )}
      </button>

      {script.description && <p className="px-4 -mt-1 pb-2 text-xs text-muted line-clamp-2">{script.description}</p>}

      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 min-h-[26px]">
        {env ? (
          <button type="button" onClick={() => onOpen('deps')} className="flex flex-wrap items-center gap-1.5 text-left"
            title={env.state?.mode === 'propio' && !env.stale && env.state.reason ? env.state.reason : ENV_VIEW[env.view].hint}>
            <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium', ENV_VIEW[env.view].className)}>{ENV_VIEW[env.view].label}</span>
            {deps.slice(0, 3).map(d => (
              <span key={d} className="px-1.5 py-0.5 rounded border border-border text-[10px] font-mono text-muted max-w-[140px] truncate">{d}</span>
            ))}
            {deps.length > 3 && <span className="text-[10px] text-muted">+{deps.length - 3}</span>}
          </button>
        ) : (
          <span className="px-2 py-0.5 rounded text-[11px] bg-bg border border-border text-muted">Node.js</span>
        )}
      </div>

      <div className="mt-auto px-4 py-2.5 border-t border-border flex items-center gap-2">
        <button type="button" onClick={() => onOpen('history')} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-fg min-w-0" title={lastRun ? lastRun.toLocaleString() : 'Ver historial'}>
          {status === 'completed' && <CheckCircle2 size={12} className="text-success shrink-0" />}
          {status === 'error' && <AlertCircle size={12} className="text-danger shrink-0" />}
          {status === 'cancelled' && <Square size={11} className="shrink-0" />}
          {!status && <History size={12} className="shrink-0" />}
          <span className="truncate">{lastRun ? relativeTime(lastRun) : 'Sin ejecutar'}</span>
        </button>
        <span className="flex-1" />
        <Button variant="icon" size="icon" onClick={() => onOpen('code')} title="Código" className="h-7 w-7"><FileCode2 size={14} /></Button>
        {env && <Button variant="icon" size="icon" onClick={() => onOpen('deps')} title="Dependencias" className="h-7 w-7"><Package size={14} /></Button>}
        <Button variant="default" size="sm" onClick={() => onOpen('code', true)} className="h-7 min-h-0 px-2.5 gap-1.5 text-xs" title="Ejecutar (prepara las dependencias si hace falta)">
          <Play size={12} /> Ejecutar
        </Button>
      </div>
    </div>
  );
}

export function ScriptsView() {
  const dispatch = useAppDispatch();
  const { scripts, activeCount, executedToday, loading } = useAppSelector(state => state.scripts);

  const [filterText, setFilterText] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [consoleFor, setConsoleFor] = useState<ConsoleTarget | null>(null);
  const [envPanel, setEnvPanel] = useState<{ startSetup: boolean } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [envReady, setEnvReady] = useState(false);
  const [envKey, setEnvKey] = useState(0);

  useEffect(() => {
    dispatch(fetchScripts());
  }, [dispatch]);

  useEffect(() => {
    envRequest<PythonEnvState>('/').then(e => setEnvReady(!!(e.uv && e.venv))).catch(() => setEnvReady(false));
  }, [envKey]);

  const refreshAll = useCallback(() => {
    dispatch(fetchScripts());
    setEnvKey(k => k + 1);
  }, [dispatch]);

  const counts = useMemo(() => ({
    todos: scripts.length,
    python: scripts.filter(isPython).length,
    node: scripts.filter(s => !isPython(s)).length,
    pendientes: scripts.filter(needsAttention).length,
  }), [scripts]);

  const visible = scripts.filter(s => {
    const q = filterText.trim().toLowerCase();
    if (q && !`${s.name} ${s.description || ''} ${displayFileName(s.file_path)}`.toLowerCase().includes(q)) return false;
    if (filter === 'python') return isPython(s);
    if (filter === 'node') return !isPython(s);
    if (filter === 'pendientes') return needsAttention(s);
    return true;
  });

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'todos', label: 'Todos' },
    { id: 'python', label: 'Python' },
    { id: 'node', label: 'Node.js' },
    { id: 'pendientes', label: 'Requieren atención' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scripts de procesamiento</h1>
          <p className="text-sm text-muted">Ejecuta scripts Python o Node.js para normalización de datos y ETLs.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
          <Upload size={16} /> Subir script
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 shrink-0">
        <Stat label="Scripts" value={scripts.length} />
        <Stat label="Programaciones activas" value={activeCount} tone="text-accent" />
        <Stat label="Ejecutados hoy" value={executedToday} tone="text-success" />
      </div>

      <EnvBaseBar refreshKey={envKey} onManage={startSetup => setEnvPanel({ startSetup })} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input placeholder="Buscar por nombre o archivo…" value={filterText} onChange={e => setFilterText(e.target.value)} className="pl-8 h-9 min-h-0 text-sm" />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-surface">
          {filters.map(f => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={cn('px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1.5',
                filter === f.id ? 'bg-accent-light text-accent font-medium' : 'text-muted hover:text-fg')}>
              {f.label}
              <span className={cn('text-[10px] tabular-nums', f.id === 'pendientes' && counts.pendientes > 0 && filter !== f.id && 'text-warn font-semibold')}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1 pb-2">
        {loading && scripts.length === 0 ? (
          <div className="p-8 text-center text-muted">Cargando scripts…</div>
        ) : scripts.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-md space-y-3">
            <div className="text-sm font-medium">Sube tu primer script</div>
            <p className="text-xs text-muted">Python o Node.js. Para Python puedes adjuntar su requirements.txt y OrquestaFlow prepara el entorno.</p>
            <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)} className="gap-2"><Upload size={14} /> Subir script</Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-md text-sm text-muted">Ningún script coincide con el filtro.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {visible.map(script => (
              <ScriptCard key={script.id} script={script} onOpen={(tab, autoRun = false) => setConsoleFor({ script, autoRun, tab })} />
            ))}
          </div>
        )}
      </div>

      {consoleFor && (
        <ScriptConsoleModal
          script={consoleFor.script}
          autoRun={consoleFor.autoRun}
          initialTab={consoleFor.tab}
          onClose={() => setConsoleFor(null)}
          onFinished={refreshAll}
          onOpenBaseEnv={() => { setConsoleFor(null); setEnvPanel({ startSetup: true }); }}
        />
      )}

      {envPanel && <PythonEnvPanel startSetup={envPanel.startSetup} onClose={() => setEnvPanel(null)} onChanged={refreshAll} />}

      {uploadOpen && <UploadScriptDialog environmentReady={envReady} onClose={() => setUploadOpen(false)} onUploaded={refreshAll} />}
    </div>
  );
}
