import { describe, it, expect } from 'vitest';
import { countDelta, failedBreakdown, formatDuration, formatRate, rateDelta, timeUntil } from './dashboardFormat';
import type { StatusTotals } from './dashboardApi';

const totals = (successRate: number | null): StatusTotals => ({ total: 0, completed: 0, error: 0, cancelled: 0, running: 0, successRate, avgDurationMs: null, records: 0 });

describe('dashboardFormat', () => {
  it('writes durations in the unit a person would use', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(57)).toBe('57 ms');
    expect(formatDuration(4200)).toBe('4,2 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
  });

  it('counts down to the next run', () => {
    const now = Date.parse('2026-11-09T20:00:00Z');
    const at = (ms: number) => new Date(now + ms);
    expect(timeUntil(null, now)).toBe('Sin fecha');
    expect(timeUntil(at(-5_000), now)).toBe('ahora');
    expect(timeUntil(at(20_000), now)).toBe('en menos de 1 min');
    expect(timeUntil(at(5 * 60_000), now)).toBe('en 5 min');
    expect(timeUntil(at(135 * 60_000), now)).toBe('en 2 h 15 min');
    expect(timeUntil(at(156 * 3_600_000), now)).toBe('en 6 d 12 h');
  });

  it('compares with the previous period only when there is one', () => {
    expect(countDelta(5, 0)).toBeNull();
    expect(countDelta(5, 5)).toBe('Igual que el periodo anterior');
    expect(countDelta(17, 5)).toBe('+12 frente al periodo anterior');
    expect(countDelta(3, 5)).toBe('−2 frente al periodo anterior');
  });

  it('shows the success rate and its change in points', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.944)).toBe('94 %');
    expect(rateDelta(totals(0.94), totals(null))).toBeNull();
    expect(rateDelta(totals(0.94), totals(0.91))).toEqual({ text: '+3 pts frente al periodo anterior', better: true });
    expect(rateDelta(totals(0.8), totals(0.9))).toEqual({ text: '−10 pts frente al periodo anterior', better: false });
  });

  it('breaks failures down by what started them, biggest first', () => {
    expect(failedBreakdown({ manual: 2, schedule: 6 })).toBe('6 programadas · 2 manuales');
    expect(failedBreakdown({ schedule: 1 })).toBe('1 programada');
    expect(failedBreakdown({})).toBe('');
  });
});
