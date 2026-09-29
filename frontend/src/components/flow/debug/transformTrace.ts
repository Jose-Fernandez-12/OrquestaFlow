// Stops recorded by the engine while running a transform node in debug mode
// (backend/src/engine/transformDebug.ts): breakpoint hits and console calls, in execution order.
export interface TransformStop {
  kind: 'console' | 'breakpoint';
  level?: string;
  args?: string[];
  tableData?: any;
  line: number | null;
  hit?: number;
  vars?: Record<string, any>;
  ts: number;
}

export interface TransformTrace {
  stops: TransformStop[];
  breakpoints: Array<{ requested: number; resolved: number | null }>;
  dropped: number;
  errorLine: number | null;
  code: string;
}

export type TransformStep =
  | (TransformStop & { kind: 'console' | 'breakpoint' })
  | { kind: 'error'; line: number | null; message: string };

/** Stops plus, when the script failed, a last step pointing at the error. */
export function buildTransformSteps(trace: TransformTrace | null | undefined, error?: string | null): TransformStep[] {
  if (!trace) return [];
  const steps: TransformStep[] = [...trace.stops];
  if (error) steps.push({ kind: 'error', line: trace.errorLine, message: error });
  return steps;
}

// Colors of each console level, shared by the step viewer and the console list
export const CONSOLE_LEVEL_STYLES: Record<string, { label: string; chip: string; text: string }> = {
  log:        { label: 'log',        chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-800' },
  info:       { label: 'info',       chip: 'bg-sky-50 text-sky-700 border-sky-200',             text: 'text-sky-800' },
  warn:       { label: 'warn',       chip: 'bg-amber-50 text-amber-700 border-amber-200',       text: 'text-amber-800' },
  error:      { label: 'error',      chip: 'bg-rose-50 text-rose-700 border-rose-200',          text: 'text-rose-800' },
  debug:      { label: 'debug',      chip: 'bg-violet-50 text-violet-700 border-violet-200',    text: 'text-violet-800' },
  table:      { label: 'table',      chip: 'bg-teal-50 text-teal-700 border-teal-200',          text: 'text-teal-800' },
  checkpoint: { label: 'checkpoint', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200',    text: 'text-indigo-800' },
};
