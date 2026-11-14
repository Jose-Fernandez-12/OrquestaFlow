import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';

interface TraceEntryLike {
  status?: string;
  mocked?: boolean;
  failedItems?: unknown[];
  failed_items?: unknown[];
  [key: string]: unknown;
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeDateBound(raw: string | undefined, isEnd: boolean): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isEnd ? `${trimmed} 23:59:59` : `${trimmed} 00:00:00`;
  }
  return trimmed.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

function extractFailedItems(parsedResult: any, trace: TraceEntryLike[]): unknown[] {
  const fromTrace: unknown[] = [];
  for (const entry of trace) {
    const items = Array.isArray(entry?.failedItems)
      ? entry.failedItems
      : Array.isArray(entry?.failed_items)
        ? entry.failed_items
        : null;
    if (items && items.length > 0) {
      for (const item of items) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          fromTrace.push({ nodeId: entry.nodeId, nodeLabel: entry.label, ...(item as Record<string, unknown>) });
        } else {
          fromTrace.push(item);
        }
      }
    }
  }
  if (fromTrace.length > 0) return fromTrace;
  const resultItems = parsedResult?.failed_items ?? parsedResult?.failedItems;
  if (Array.isArray(resultItems)) {
    return [...resultItems];
  }
  return [];
}

function summarizeTrace(trace: TraceEntryLike[]) {
  const summary = {
    total: trace.length,
    completed: 0,
    error: 0,
    skipped: 0,
    continued: 0,
    running: 0,
    mocked: 0,
  };
  for (const entry of trace) {
    if (entry?.mocked) summary.mocked++;
    switch (entry?.status) {
      case 'completed':
        summary.completed++;
        break;
      case 'error':
        summary.error++;
        break;
      case 'skipped':
        summary.skipped++;
        break;
      case 'continued':
        summary.continued++;
        break;
      case 'running':
        summary.running++;
        break;
    }
  }
  return summary;
}

const TARGET_NAME_SQL = `
  CASE e.target_type
    WHEN 'flow' THEN COALESCE(f.name, e.target_id)
    WHEN 'script' THEN COALESCE(s.name, e.target_id)
    WHEN 'query' THEN COALESCE(q.name, e.target_id)
    ELSE e.target_id
  END
`;

const BASE_FROM_SQL = `
  FROM execution_logs e
  LEFT JOIN flows f ON e.target_type = 'flow' AND e.target_id = f.id
  LEFT JOIN scripts s ON e.target_type = 'script' AND e.target_id = s.id
  LEFT JOIN queries q ON e.target_type = 'query' AND e.target_id = q.id
  LEFT JOIN schedules sch ON e.schedule_id = sch.id
`;

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // List execution logs with filters and summary counts
  app.get<{
    Querystring: {
      target_type?: string;
      status?: string;
      trigger_type?: string;
      search?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', async (request) => {
    const db = getDb();
    const q = request.query || {};

    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);

    const allowedTargetTypes = ['flow', 'script', 'query', 'node'];
    const allowedStatuses = ['running', 'completed', 'error', 'cancelled'];
    const allowedTriggers = ['manual', 'debug', 'schedule', 'webhook'];

    const baseConditions: string[] = [];
    const baseParams: unknown[] = [];

    if (q.target_type && allowedTargetTypes.includes(q.target_type)) {
      baseConditions.push('e.target_type = ?');
      baseParams.push(q.target_type);
    }
    if (q.trigger_type && allowedTriggers.includes(q.trigger_type)) {
      baseConditions.push('e.trigger_type = ?');
      baseParams.push(q.trigger_type);
    }
    const fromBound = normalizeDateBound(q.from, false);
    if (fromBound) {
      baseConditions.push('e.started_at >= ?');
      baseParams.push(fromBound);
    }
    const toBound = normalizeDateBound(q.to, true);
    if (toBound) {
      baseConditions.push('e.started_at <= ?');
      baseParams.push(toBound);
    }
    if (q.search && q.search.trim()) {
      const pattern = `%${q.search.trim().toLowerCase()}%`;
      baseConditions.push(`(
        LOWER(${TARGET_NAME_SQL}) LIKE ?
        OR LOWER(e.target_id) LIKE ?
        OR LOWER(e.id) LIKE ?
        OR LOWER(COALESCE(e.error_message, '')) LIKE ?
      )`);
      baseParams.push(pattern, pattern, pattern, pattern);
    }

    const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';

    const statusFilter = q.status && allowedStatuses.includes(q.status) ? q.status : null;
    const fullConditions = statusFilter ? [...baseConditions, 'e.status = ?'] : baseConditions;
    const fullParams = statusFilter ? [...baseParams, statusFilter] : baseParams;
    const fullWhere = fullConditions.length > 0 ? `WHERE ${fullConditions.join(' AND ')}` : '';

    const summaryRows = db.prepare(`
      SELECT e.status, COUNT(*) AS count
      ${BASE_FROM_SQL}
      ${baseWhere}
      GROUP BY e.status
    `).all(...baseParams) as Array<{ status: string; count: number }>;

    const summary = { total: 0, running: 0, completed: 0, error: 0, cancelled: 0 };
    for (const row of summaryRows) {
      const count = Number(row.count) || 0;
      summary.total += count;
      if (row.status === 'running') summary.running = count;
      else if (row.status === 'completed') summary.completed = count;
      else if (row.status === 'error') summary.error = count;
      else if (row.status === 'cancelled') summary.cancelled = count;
    }

    const filteredTotal = statusFilter
      ? (db.prepare(`SELECT COUNT(*) AS count ${BASE_FROM_SQL} ${fullWhere}`).get(...fullParams) as { count: number })?.count ?? 0
      : summary.total;

    const rows = db.prepare(`
      SELECT
        e.id,
        e.target_type,
        e.target_id,
        e.schedule_id,
        e.parent_execution_id,
        e.status,
        e.error_message,
        e.duration_ms,
        e.record_count,
        e.trigger_type,
        e.started_at,
        e.completed_at,
        e.node_trace,
        e.result,
        ${TARGET_NAME_SQL} AS target_name,
        sch.name AS schedule_name
      ${BASE_FROM_SQL}
      ${fullWhere}
      ORDER BY e.started_at DESC, e.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...fullParams, limit, offset) as Array<Record<string, any>>;

    const data = rows.map(row => {
      const trace = safeJsonParse<TraceEntryLike[]>(row.node_trace, []);
      const resultText = row.result ? String(row.result) : '';
      const parsedResult = resultText && (resultText.includes('failed_items') || resultText.includes('failedItems'))
        ? safeJsonParse<any>(row.result, null)
        : null;
      const failedItems = extractFailedItems(parsedResult, trace);
      const traceSummary = summarizeTrace(trace);
      return {
        id: row.id,
        target_type: row.target_type,
        target_id: row.target_id,
        target_name: row.target_name,
        schedule_id: row.schedule_id,
        schedule_name: row.schedule_name ?? null,
        parent_execution_id: row.parent_execution_id ?? null,
        status: row.status,
        error_message: row.error_message,
        duration_ms: row.duration_ms,
        record_count: row.record_count,
        trigger_type: row.trigger_type,
        started_at: row.started_at,
        completed_at: row.completed_at,
        node_count: traceSummary.total,
        trace_summary: traceSummary,
        has_failed_items: failedItems.length > 0,
        failed_items_count: failedItems.length,
      };
    });

    return {
      data,
      total: filteredTotal,
      limit,
      offset,
      summary,
    };
  });

  // Get single execution detail including parsed result, trace, failed_items and child runs
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        e.*,
        ${TARGET_NAME_SQL} AS target_name,
        sch.name AS schedule_name
      ${BASE_FROM_SQL}
      WHERE e.id = ?
    `).get(request.params.id) as Record<string, any> | undefined;

    if (!row) {
      return reply.status(404).send({ error: 'Ejecución no encontrada' });
    }

    const parsedResult = typeof row.result === 'string' ? safeJsonParse<any>(row.result, row.result) : (row.result ?? null);
    const rawTrace = Array.isArray(row.node_trace)
      ? row.node_trace
      : safeJsonParse<TraceEntryLike[]>(row.node_trace, []);
    const parsedTrace = rawTrace.map(entry => {
      if (entry && entry.failedItems && !entry.failed_items) {
        return { ...entry, failed_items: entry.failedItems };
      }
      return entry;
    });
    const failedItems = extractFailedItems(parsedResult, parsedTrace);

    const children = db.prepare(`
      SELECT
        e.id,
        e.target_type,
        e.target_id,
        e.schedule_id,
        e.parent_execution_id,
        e.status,
        e.error_message,
        e.duration_ms,
        e.record_count,
        e.trigger_type,
        e.started_at,
        e.completed_at,
        ${TARGET_NAME_SQL} AS target_name
      ${BASE_FROM_SQL}
      WHERE e.parent_execution_id = ?
      ORDER BY e.started_at ASC, e.rowid ASC
    `).all(request.params.id);

    return {
      data: {
        ...row,
        result: parsedResult,
        node_trace: parsedTrace,
        trace_summary: summarizeTrace(parsedTrace),
        failed_items: failedItems,
        has_failed_items: failedItems.length > 0,
        children,
      },
    };
  });

  // Cancel a running execution
  app.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(request.params.id) as Record<string, any> | undefined;
    if (!row) {
      return reply.status(404).send({ error: 'Ejecución no encontrada' });
    }
    if (row.status !== 'running') {
      return reply.status(409).send({ error: 'La ejecución no está en curso' });
    }

    let engineCancelled = false;
    if (row.target_type === 'flow') {
      const { cancelFlowExecution } = await import('../engine/executor.js');
      engineCancelled = cancelFlowExecution(row.target_id);
      if (engineCancelled) {
        try {
          const { getIo } = await import('../engine/socket.js');
          getIo().emit('flow-stopped', { flowId: row.target_id });
        } catch {
          // Socket.IO may not be initialized in tests
        }
      }
    } else if (row.target_type === 'script') {
      const { getLatestScriptRun, stopScriptRun } = await import('../engine/scriptRunner.js');
      const run = getLatestScriptRun(row.target_id);
      if (run && run.status === 'running' && (!run.logId || run.logId === row.id)) {
        engineCancelled = stopScriptRun(run.runId);
      }
    } else if (row.target_type === 'query') {
      const { cancelMssqlQuery } = await import('../engine/mssql.js');
      engineCancelled = cancelMssqlQuery(row.id);
    }

    db.prepare(`
      UPDATE execution_logs
      SET status = 'cancelled',
          completed_at = COALESCE(completed_at, datetime('now')),
          error_message = COALESCE(error_message, 'Ejecución detenida por el usuario')
      WHERE id = ? AND status = 'running'
    `).run(row.id);

    return {
      data: {
        id: row.id,
        cancelled: true,
        engineCancelled,
        status: 'cancelled',
      },
    };
  });
}
