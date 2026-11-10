import React, { useState } from 'react';
import type { SeriesBucket } from './dashboardApi';
import { bucketLabel } from './dashboardFormat';
import { cn } from '../../lib/utils';

const PLOT_HEIGHT = 112;
const MIN_SEGMENT = 3;
const SEGMENT_GAP = 2;

/**
 * Stacked from the baseline up. The failed red is darker than the theme's `danger` on purpose:
 * next to the success green, `danger` is nearly the same colour for red-green colour-blind readers.
 */
const STATUSES = [
  { key: 'completed', label: 'Completadas', color: '#17a34a' },
  { key: 'error', label: 'Fallidas', color: '#b91c1c' },
  { key: 'cancelled', label: 'Canceladas', color: '#a3a3a3' },
] as const;

const totalOf = (b: SeriesBucket) => b.completed + b.error + b.cancelled;

/** Which x labels to print so they never collide: all of them for a week, a few for 24 h / 30 days */
function shownLabels(count: number): Set<number> {
  if (count <= 7) return new Set(Array.from({ length: count }, (_, i) => i));
  const step = Math.ceil(count / 5);
  const shown = new Set<number>();
  for (let i = count - 1; i >= 0; i -= step) shown.add(i);
  return shown;
}

export function ActivityChart({ series, hourly }: { series: SeriesBucket[]; hourly: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...series.map(totalOf));
  const empty = series.every(b => totalOf(b) === 0);
  const labels = shownLabels(series.length);
  const sum = (key: typeof STATUSES[number]['key']) => series.reduce((acc, b) => acc + b[key], 0);

  if (empty) {
    return <div className="py-8 text-sm text-muted text-center">Sin ejecuciones en este periodo.</div>;
  }

  const hovered = active !== null ? series[active] : null;

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        {STATUSES.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
            <span className="text-fg font-medium tabular-nums">{sum(s.key).toLocaleString('es')}</span>
          </span>
        ))}
      </div>

      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="absolute -top-0.5 left-0 text-[11px] text-muted tabular-nums pointer-events-none" aria-hidden="true">{max.toLocaleString('es')}</div>
        <div className="flex items-end border-b border-border" style={{ height: PLOT_HEIGHT + 16 }} role="img"
          aria-label={`Ejecuciones por ${hourly ? 'hora' : 'día'}: ${sum('completed')} completadas, ${sum('error')} fallidas, ${sum('cancelled')} canceladas.`}>
          {series.map((bucket, i) => {
            const segments = STATUSES.filter(s => bucket[s.key] > 0);
            return (
              <div
                key={bucket.start}
                tabIndex={0}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cn('flex-1 h-full flex flex-col-reverse items-center px-[2px] rounded-t-[4px] outline-none transition-colors', active === i && 'bg-fg/5')}
                style={{ gap: SEGMENT_GAP }}
              >
                {segments.map((s, index) => (
                  <span
                    key={s.key}
                    className={cn('block w-full max-w-[28px]', index === segments.length - 1 && 'rounded-t-[4px]')}
                    style={{ background: s.color, height: Math.max(MIN_SEGMENT, Math.round((bucket[s.key] / max) * PLOT_HEIGHT)) }}
                  />
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex mt-1.5" aria-hidden="true">
          {series.map((bucket, i) => (
            <span key={bucket.start} className="flex-1 min-w-0 text-center text-[11px] text-muted whitespace-nowrap overflow-visible">
              {labels.has(i) ? bucketLabel(bucket.start, hourly) : ''}
            </span>
          ))}
        </div>

        {/* Fixed-height readout instead of a floating tooltip: nothing to clip or overlap in a narrow card */}
        <div className="mt-2 min-h-[18px] flex flex-wrap items-center gap-x-3 text-xs text-muted" aria-live="polite">
          {hovered ? (
            <>
              <span className="text-fg font-medium">{bucketLabel(hovered.start, hourly)}</span>
              {totalOf(hovered) === 0 ? <span>Sin ejecuciones</span> : STATUSES.filter(s => hovered[s.key] > 0).map(s => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-[2px]" style={{ background: s.color }} aria-hidden="true" />
                  <span className="text-fg font-medium tabular-nums">{hovered[s.key].toLocaleString('es')}</span> {s.label.toLowerCase()}
                </span>
              ))}
            </>
          ) : (
            <span>Pasa el cursor por una barra para ver el detalle.</span>
          )}
        </div>
      </div>

      <table className="sr-only">
        <caption>Ejecuciones por {hourly ? 'hora' : 'día'}</caption>
        <thead>
          <tr><th>Periodo</th>{STATUSES.map(s => <th key={s.key}>{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {series.map(bucket => (
            <tr key={bucket.start}>
              <td>{bucketLabel(bucket.start, hourly)}</td>
              {STATUSES.map(s => <td key={s.key}>{bucket[s.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
