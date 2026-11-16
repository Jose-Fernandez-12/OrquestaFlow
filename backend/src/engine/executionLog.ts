import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';

export type ExecutionTrigger = 'manual' | 'debug' | 'schedule' | 'webhook';
export type ExecutionStatus = 'running' | 'completed' | 'error' | 'cancelled';
export type NodeTraceStatus = 'running' | 'completed' | 'error' | 'skipped' | 'continued';

export interface ExportedFileInfo {
  nodeId?: string;
  fileName: string;
  downloadUrl: string;
  records?: number;
  format?: string;
  filePath?: string;
  previewRows?: any[];
  headers?: string[];
}

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
  mocked?: boolean;
  errorBranch?: boolean;
  failedItems?: Array<{ index: number; item: any; error: string }>;
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

export function buildExportedFileInfo(raw: any, fallbackNodeId?: string): ExportedFileInfo | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '#') return null;
    const fileName = trimmed.split(/[?#]/)[0].split(/[/\\]/).pop()?.trim() || '';
    if (!fileName || fileName === '#') return null;
    let decodedName = fileName;
    try {
      decodedName = decodeURIComponent(fileName);
    } catch {}
    const format = /\.xlsx?$/i.test(decodedName) ? 'Excel' : 'CSV';
    return {
      ...(fallbackNodeId ? { nodeId: fallbackNodeId } : {}),
      fileName: decodedName,
      downloadUrl: `/api/files/${decodedName}`,
      format,
    };
  }

  if (!raw || typeof raw !== 'object') return null;

  const rawPath = typeof raw.filePath === 'string' ? raw.filePath.trim() : '';
  const rawName = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const rawUrl = typeof raw.downloadUrl === 'string' && raw.downloadUrl.trim() !== '#' ? raw.downloadUrl.trim() : '';

  const pathBase = rawPath ? rawPath.split(/[/\\]/).pop()?.trim() || '' : '';
  const nameBase = rawName ? rawName.split(/[/\\]/).pop()?.trim() || '' : '';
  const urlBaseRaw = rawUrl ? rawUrl.split(/[?#]/)[0].split('/').pop()?.trim() || '' : '';
  let urlBase = urlBaseRaw;
  if (urlBaseRaw) {
    try {
      urlBase = decodeURIComponent(urlBaseRaw);
    } catch {}
  }

  const fileName = nameBase || pathBase || urlBase;
  if (!fileName || fileName === '#') return null;

  const downloadUrl = rawUrl
    ? (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('/') ? rawUrl : `/api/files/${fileName}`)
    : `/api/files/${fileName}`;

  const format = typeof raw.format === 'string' && raw.format.trim()
    ? raw.format.trim()
    : (/\.xlsx?$/i.test(fileName) ? 'Excel' : 'CSV');

  const nodeId = typeof raw.nodeId === 'string' && raw.nodeId.trim() ? raw.nodeId.trim() : fallbackNodeId;

  const info: ExportedFileInfo = {
    ...(nodeId ? { nodeId } : {}),
    fileName,
    downloadUrl,
    format,
  };

  if (typeof raw.records === 'number' && Number.isFinite(raw.records)) {
    info.records = raw.records;
  }
  if (rawPath) {
    info.filePath = rawPath;
  }
  if (Array.isArray(raw.previewRows)) {
    info.previewRows = raw.previewRows;
  }
  if (Array.isArray(raw.headers)) {
    info.headers = raw.headers;
  }

  return info;
}

function mergeExportedFileInfo(target: ExportedFileInfo, incoming: ExportedFileInfo): ExportedFileInfo {
  return {
    ...target,
    ...(incoming.nodeId && !target.nodeId ? { nodeId: incoming.nodeId } : {}),
    ...(incoming.records !== undefined && target.records === undefined ? { records: incoming.records } : {}),
    ...(incoming.format && !target.format ? { format: incoming.format } : {}),
    ...(incoming.filePath && !target.filePath ? { filePath: incoming.filePath } : {}),
    ...(incoming.previewRows && !target.previewRows ? { previewRows: incoming.previewRows } : {}),
    ...(incoming.headers && !target.headers ? { headers: incoming.headers } : {}),
  };
}

function safeJsonParse(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function normalizeExportedFiles(rawResult: unknown, trace?: unknown): ExportedFileInfo[] {
  const parsedResult = typeof rawResult === 'string' ? safeJsonParse(rawResult) : rawResult;
  const parsedTrace = typeof trace === 'string' ? safeJsonParse(trace) : trace;

  const byKey = new Map<string, ExportedFileInfo>();
  const addRaw = (entry: any, fallbackNodeId?: string) => {
    const info = buildExportedFileInfo(entry, fallbackNodeId);
    if (!info) return;
    const key = info.filePath || info.fileName;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, mergeExportedFileInfo(existing, info));
    } else {
      byKey.set(key, info);
    }
  };

  if (parsedResult && typeof parsedResult === 'object') {
    if (Array.isArray((parsedResult as any).exportedFiles)) {
      for (const item of (parsedResult as any).exportedFiles) addRaw(item);
    }
    if (Array.isArray((parsedResult as any).exported_files)) {
      for (const item of (parsedResult as any).exported_files) addRaw(item);
    }
  }

  if (Array.isArray(parsedTrace)) {
    for (const entry of parsedTrace) {
      if (!entry || typeof entry !== 'object') continue;
      const nodeId = typeof entry.nodeId === 'string' ? entry.nodeId : undefined;
      if (Array.isArray(entry.exportedFiles)) {
        for (const item of entry.exportedFiles) addRaw(item, nodeId);
      }
      if (Array.isArray(entry.exported_files)) {
        for (const item of entry.exported_files) addRaw(item, nodeId);
      }
      if (entry.filePath && entry.success) {
        addRaw(entry, nodeId);
      }
    }
  }

  return [...byKey.values()];
}

/**
 * Builds a per-node timeline from the engine's progress events.
 * Nodes inside a loop run many times: their durations are added up and `runs` counts the iterations.
 */
export class ExecutionTracer {
  private entries = new Map<string, NodeTraceEntry>();
  private activeSince = new Map<string, number>();
  private meta = new Map<string, { label: string; type: string }>();
  private exportedFilesList: ExportedFileInfo[] = [];
  private exportedKeys = new Set<string>();

  constructor(nodes: any[] = [], private now: () => number = Date.now) {
    this.registerNodes(nodes);
  }

  registerNodes(nodes: any[]): void {
    for (const n of nodes) {
      this.meta.set(n.id, { label: String(n.data?.label || n.id), type: String(n.type || '') });
    }
  }

  getExportedFiles(): ExportedFileInfo[] {
    return [...this.exportedFilesList];
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
      if (result?.mocked) e.mocked = true;
      if (Array.isArray(result?.failed_items) && result.failed_items.length > 0) {
        e.failedItems = result.failed_items;
      }
      const records = countRecords(result);
      if (records !== undefined) e.records = records;
      if (result?.filePath && result?.success) {
        const info = buildExportedFileInfo(result, nodeId);
        if (info) {
          const key = info.filePath || info.fileName;
          if (!this.exportedKeys.has(key)) {
            this.exportedKeys.add(key);
            this.exportedFilesList.push(info);
          }
        }
      }
      return;
    }

    if (status === 'error') {
      const e = this.entry(nodeId);
      this.stop(nodeId, e);
      e.runs++;
      e.status = result?.continued ? 'continued' : 'error';
      if (result?.errorBranch) e.errorBranch = true;
      if (Array.isArray(result?.failed_items) && result.failed_items.length > 0) {
        e.failedItems = result.failed_items;
      }
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

export function startExecutionLog(
  targetId: string,
  trigger: ExecutionTrigger,
  scheduleId?: string | null,
  parentExecutionId?: string | null
): string {
  const logId = uuid();
  getDb().prepare(`
    INSERT INTO execution_logs (id, target_type, target_id, schedule_id, status, trigger_type, parent_execution_id)
    VALUES (?, 'flow', ?, ?, 'running', ?, ?)
  `).run(logId, targetId, scheduleId ?? null, trigger, parentExecutionId ?? null);
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
export function summarizeContext(context: Record<string, any>, tracer?: ExecutionTracer) {
  const byKey = new Map<string, ExportedFileInfo>();

  const addFile = (raw: any, fallbackNodeId?: string) => {
    const info = buildExportedFileInfo(raw, fallbackNodeId);
    if (!info) return;
    const key = info.filePath || info.fileName;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeExportedFileInfo(existing, info) : info);
  };

  if (tracer) {
    for (const file of tracer.getExportedFiles()) {
      addFile(file, file.nodeId);
    }
  }

  const collectFromValue = (val: any, nodeId?: string, depth = 0) => {
    if (!val || typeof val !== 'object' || depth > 2) return;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && item.filePath && item.success) {
          addFile(item, nodeId);
        }
      }
      return;
    }
    if (val.filePath && val.success) {
      addFile(val, nodeId);
    }
    if (val.outputs && typeof val.outputs === 'object' && !Array.isArray(val.outputs)) {
      for (const [subKey, subVal] of Object.entries(val.outputs)) {
        collectFromValue(subVal, subKey, depth + 1);
      }
    }
  };

  for (const [key, val] of Object.entries(context || {})) {
    if (key.startsWith('_') || key === 'start') continue;
    collectFromValue(val, key);
  }

  const exportedFiles = [...byKey.values()];

  let recordCount = 0;
  if (exportedFiles.length > 0) {
    recordCount = exportedFiles.reduce((acc: number, r) => acc + (r.records || 0), 0);
  } else {
    const seen = new Set<unknown>();
    for (const val of Object.values(context || {})) {
      if (!val || typeof val !== 'object') continue;
      if (seen.has(val)) continue;
      seen.add(val);
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
