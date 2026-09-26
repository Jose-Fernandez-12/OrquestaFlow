import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';

export type ExecutionTrigger = 'manual' | 'debug' | 'schedule' | 'webhook';
export type ExecutionStatus = 'running' | 'completed' | 'error' | 'cancelled';
export type NodeTraceStatus = 'running' | 'completed' | 'error' | 'skipped' | 'continued';

export interface NodeTraceEntry {
  nodeId: string;
  label: string;
  type: string;
  status: NodeTraceStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  runs: number;        // >1 for nodes inside a loop
  retries: number;
  error?: string;
  records?: number;
}

const MAX_ERROR_LENGTH = 500;

function countRecords(result: any): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    if (typeof result.records === 'number') return result.records;
    for (const key of ['rows', 'data', 'items']) {
      if (Array.isArray(result[key])) return result[key].length;
    }
  }
  return undefined;
}

/**
 * Builds a per-node timeline from the engine's progress events.
 * Nodes inside a loop run many times: their durations are added up and `runs` counts the iterations.
 */
export class ExecutionTracer {
  private entries = new Map<string, NodeTraceEntry>();
  private activeSince = new Map<string, number>();
  private meta = new Map<string, { label: string; type: string }>();

  constructor(nodes: any[] = [], private now: () => number = Date.now) {
    this.registerNodes(nodes);
  }

  registerNodes(nodes: any[]): void {
    for (const n of nodes) {
      this.meta.set(n.id, { label: String(n.data?.label || n.id), type: String(n.type || '') });
    }
  }

  private entry(nodeId: string): NodeTraceEntry {
    let e = this.entries.get(nodeId);
    if (!e) {
      const meta = this.meta.get(nodeId) || { label: nodeId, type: '' };
      e = { nodeId, ...meta, status: 'running', startedAt: this.now(), durationMs: 0, runs: 0, retries: 0 };
      this.entries.set(nodeId, e);
    }
    return e;
  }

  private stop(nodeId: string, e: NodeTraceEntry) {
    const since = this.activeSince.get(nodeId);
    if (since !== undefined) {
      e.durationMs += this.now() - since;
      this.activeSince.delete(nodeId);
    }
    e.finishedAt = this.now();
  }

  record(nodeId: string, status: string, result?: any): void {
    // Debug pauses don't count as execution time; the node emits 'running' again when resumed
    if (status === 'paused') {
      const since = this.activeSince.get(nodeId);
      const e = this.entries.get(nodeId);
      if (since !== undefined && e) {
        e.durationMs += this.now() - since;
        this.activeSince.delete(nodeId);
      }
      return;
    }

    if (status === 'running') {
      const e = this.entry(nodeId);
      e.status = 'running';
      if (!this.activeSince.has(nodeId)) this.activeSince.set(nodeId, this.now());
      return;
    }

    if (status === 'progress') {
      if (result?.retry) this.entry(nodeId).retries++;
      return;
    }

    if (status === 'completed') {
      if (result?.skipped) {
        const e = this.entry(nodeId);
        if (e.runs === 0) e.status = 'skipped';
        e.finishedAt = this.now();
        return;
      }
      const e = this.entry(nodeId);
      this.stop(nodeId, e);
      e.runs++;
      if (e.status !== 'error' && e.status !== 'continued') e.status = 'completed';
      const records = countRecords(result);
      if (records !== undefined) e.records = records;
      return;
    }

    if (status === 'error') {
      const e = this.entry(nodeId);
      this.stop(nodeId, e);
      e.runs++;
      e.status = result?.continued ? 'continued' : 'error';
      const message = String(result?.error ?? 'Error desconocido');
      e.error = message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) + '…' : message;
    }
  }

  /** Nodes still running when the flow ended were interrupted by the failure or the stop */
  toJSON(finalStatus: ExecutionStatus = 'completed'): NodeTraceEntry[] {
    for (const [nodeId, e] of this.entries) {
      if (e.status === 'running') {
        this.stop(nodeId, e);
        e.status = 'error';
        e.error = e.error || (finalStatus === 'cancelled' ? 'Interrumpido al detener el flujo' : 'Interrumpido por un error en otro nodo');
      }
    }
    return [...this.entries.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
}

// ── Persistence ──

export function startExecutionLog(targetId: string, trigger: ExecutionTrigger, scheduleId?: string | null): string {
  const logId = uuid();
  getDb().prepare(`
    INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status, trigger_type)
    VALUES (?, 'flow', ?, ?, 'running', ?)
  `).run(logId, targetId, scheduleId ?? null, trigger);
  return logId;
}

export interface FinishExecutionLog {
  status: Exclude<ExecutionStatus, 'running'>;
  durationMs: number;
  recordCount?: number | null;
  result?: unknown;
  errorMessage?: string | null;
  trace?: NodeTraceEntry[];
}

export function finishExecutionLog(logId: string, info: FinishExecutionLog): void {
  getDb().prepare(`
    UPDATE execution_logs
    SET status = ?, duration_ms = ?, record_count = ?, result = ?, error_message = ?, node_trace = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(
    info.status,
    info.durationMs,
    info.recordCount ?? null,
    info.result === undefined || info.result === null ? null : JSON.stringify(info.result),
    info.errorMessage ?? null,
    info.trace ? JSON.stringify(info.trace) : null,
    logId
  );
}

/** Sums the records written by export nodes, falling back to lists produced by other nodes */
export function summarizeContext(context: Record<string, any>) {
  const exportResults = Object.values(context).filter((v: any) => v?.filePath && v?.success);
  const exportedFiles = exportResults.map((r: any) => {
    const fileName = String(r.filePath).split(/[/\\]/).pop();
    return {
      fileName,
      downloadUrl: `/api/files/${fileName}`,
      records: r.records,
      format: r.format,
      filePath: r.filePath,
      previewRows: r.previewRows,
      headers: r.headers,
    };
  });

  let recordCount = 0;
  if (exportResults.length > 0) {
    recordCount = exportResults.reduce((acc: number, r: any) => acc + (r.records || 0), 0);
  } else {
    for (const val of Object.values(context)) {
      if (Array.isArray((val as any)?.data?.items)) recordCount += (val as any).data.items.length;
      else if (Array.isArray((val as any)?.data)) recordCount += (val as any).data.length;
    }
  }

  return { exportedFiles, recordCount };
}

export function isCancellationError(err: any, stateStatus?: string): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return stateStatus === 'cancelled' || msg.includes('detenid') || msg.includes('cancelad');
}
