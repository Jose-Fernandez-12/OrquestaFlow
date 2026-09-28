import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, CircleDot, Terminal, AlertCircle, Info } from 'lucide-react';
import { JsonTreeViewer } from '../JsonTreeViewer';
import { cn } from '../../../lib/utils';
import { CONSOLE_LEVEL_STYLES, type TransformStep, type TransformTrace } from './transformTrace';
import { ConsoleTable } from './ConsoleLogList';

function stepTitle(step: TransformStep): string {
  if (step.kind === 'breakpoint') return 'Breakpoint';
  if (step.kind === 'error') return 'Error';
  return `console.${step.level || 'log'}`;
}

function ordinal(n: number) {
  return `${n}.ª vez`;
}

// Script parameters go after the user's own variables; item/index only exist inside loops
const PARAM_NAMES = ['data', 'item', 'index'];

function summarize(value: any): string {
  if (Array.isArray(value)) return `Lista (${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function VariablesList({
  vars,
  previous,
  expanded,
  onToggle,
}: {
  vars: Record<string, any>;
  previous?: Record<string, any>;
  expanded: Record<string, boolean>;
  onToggle: (name: string) => void;
}) {
  const entries = Object.entries(vars)
    .filter(([name, value]) => !((name === 'item' || name === 'index') && value === null))
    .sort(([a], [b]) => Number(PARAM_NAMES.includes(a)) - Number(PARAM_NAMES.includes(b)));

  return (
    <div className="border border-border rounded-sm divide-y divide-border bg-surface">
      {entries.map(([name, value]) => {
        const isComplex = value !== null && typeof value === 'object';
        const isOpen = isComplex && expanded[name];
        const isNew = previous !== undefined && !(name in previous);
        const changed = !isNew && previous !== undefined && JSON.stringify(previous[name]) !== JSON.stringify(value);
        return (
          <div key={name}>
            <button
              type="button"
              onClick={() => isComplex && onToggle(name)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px]',
                isComplex ? 'hover:bg-bg cursor-pointer' : 'cursor-default'
              )}
            >
              <span className="w-3 shrink-0 text-muted">
                {isComplex && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              </span>
              <span className={cn('shrink-0 font-semibold', PARAM_NAMES.includes(name) ? 'text-muted' : 'text-fg')}>{name}</span>
              <span className={cn('truncate', typeof value === 'string' ? 'text-emerald-700' : typeof value === 'number' ? 'text-blue-700' : 'text-muted')}>
                {summarize(value)}
              </span>
              {(changed || isNew) && (
                <span className="ml-auto shrink-0 text-[10px] font-sans font-medium text-amber-700 bg-amber-100 px-1.5 rounded-sm">
                  {isNew ? 'nueva' : 'cambió'}
                </span>
              )}
            </button>
            {isOpen && (
              <div className="px-2.5 pb-2 pl-7 text-[11px] max-h-72 overflow-auto">
                <JsonTreeViewer data={value} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface TransformStepperProps {
  trace: TransformTrace;
  steps: TransformStep[];
  index: number;
  onIndexChange: (index: number) => void;
}

export function TransformStepper({ trace, steps, index, onIndexChange }: TransformStepperProps) {
  const step = steps[Math.min(index, steps.length - 1)];
  const codeLines = useMemo(() => trace.code.replace(/\s+$/, '').split('\n'), [trace.code]);
  const breakpointLines = useMemo(
    () => new Set(trace.breakpoints.map(b => b.resolved).filter((l): l is number => l !== null)),
    [trace.breakpoints]
  );
  const consoleLines = useMemo(
    () => new Set(trace.stops.filter(s => s.kind === 'console' && s.line).map(s => s.line as number)),
    [trace.stops]
  );
  const moved = trace.breakpoints.filter(b => b.resolved !== b.requested);

  // Open variables stay open while moving between stops
  const [expandedVars, setExpandedVars] = useState<Record<string, boolean>>({});
  const toggleVar = (name: string) => setExpandedVars(prev => ({ ...prev, [name]: !prev[name] }));

  const currentLineRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    chipRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  // ← / → move between stops
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'ArrowRight' && index < steps.length - 1) { e.preventDefault(); onIndexChange(index + 1); }
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onIndexChange(index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, steps.length, onIndexChange]);

  if (!step) return null;
  const vars = step.kind !== 'error' ? step.vars : undefined;
  // Variables of the closest earlier stop that recorded them, to mark what changed
  let previousVars: Record<string, any> | undefined;
  for (let i = index - 1; i >= 0 && !previousVars; i--) {
    const s = steps[i];
    if (s.kind !== 'error') previousVars = s.vars;
  }
  const levelStyle = step.kind === 'console' ? CONSOLE_LEVEL_STYLES[step.level || 'log'] || CONSOLE_LEVEL_STYLES.log : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Stop navigation */}
      <div className="px-4 py-2 border-b border-border bg-surface flex items-center gap-3">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            disabled={index === 0}
            className="p-1 rounded border border-border text-muted hover:text-fg hover:bg-bg disabled:opacity-40 disabled:pointer-events-none"
            title="Parada anterior (←)"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            disabled={index >= steps.length - 1}
            className="p-1 rounded border border-border text-muted hover:text-fg hover:bg-bg disabled:opacity-40 disabled:pointer-events-none"
            title="Parada siguiente (→)"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <span className="text-xs text-fg font-medium shrink-0 tabular-nums">
          Parada {index + 1} <span className="text-muted font-normal">de {steps.length}</span>
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto py-0.5">
          {steps.map((s, i) => {
            const active = i === index;
            const past = i < index;
            return (
              <button
                key={i}
                ref={active ? chipRef : undefined}
                type="button"
                onClick={() => onIndexChange(i)}
                title={`${stepTitle(s)}${s.line ? ` · línea ${s.line}` : ''}`}
                className={cn(
                  'shrink-0 h-6 px-1.5 rounded-sm border text-[10px] font-mono flex items-center gap-1 transition-colors',
                  active ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg hover:border-muted',
                  past && !active && 'opacity-60'
                )}
              >
                {s.kind === 'breakpoint' ? (
                  <span className="w-2 h-2 rounded-full bg-danger" />
                ) : s.kind === 'error' ? (
                  <AlertCircle size={11} className="text-danger" />
                ) : (
                  <Terminal size={11} />
                )}
                {s.line ?? '?'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Code with the current line */}
        <div className="min-h-0 overflow-auto bg-bg border-b md:border-b-0 md:border-r border-border py-2 font-mono text-[12px] leading-[20px]">
          {codeLines.map((text, i) => {
            const line = i + 1;
            const isCurrent = step.line === line;
            const isError = step.kind === 'error' && isCurrent;
            return (
              <div
                key={i}
                ref={isCurrent ? currentLineRef : undefined}
                className={cn(
                  'flex items-stretch pr-3 border-l-2',
                  isCurrent
                    ? isError ? 'bg-rose-50 border-danger' : 'bg-amber-100/70 border-amber-500'
                    : 'border-transparent'
                )}
              >
                <span className="w-5 shrink-0 flex items-center justify-center">
                  {breakpointLines.has(line) ? (
                    <span className="w-2 h-2 rounded-full bg-danger" title="Breakpoint" />
                  ) : consoleLines.has(line) ? (
                    <span className="w-1.5 h-1.5 rounded-full border border-accent" title="console.*" />
                  ) : null}
                </span>
                <span className={cn('w-8 shrink-0 text-right pr-3 select-none tabular-nums', isCurrent ? 'text-fg font-semibold' : 'text-muted/60')}>
                  {line}
                </span>
                <span className="whitespace-pre text-fg/90">{text || ' '}</span>
              </div>
            );
          })}
        </div>

        {/* Details of the stop */}
        <div className="min-h-0 overflow-auto p-4 space-y-4 bg-surface">
          <div className="flex items-center gap-2 flex-wrap">
            {step.kind === 'breakpoint' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
                <CircleDot size={14} /> Breakpoint
              </span>
            )}
            {step.kind === 'console' && levelStyle && (
              <span className={cn('text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-sm border', levelStyle.chip)}>
                console.{levelStyle.label}
              </span>
            )}
            {step.kind === 'error' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertCircle size={14} /> El script se detuvo con un error
              </span>
            )}
            <span className="text-xs text-muted">
              {step.line ? `línea ${step.line}` : 'línea desconocida'}
              {step.kind === 'breakpoint' && step.hit && step.hit > 1 ? ` · ${ordinal(step.hit)}` : ''}
            </span>
          </div>

          {step.kind === 'error' && (
            <div className="p-3 rounded-sm border border-rose-200 bg-rose-50 text-xs text-rose-800 font-mono whitespace-pre-wrap break-words">
              {step.message}
            </div>
          )}

          {step.kind === 'console' && (
            step.level === 'table' && step.tableData !== undefined ? (
              <ConsoleTable data={step.tableData} />
            ) : (
              <div className={cn('p-3 rounded-sm border border-border bg-bg text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto', levelStyle?.text)}>
                {(step.args || []).join(' ')}
              </div>
            )
          )}

          {step.kind !== 'error' && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-fg">Variables en este punto</p>
              {vars && Object.keys(vars).length > 0 ? (
                <VariablesList vars={vars} previous={previousVars} expanded={expandedVars} onToggle={toggleVar} />
              ) : (
                <p className="text-[11px] text-muted">
                  {vars
                    ? 'Aún no hay variables declaradas en este punto.'
                    : 'Esta llamada está dentro de una expresión; pon un breakpoint en la línea para ver sus variables.'}
                </p>
              )}
            </div>
          )}

          {(moved.length > 0 || trace.dropped > 0) && (
            <div className="space-y-1 pt-2 border-t border-border">
              {moved.map(b => (
                <p key={b.requested} className="text-[11px] text-muted flex items-start gap-1.5">
                  <Info size={12} className="shrink-0 mt-px" />
                  {b.resolved === null
                    ? `El breakpoint de la línea ${b.requested} no tiene una instrucción debajo y no se usó.`
                    : `El breakpoint de la línea ${b.requested} se movió a la ${b.resolved}, la primera instrucción que empieza ahí.`}
                </p>
              ))}
              {trace.dropped > 0 && (
                <p className="text-[11px] text-muted flex items-start gap-1.5">
                  <Info size={12} className="shrink-0 mt-px" />
                  Solo se guardaron las primeras {trace.stops.length} paradas; {trace.dropped} más se omitieron.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
