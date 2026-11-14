import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  GitMerge,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  Workflow,
  X,
} from 'lucide-react';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { API_URL, createSocket, readApiResponse } from '../../lib/api';
import { copyToClipboard } from '../../lib/clipboard';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { formatDuration, triggerLabel } from '../dashboard/dashboardFormat';
import { parseDbDate, relativeTime } from '../scripts/scriptDisplay';

type TargetTypeFilter = 'all' | 'flow' | 'script' | 'query';
type StatusFilter = 'all' | 'running' | 'completed' | 'error' | 'cancelled';
type TriggerFilter = 'all' | 'manual' | 'debug' | 'schedule' | 'webhook';

interface TraceSummary {
  total: number;
  completed: number;
  error: number;
  skipped: number;
  continued: number;
  running: number;
  mocked: number;
}

interface ExecutionListItem {
  id: string;
  target_type: 'flow' | 'script' | 'query' | 'node';
  target_id: string;
  target_name: string;
  schedule_id: string | null;
  schedule_name: string | null;
  parent_execution_id: string | null;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  error_message: string | null;
  duration_ms: number | null;
  record_count: number | null;
  trigger_type: string | null;
  started_at: string;
  completed_at: string | null;
  node_count: number;
  trace_summary: TraceSummary;
  has_failed_items: boolean;
  failed_items_count: number;
}

interface ExecutionTraceEntry {
  nodeId: string;
  label?: string;
  type?: string;
  status: 'running' | 'completed' | 'error' | 'skipped' | 'continued' | string;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  runs?: number;
  retries?: number;
  error?: string;
  records?: number;
  mocked?: boolean;
  failed_items?: FailedItemEntry[];
}

interface FailedItemEntry {
  index?: number;
  item?: unknown;
  error?: string;
  nodeId?: string;
  nodeLabel?: string;
}

interface ExecutionChildItem {
  id: string;
  target_type: 'flow' | 'script' | 'query' | 'node';
  target_id: string;
  target_name: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  error_message: string | null;
  duration_ms: number | null;
  record_count: number | null;
  trigger_type: string | null;
  started_at: string;
}

interface ExecutionDetail extends ExecutionListItem {
  result: unknown;
  node_trace: ExecutionTraceEntry[];
  failed_items: FailedItemEntry[];
  children?: ExecutionChildItem[];
}

interface ExecutionSummaryCounts {
  total: number;
  running: number;
  completed: number;
  error: number;
  cancelled: number;
}

const PAGE_LIMIT = 50;

const STATUS_META: Record<
  ExecutionListItem['status'],
  { label: string; badgeClass: string; icon: React.ElementType }
> = {
  running: {
    label: 'En curso',
    badgeClass: 'bg-accent-light text-accent border-accent/25',
    icon: Loader2,
  },
  completed: {
    label: 'Completado',
    badgeClass: 'bg-success/10 text-success border-success/25',
    icon: CheckCircle2,
  },
  error: {
    label: 'Error',
    badgeClass: 'bg-danger/10 text-danger border-danger/25',
    icon: AlertCircle,
  },
  cancelled: {
    label: 'Cancelado',
    badgeClass: 'bg-bg text-muted border-border',
    icon: Square,
  },
};

const TARGET_META: Record<
  ExecutionListItem['target_type'],
  { label: string; chipClass: string; icon: React.ElementType }
> = {
  flow: {
    label: 'Flujo',
    chipClass: 'bg-accent-light text-accent border-accent/20',
    icon: GitMerge,
  },
  script: {
    label: 'Script',
    chipClass: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    icon: Code2,
  },
  query: {
    label: 'Consulta',
    chipClass: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    icon: Database,
  },
  node: {
    label: 'Nodo',
    chipClass: 'bg-bg text-muted border-border',
    icon: Layers,
  },
};

const TRACE_BAR_TONES: Record<string, string> = {
  completed: 'bg-success',
  continued: 'bg-amber-500',
  error: 'bg-danger',
  running: 'bg-accent animate-pulse',
  skipped: 'bg-muted/40',
};

function formatDateTime(raw: string | null | undefined): string {
  const parsed = parseDbDate(raw);
  if (!parsed) return '—';
  return parsed.toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function targetRoute(item: Pick<ExecutionListItem, 'target_type' | 'target_id'>): string | null {
  if (item.target_type === 'flow') return `/flujos/${item.target_id}`;
  if (item.target_type === 'script') return '/scripts';
  if (item.target_type === 'query') return '/bases';
  return null;
}

export function ExecutionsView() {
  const dispatch = useAppDispatch();

  // Filters
  const [targetFilter, setTargetFilter] = useState<TargetTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);

  // List state
  const [items, setItems] = useState<ExecutionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ExecutionSummaryCounts>({
    total: 0,
    running: 0,
    completed: 0,
    error: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // Row actions state
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Detail modal / drawer state (stack allows drilling into child subflow runs)
  const [detailHistory, setDetailHistory] = useState<string[]>([]);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const activeDetailId = detailHistory.length > 0 ? detailHistory[detailHistory.length - 1] : null;
  const activeDetailIdRef = useRef<string | null>(null);

  // Debounce search text
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(PAGE_LIMIT));
      qs.set('offset', String(offset));
      if (targetFilter !== 'all') qs.set('target_type', targetFilter);
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (triggerFilter !== 'all') qs.set('trigger_type', triggerFilter);
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);

      const res = await fetch(`${API_URL}/executions?${qs.toString()}`);
      const payload = await readApiResponse<{
        data: ExecutionListItem[];
        total: number;
        summary: ExecutionSummaryCounts;
      }>(res, 'Error al cargar ejecuciones');

      setItems(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total) || 0);
      if (payload.summary) setSummary(payload.summary);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar ejecuciones');
    } finally {
      setLoading(false);
    }
  }, [offset, targetFilter, statusFilter, triggerFilter, debouncedSearch, fromDate, toDate]);

  const fetchDetail = useCallback(async (executionId: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`${API_URL}/executions/${encodeURIComponent(executionId)}`);
      const payload = await readApiResponse<{ data: ExecutionDetail }>(res, 'Error al cargar detalle');
      setDetail(payload.data);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle de la ejecución');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return fetchList();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (activeDetailId) {
        return fetchDetail(activeDetailId);
      }
      setDetail(null);
      setDetailError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDetailId, fetchDetail]);

  // Live updates via Socket.IO
  const fetchListRef = useRef(fetchList);
  const fetchDetailRef = useRef(fetchDetail);

  useEffect(() => {
    activeDetailIdRef.current = activeDetailId;
    fetchListRef.current = fetchList;
    fetchDetailRef.current = fetchDetail;
  }, [activeDetailId, fetchList, fetchDetail]);

  useEffect(() => {
    const socket = createSocket();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshSoon = (immediate = false) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const run = () => {
        void fetchListRef.current(true);
        if (activeDetailIdRef.current) {
          void fetchDetailRef.current(activeDetailIdRef.current, true);
        }
      };
      if (immediate) {
        run();
      } else {
        debounceTimer = setTimeout(run, 300);
      }
    };

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));

    for (const ev of ['flow-start', 'flow-progress', 'query-progress']) {
      socket.on(ev, () => refreshSoon(false));
    }
    for (const ev of ['flow-completed', 'flow-failed', 'flow-stopped', 'script-exit']) {
      socket.on(ev, () => refreshSoon(true));
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.disconnect();
    };
  }, []);

  const hasActiveFilters =
    targetFilter !== 'all' ||
    statusFilter !== 'all' ||
    triggerFilter !== 'all' ||
    debouncedSearch !== '' ||
    fromDate !== '' ||
    toDate !== '';

  const clearFilters = () => {
    setTargetFilter('all');
    setStatusFilter('all');
    setTriggerFilter('all');
    setSearchInput('');
    setDebouncedSearch('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  };

  const handleCopy = async (label: string, text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(key);
      setTimeout(() => setCopiedId(curr => (curr === key ? null : curr)), 1600);
    } else {
      dispatch(showToast(`No se pudo copiar ${label}`));
    }
  };

  const handleCancel = async (item: ExecutionListItem) => {
    if (cancellingId) return;
    setCancellingId(item.id);
    try {
      const res = await fetch(`${API_URL}/executions/${encodeURIComponent(item.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await readApiResponse(res, 'Error al cancelar ejecución');
      dispatch(showToast(`Ejecución de «${item.target_name}» cancelada`));
      await fetchList(true);
      if (activeDetailId === item.id) await fetchDetail(item.id, true);
    } catch (err: unknown) {
      dispatch(showToast(`Error al cancelar: ${err instanceof Error ? err.message : 'desconocido'}`));
    } finally {
      setCancellingId(null);
    }
  };

  const handleRerun = async (item: ExecutionListItem) => {
    if (rerunningId || item.target_type === 'node') return;
    setRerunningId(item.id);
    try {
      if (item.target_type === 'flow') {
        const res = await fetch(`${API_URL}/flows/${encodeURIComponent(item.target_id)}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'normal' }),
        });
        await readApiResponse(res, 'Error al re-ejecutar flujo');
        dispatch(showToast(`Flujo «${item.target_name}» re-ejecutado`));
      } else if (item.target_type === 'script') {
        const res = await fetch(`${API_URL}/scripts/${encodeURIComponent(item.target_id)}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        await readApiResponse(res, 'Error al re-ejecutar script');
        dispatch(showToast(`Script «${item.target_name}» iniciado nuevamente`));
      } else if (item.target_type === 'query') {
        // Reuse previous connection_ids/params if available on the detail record
        let connIds: string[] = [];
        let params: Record<string, unknown> = {};
        let detailSource = detail?.id === item.id ? detail : null;
        if (!detailSource) {
          const detailRes = await fetch(`${API_URL}/executions/${encodeURIComponent(item.id)}`);
          if (detailRes.ok) {
            const parsed = await detailRes.json().catch(() => null);
            detailSource = parsed?.data ?? null;
          }
        }
        if (detailSource?.result && typeof detailSource.result === 'object') {
          const r = detailSource.result as Record<string, unknown>;
          if (Array.isArray(r.connection_ids)) connIds = r.connection_ids.map(String);
          if (r.params && typeof r.params === 'object' && !Array.isArray(r.params)) {
            params = r.params as Record<string, unknown>;
          }
        }
        const res = await fetch(`${API_URL}/queries/${encodeURIComponent(item.target_id)}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_ids: connIds, params }),
        });
        await readApiResponse(res, 'Error al re-ejecutar consulta');
        dispatch(showToast(`Consulta «${item.target_name}» ejecutada nuevamente`));
      }
      await fetchList(true);
    } catch (err: unknown) {
      dispatch(showToast(`Error al re-ejecutar «${item.target_name}»: ${err instanceof Error ? err.message : 'desconocido'}`));
    } finally {
      setRerunningId(null);
    }
  };

  // Compute waterfall bounds + normalized failed items for active detail
  const waterfallMeta = useMemo(() => {
    const entries = detail?.node_trace ?? [];
    if (entries.length === 0) return { minStart: 0, totalSpan: 1 };
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const e of entries) {
      const s = Number(e.startedAt) || 0;
      const dur = Number(e.durationMs) || 0;
      const f = Number(e.finishedAt) || s + dur;
      if (s > 0 && s < minStart) minStart = s;
      if (f > maxEnd) maxEnd = f;
    }
    if (!Number.isFinite(minStart)) minStart = 0;
    const totalSpan = Math.max(1, maxEnd - minStart);
    return { minStart, totalSpan };
  }, [detail]);

  const pageFrom = total === 0 ? 0 : offset + 1;
  const pageTo = Math.min(total, offset + items.length);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Centro de ejecuciones</h1>
          <p className="text-sm text-muted mt-1">
            Historial unificado en tiempo real, trazabilidad por nodo y control de ejecuciones activas.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-medium',
              socketConnected
                ? 'bg-success/10 text-success border-success/25'
                : 'bg-surface text-muted border-border'
            )}
            title={socketConnected ? 'Recibiendo actualizaciones por Socket.IO' : 'Reconectando actualizaciones en vivo'}
          >
            <span className={cn('w-2 h-2 rounded-full', socketConnected ? 'bg-success animate-pulse' : 'bg-muted')} />
            {socketConnected ? 'En vivo' : 'Sin conexión'}
          </span>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void fetchList()}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* KPI Summary Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5 shrink-0">
        {[
          { key: 'all' as StatusFilter, label: 'Total', value: summary.total, tone: 'text-fg', icon: Activity },
          { key: 'running' as StatusFilter, label: 'En curso', value: summary.running, tone: 'text-accent', icon: Loader2 },
          { key: 'completed' as StatusFilter, label: 'Completadas', value: summary.completed, tone: 'text-success', icon: CheckCircle2 },
          { key: 'error' as StatusFilter, label: 'Con error', value: summary.error, tone: 'text-danger', icon: AlertCircle },
          { key: 'cancelled' as StatusFilter, label: 'Canceladas', value: summary.cancelled, tone: 'text-muted', icon: Square },
        ].map(tile => {
          const selected = statusFilter === tile.key;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => {
                setStatusFilter(tile.key);
                setOffset(0);
              }}
              className={cn(
                'text-left rounded-md border bg-surface p-3.5 transition-all hover:border-accent/50',
                selected ? 'border-accent ring-1 ring-accent/30 shadow-sm' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{tile.label}</span>
                <tile.icon size={14} className={cn(tile.tone, tile.key === 'running' && summary.running > 0 && 'animate-spin')} />
              </div>
              <div className={cn('text-xl font-semibold mt-1 tabular-nums', tile.tone)}>
                {tile.value.toLocaleString('es')}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <Card className="p-3.5 mb-5 bg-surface border-border space-y-3 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Target Type Tabs */}
          <div className="flex items-center gap-1 p-1 bg-bg rounded-sm border border-border overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Todos', icon: Layers },
                { id: 'flow', label: 'Flujos', icon: GitMerge },
                { id: 'script', label: 'Scripts', icon: Code2 },
                { id: 'query', label: 'Consultas', icon: Database },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTargetFilter(tab.id);
                  setOffset(0);
                }}
                className={cn(
                  'px-2.5 py-1 rounded-sm text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap',
                  targetFilter === tab.id
                    ? 'bg-surface text-fg shadow-sm border border-border/50'
                    : 'text-muted hover:text-fg'
                )}
              >
                <tab.icon size={13} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              aria-label="Buscar ejecuciones"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre, ID de ejecución o mensaje de error..."
              className="pl-8 pr-8 h-9 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Status & Trigger & Dates */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar por estado"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as StatusFilter);
                setOffset(0);
              }}
              className="h-9 rounded-sm border border-border bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:border-accent"
            >
              <option value="all">Estado: Todos</option>
              <option value="running">En curso</option>
              <option value="completed">Completado</option>
              <option value="error">Error</option>
              <option value="cancelled">Cancelado</option>
            </select>

            <select
              aria-label="Filtrar por disparador"
              value={triggerFilter}
              onChange={e => {
                setTriggerFilter(e.target.value as TriggerFilter);
                setOffset(0);
              }}
              className="h-9 rounded-sm border border-border bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:border-accent"
            >
              <option value="all">Origen: Todos</option>
              <option value="manual">Manual</option>
              <option value="schedule">Programado</option>
              <option value="webhook">Webhook</option>
              <option value="debug">Depuración</option>
            </select>

            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-muted shrink-0" />
              <Input
                type="date"
                aria-label="Fecha desde"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setOffset(0);
                }}
                className="h-9 text-xs w-[134px]"
              />
              <span className="text-xs text-muted">–</span>
              <Input
                type="date"
                aria-label="Fecha hasta"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setOffset(0);
                }}
                className="h-9 text-xs w-[134px]"
              />
            </div>

            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs text-muted">
                Limpiar
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-danger/25 bg-danger/10 text-danger text-xs flex items-center gap-2" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Results Table */}
      <Card className="flex-1 min-h-0 flex flex-col bg-surface border-border overflow-hidden">
        <div className="flex-1 overflow-auto">
          {loading && items.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-sm">Cargando historial de ejecuciones...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 px-4 text-center flex flex-col items-center gap-2 text-muted">
              <Activity size={26} className="text-muted/60" />
              <p className="text-sm font-medium text-fg">
                {hasActiveFilters ? 'No hay ejecuciones con los filtros seleccionados' : 'Todavía no hay ejecuciones registradas'}
              </p>
              <p className="text-xs max-w-md">
                {hasActiveFilters
                  ? 'Prueba ajustando el tipo, estado, origen o rango de fechas.'
                  : 'Cuando ejecutes un flujo, script o consulta SQL aparecerá aquí en tiempo real.'}
              </p>
              {hasActiveFilters && (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters} className="mt-2 text-xs">
                  Limpiar filtros
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-bg border-b border-border text-[11px] uppercase tracking-wide text-muted z-10">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Objetivo</th>
                  <th className="py-2.5 px-3 font-semibold">Estado</th>
                  <th className="py-2.5 px-3 font-semibold">Origen</th>
                  <th className="py-2.5 px-3 font-semibold">Inicio</th>
                  <th className="py-2.5 px-3 font-semibold">Duración / Datos</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => {
                  const statusCfg = STATUS_META[item.status] ?? STATUS_META.completed;
                  const targetCfg = TARGET_META[item.target_type] ?? TARGET_META.flow;
                  const StatusIcon = statusCfg.icon;
                  const TargetIcon = targetCfg.icon;
                  const started = parseDbDate(item.started_at);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setDetailHistory([item.id])}
                      className="hover:bg-bg/70 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4 max-w-[320px]">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 mt-0.5',
                              targetCfg.chipClass
                            )}
                          >
                            <TargetIcon size={11} />
                            {targetCfg.label}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-fg truncate" title={item.target_name}>
                              {item.target_name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted mt-0.5">
                              <span className="font-mono truncate max-w-[110px]" title={item.id}>
                                #{item.id.slice(0, 8)}
                              </span>
                              {item.schedule_name && (
                                <span className="inline-flex items-center gap-0.5 text-muted truncate max-w-[140px]">
                                  <Clock size={10} /> {item.schedule_name}
                                </span>
                              )}
                              {item.parent_execution_id && (
                                <span className="inline-flex items-center gap-0.5 px-1 rounded bg-bg border border-border text-muted">
                                  <Workflow size={10} /> Subflujo
                                </span>
                              )}
                            </div>
                            {item.error_message && (
                              <div className="text-[11px] text-danger truncate mt-0.5" title={item.error_message}>
                                {item.error_message}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium',
                              statusCfg.badgeClass
                            )}
                          >
                            <StatusIcon size={11} className={cn(item.status === 'running' && 'animate-spin')} />
                            {statusCfg.label}
                          </span>
                          <div className="flex items-center gap-1">
                            {item.has_failed_items && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/25 text-[10px] font-semibold"
                                title="Contiene ítems fallidos en Dead-Letter Queue"
                              >
                                <AlertTriangle size={10} /> DLQ {item.failed_items_count}
                              </span>
                            )}
                            {item.trace_summary?.mocked > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-700 border border-fuchsia-500/25 text-[10px] font-semibold"
                                title="Incluye nodos con salida simulada (Mock)"
                              >
                                <FlaskConical size={10} /> MOCK
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap text-muted">
                        {item.trigger_type ? triggerLabel(item.trigger_type) : 'Manual'}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="text-fg">{started ? relativeTime(started) : '—'}</div>
                        <div className="text-[10px] text-muted">{formatDateTime(item.started_at)}</div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono text-fg tabular-nums">{formatDuration(item.duration_ms)}</div>
                        <div className="text-[10px] text-muted flex items-center gap-2">
                          {item.record_count !== null && <span>{item.record_count.toLocaleString('es')} reg.</span>}
                          {item.node_count > 0 && <span>{item.node_count} nodos</span>}
                        </div>
                      </td>

                      <td
                        className="py-2.5 px-4 whitespace-nowrap text-right"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          {item.status === 'running' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={cancellingId === item.id}
                              onClick={() => void handleCancel(item)}
                              className="h-7 min-h-0 px-2 text-[11px] text-danger border-danger/30 hover:bg-danger/10 gap-1"
                              title="Cancelar ejecución en curso"
                            >
                              {cancellingId === item.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Square size={11} />
                              )}
                              Cancelar
                            </Button>
                          )}

                          {item.target_type !== 'node' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={rerunningId === item.id}
                              onClick={() => void handleRerun(item)}
                              className="h-7 min-h-0 px-2 text-[11px] gap-1"
                              title="Re-ejecutar"
                            >
                              {rerunningId === item.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RotateCw size={11} />
                              )}
                              Re-ejecutar
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => setDetailHistory([item.id])}
                            className="h-7 min-h-0 px-2.5 text-[11px]"
                          >
                            Ver traza
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-bg/50 flex items-center justify-between text-xs text-muted shrink-0">
          <span>
            {total === 0
              ? '0 resultados'
              : `Mostrando ${pageFrom.toLocaleString('es')}–${pageTo.toLocaleString('es')} de ${total.toLocaleString('es')}`}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(prev => Math.max(0, prev - PAGE_LIMIT))}
              className="h-7 min-h-0 px-2 text-xs gap-1"
            >
              <ChevronLeft size={13} /> Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset + PAGE_LIMIT >= total || loading}
              onClick={() => setOffset(prev => prev + PAGE_LIMIT)}
              className="h-7 min-h-0 px-2 text-xs gap-1"
            >
              Siguiente <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </Card>

      {/* Execution Detail Modal / Drawer */}
      {activeDetailId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-end p-0 sm:p-4 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-label="Detalle de ejecución"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setDetailHistory([]);
          }}
        >
          <div className="bg-surface border border-border rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 shrink-0 bg-surface">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {detailHistory.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailHistory(prev => prev.slice(0, -1))}
                      className="h-7 min-h-0 px-2 text-xs gap-1"
                    >
                      <ArrowLeft size={12} /> Volver
                    </Button>
                  )}
                  <h2 className="text-base font-semibold text-fg truncate">
                    {detail?.target_name || 'Detalle de ejecución'}
                  </h2>
                  {detail && (() => {
                    const st = STATUS_META[detail.status] ?? STATUS_META.completed;
                    const Icon = st.icon;
                    return (
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium', st.badgeClass)}>
                        <Icon size={11} className={cn(detail.status === 'running' && 'animate-spin')} />
                        {st.label}
                      </span>
                    );
                  })()}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted mt-1">
                  <button
                    type="button"
                    onClick={() => void handleCopy('ID de ejecución', activeDetailId, `id-${activeDetailId}`)}
                    className="inline-flex items-center gap-1 font-mono hover:text-fg transition-colors"
                    title="Copiar ID completo"
                  >
                    <span>{activeDetailId}</span>
                    {copiedId === `id-${activeDetailId}` ? (
                      <Check size={11} className="text-success" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                  {detail && (
                    <>
                      <span>·</span>
                      <span>Inicio: {formatDateTime(detail.started_at)}</span>
                      <span>·</span>
                      <span>Duración: {formatDuration(detail.duration_ms)}</span>
                      {detail.record_count !== null && (
                        <>
                          <span>·</span>
                          <span>{detail.record_count.toLocaleString('es')} registros</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {detail && targetRoute(detail) && (
                  <Link
                    to={targetRoute(detail)!}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-sm border border-border bg-bg hover:border-accent text-xs font-medium text-fg transition-colors"
                  >
                    <ExternalLink size={12} /> Abrir
                  </Link>
                )}
                {detail?.status === 'running' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cancellingId === detail.id}
                    onClick={() => void handleCancel(detail)}
                    className="h-8 min-h-0 px-2.5 text-xs text-danger border-danger/30 hover:bg-danger/10 gap-1"
                  >
                    {cancellingId === detail.id ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                    Cancelar
                  </Button>
                )}
                {detail && detail.target_type !== 'node' && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={rerunningId === detail.id}
                    onClick={() => void handleRerun(detail)}
                    className="h-8 min-h-0 px-2.5 text-xs gap-1"
                  >
                    {rerunningId === detail.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Re-ejecutar
                  </Button>
                )}
                <Button
                  type="button"
                  variant="icon"
                  size="icon"
                  aria-label="Cerrar detalle"
                  onClick={() => setDetailHistory([])}
                >
                  <X size={18} />
                </Button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {detailLoading && !detail ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted">
                  <Loader2 size={24} className="animate-spin text-accent" />
                  <span className="text-xs">Cargando traza de ejecución...</span>
                </div>
              ) : detailError ? (
                <div className="p-4 rounded-md border border-danger/25 bg-danger/10 text-danger text-xs flex items-center gap-2" role="alert">
                  <AlertCircle size={15} />
                  <span>{detailError}</span>
                </div>
              ) : detail ? (
                <>
                  {/* Parent error banner */}
                  {detail.error_message && (
                    <div className="p-3.5 rounded-md border border-danger/25 bg-danger/10 text-danger text-xs space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertCircle size={14} /> Mensaje de error
                      </div>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{detail.error_message}</pre>
                    </div>
                  )}

                  {/* Trace Waterfall */}
                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Traza por nodo ({detail.node_trace.length})
                      </h3>
                      {detail.trace_summary?.mocked > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-700 border border-fuchsia-500/25 text-[11px] font-semibold">
                          <FlaskConical size={11} /> {detail.trace_summary.mocked} con salida simulada (Mock)
                        </span>
                      )}
                    </div>

                    {detail.node_trace.length === 0 ? (
                      <div className="p-4 rounded-md border border-dashed border-border text-xs text-muted text-center">
                        Esta ejecución no registró pasos individuales de grafo.
                      </div>
                    ) : (
                      <div className="rounded-md border border-border divide-y divide-border overflow-hidden bg-bg/40">
                        {detail.node_trace.map((entry, idx) => {
                          const startOffset =
                            entry.startedAt && waterfallMeta.minStart
                              ? Math.max(0, entry.startedAt - waterfallMeta.minStart)
                              : 0;
                          const span = Math.max(
                            entry.durationMs || 0,
                            entry.finishedAt && entry.startedAt ? entry.finishedAt - entry.startedAt : 0
                          );
                          const leftPct = Math.min(96, (startOffset / waterfallMeta.totalSpan) * 100);
                          const widthPct = Math.max(2, Math.min(100 - leftPct, (span / waterfallMeta.totalSpan) * 100));
                          const barTone = TRACE_BAR_TONES[entry.status] ?? 'bg-accent';

                          return (
                            <div key={`${entry.nodeId}-${idx}`} className="p-3 bg-surface space-y-1.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[10px] font-mono text-muted w-5 shrink-0">
                                    #{idx + 1}
                                  </span>
                                  <span className="text-xs font-semibold text-fg truncate">
                                    {entry.label || entry.nodeId}
                                  </span>
                                  {entry.type && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-muted shrink-0">
                                      {entry.type}
                                    </span>
                                  )}
                                  {entry.mocked && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-700 border border-fuchsia-500/30 text-[10px] font-semibold shrink-0">
                                      <FlaskConical size={10} /> mocked
                                    </span>
                                  )}
                                  {entry.runs && entry.runs > 1 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-light text-accent font-mono shrink-0">
                                      {entry.runs}x
                                    </span>
                                  )}
                                  {entry.retries && entry.retries > 0 ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/15 text-amber-700 font-mono shrink-0">
                                      {entry.retries} reintento(s)
                                    </span>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-2.5 text-[11px] shrink-0">
                                  {entry.records !== undefined && (
                                    <span className="text-muted">{entry.records.toLocaleString('es')} reg.</span>
                                  )}
                                  <span className="font-mono font-medium text-fg tabular-nums">
                                    {formatDuration(entry.durationMs)}
                                  </span>
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-medium border',
                                      entry.status === 'completed' && 'bg-success/10 text-success border-success/25',
                                      entry.status === 'error' && 'bg-danger/10 text-danger border-danger/25',
                                      entry.status === 'continued' && 'bg-amber-500/10 text-amber-700 border-amber-500/25',
                                      entry.status === 'running' && 'bg-accent-light text-accent border-accent/25',
                                      entry.status === 'skipped' && 'bg-bg text-muted border-border'
                                    )}
                                  >
                                    {entry.status}
                                  </span>
                                </div>
                              </div>

                              {/* Waterfall Bar */}
                              <div className="h-2 w-full bg-bg rounded-full overflow-hidden relative border border-border/60">
                                <div
                                  className={cn('h-full rounded-full transition-all', barTone)}
                                  style={{ marginLeft: `${leftPct}%`, width: `${widthPct}%` }}
                                />
                              </div>

                              {entry.error && (
                                <div className="text-[11px] text-danger font-mono bg-danger/5 border border-danger/20 rounded px-2 py-1 break-all">
                                  {entry.error}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Dead-Letter Queue (failed_items) */}
                  {detail.failed_items && detail.failed_items.length > 0 && (
                    <section className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
                          <AlertTriangle size={13} />
                          Dead-Letter Queue — Ítems fallidos ({detail.failed_items.length})
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleCopy(
                              'ítems fallidos',
                              JSON.stringify(detail.failed_items, null, 2),
                              `dlq-${detail.id}`
                            )
                          }
                          className="h-7 min-h-0 px-2 text-[11px] gap-1"
                        >
                          {copiedId === `dlq-${detail.id}` ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                          Copiar todos
                        </Button>
                      </div>

                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 divide-y divide-amber-500/20 max-h-64 overflow-y-auto">
                        {detail.failed_items.map((fi, idx) => (
                          <div key={idx} className="p-3 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-fg">
                                Ítem #{fi.index !== undefined ? fi.index + 1 : idx + 1}
                                {fi.nodeLabel || fi.nodeId ? ` · ${fi.nodeLabel || fi.nodeId}` : ''}
                              </span>
                              <span className="text-[11px] text-danger font-medium">{fi.error || 'Error sin detalle'}</span>
                            </div>
                            {fi.item !== undefined && (
                              <pre className="p-2 rounded bg-surface border border-border font-mono text-[11px] text-muted overflow-x-auto max-h-28">
                                {JSON.stringify(fi.item, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Child executions (subflows) */}
                  {detail.children && detail.children.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Ejecuciones hijas / Subflujos ({detail.children.length})
                      </h3>
                      <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
                        {detail.children.map(child => {
                          const st = STATUS_META[child.status] ?? STATUS_META.completed;
                          return (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => setDetailHistory(prev => [...prev, child.id])}
                              className="w-full px-3.5 py-2.5 bg-surface hover:bg-bg/70 flex items-center justify-between gap-3 text-left transition-colors"
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <Workflow size={14} className="text-accent shrink-0" />
                                <span className="text-xs font-semibold text-fg truncate">{child.target_name}</span>
                                <span className="text-[10px] font-mono text-muted">#{child.id.slice(0, 8)}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-[11px]">
                                <span className="font-mono text-muted">{formatDuration(child.duration_ms)}</span>
                                <span className={cn('px-1.5 py-0.5 rounded border text-[10px] font-medium', st.badgeClass)}>
                                  {st.label}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Raw Result */}
                  {detail.result !== null && detail.result !== undefined && (
                    <details className="rounded-md border border-border bg-bg/50">
                      <summary className="px-3.5 py-2.5 text-xs font-semibold text-fg cursor-pointer select-none flex items-center justify-between">
                        <span>Resultado registrado (JSON)</span>
                      </summary>
                      <div className="p-3 pt-0 space-y-2">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleCopy(
                                'resultado JSON',
                                typeof detail.result === 'string'
                                  ? detail.result
                                  : JSON.stringify(detail.result, null, 2),
                                `res-${detail.id}`
                              )
                            }
                            className="h-7 min-h-0 px-2 text-[11px] gap-1"
                          >
                            {copiedId === `res-${detail.id}` ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                            Copiar JSON
                          </Button>
                        </div>
                        <pre className="p-3 rounded bg-surface border border-border font-mono text-[11px] text-fg overflow-auto max-h-64">
                          {typeof detail.result === 'string' ? detail.result : JSON.stringify(detail.result, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
