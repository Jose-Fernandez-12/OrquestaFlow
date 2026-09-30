import { JsonTreeViewer } from '../JsonTreeViewer';
import { cn } from '../../../lib/utils';
import { CONSOLE_LEVEL_STYLES } from './transformTrace';

export function ConsoleTable({ data }: { data: any }) {
  const rows: any[] = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];
  const keys = Array.isArray(data) ? rows.map((_, i) => String(i)) : Object.keys(data || {});
  const objectRows = rows.length > 0 && rows.every(r => r && typeof r === 'object' && !Array.isArray(r));
  if (!objectRows) return <JsonTreeViewer data={data} />;
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  return (
    <div className="overflow-auto max-h-64 border border-border rounded-sm">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead className="bg-bg sticky top-0">
          <tr>
            <th className="px-2 py-1 text-left text-muted font-medium border-b border-border">#</th>
            {cols.map(c => <th key={c} className="px-2 py-1 text-left text-muted font-medium border-b border-border">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="px-2 py-1 text-muted">{keys[i]}</td>
              {cols.map(c => (
                <td key={c} className="px-2 py-1 text-fg whitespace-nowrap">
                  {r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ConsoleLogEntry {
  level: string;
  args: string[];
  ts: number;
  nodeId?: string;
  nodeLabel?: string;
  tableData?: any;
  line?: number | null;
}

/**
 * Console output of transform nodes, grouped by the node that wrote it. Used when there is no
 * step-by-step trace (a run outside debug mode, or logs of earlier nodes).
 */
export function ConsoleLogList({ logs, currentNodeId }: { logs: ConsoleLogEntry[]; currentNodeId: string }) {
  const groups: Array<{ key: string; label: string; isCurrent: boolean; logs: ConsoleLogEntry[] }> = [];
  for (const log of logs) {
    const key = log.nodeId || log.nodeLabel || '';
    let group = groups.find(g => g.key === key);
    if (!group) {
      group = { key, label: log.nodeLabel || key, isCurrent: log.nodeId === currentNodeId, logs: [] };
      groups.push(group);
    }
    group.logs.push(log);
  }
  // The current node first, then earlier nodes
  groups.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));

  if (logs.length === 0) {
    return (
      <p className="text-xs text-muted text-center py-10">
        Todavía no hay mensajes de consola. Usa <code>console.log(...)</code> o <code>console.table(...)</code> en el código.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.key} className="space-y-1.5">
          <header className="flex items-center gap-2 text-xs">
            <span className="font-medium text-fg">{group.label}</span>
            {!group.isCurrent && (
              <span className="text-[10px] text-muted bg-bg border border-border px-1.5 rounded-sm">nodo anterior</span>
            )}
            <span className="text-[11px] text-muted ml-auto">
              {group.logs.length} {group.logs.length === 1 ? 'mensaje' : 'mensajes'}
            </span>
          </header>
          <div className="border border-border rounded-sm bg-surface divide-y divide-border">
            {group.logs.map((log, i) => {
              const style = CONSOLE_LEVEL_STYLES[log.level] || CONSOLE_LEVEL_STYLES.log;
              return (
                <div key={i} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <span className={cn('shrink-0 text-[10px] font-mono font-semibold px-1.5 py-px rounded-sm border', style.chip)}>
                      {style.label}
                    </span>
                    {!(log.level === 'table' && log.tableData !== undefined) && (
                      <span className={cn('flex-1 min-w-0 text-xs font-mono whitespace-pre-wrap break-words select-text', style.text)}>
                        {log.args.join(' ')}
                      </span>
                    )}
                    {log.level === 'table' && log.tableData !== undefined && <span className="flex-1" />}
                    {log.line && <span className="shrink-0 text-[11px] text-muted">línea {log.line}</span>}
                  </div>
                  {log.level === 'table' && log.tableData !== undefined && <ConsoleTable data={log.tableData} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
