import type { StatusTotals, TargetType } from './dashboardApi';

export const TARGET_LABEL: Record<TargetType, string> = { flow: 'Flujo', script: 'Script', query: 'Consulta' };

const TRIGGER_LABEL: Record<string, string> = { manual: 'Manual', schedule: 'Programada', webhook: 'Webhook', api: 'API' };
const TRIGGER_PLURAL: Record<string, [string, string]> = {
  manual: ['manual', 'manuales'],
  schedule: ['programada', 'programadas'],
  webhook: ['por webhook', 'por webhook'],
  api: ['por API', 'por API'],
};

export const triggerLabel = (trigger: string) => TRIGGER_LABEL[trigger] ?? trigger;

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es')} ${n === 1 ? one : many}`;

const decimal = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 1 });

/** 57 → "57 ms", 4200 → "4,2 s", 125000 → "2 min 5 s" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${decimal(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds - minutes * 60);
    return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes - hours * 60;
  return restMinutes > 0 ? `${hours} h ${restMinutes} min` : `${hours} h`;
}

/** Time left until a scheduled run: "en 2 h 15 min", "en 6 d 12 h" */
export function timeUntil(date: Date | null, now = Date.now()): string {
  if (!date) return 'Sin fecha';
  const minutes = Math.floor((date.getTime() - now) / 60_000);
  if (minutes < 0) return 'ahora';
  if (minutes < 1) return 'en menos de 1 min';
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes - hours * 60;
    return rest > 0 ? `en ${hours} h ${rest} min` : `en ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours - days * 24;
  return restHours > 0 ? `en ${days} d ${restHours} h` : `en ${days} d`;
}

/** "lun 9, 08:00" */
export function formatWhen(date: Date | null): string {
  if (!date) return 'fecha desconocida';
  return date.toLocaleString('es', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Label of a chart bucket: the hour for 24 h, the day otherwise */
export function bucketLabel(start: string, hourly: boolean): string {
  const date = new Date(start);
  return hourly
    ? `${date.getHours()} h`
    : date.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
}

/** "+12 frente al periodo anterior"; null when there is nothing to compare with */
export function countDelta(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const diff = current - previous;
  if (diff === 0) return 'Igual que el periodo anterior';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('es')} frente al periodo anterior`;
}

export const formatRate = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)} %`);

/** Change of the success rate in percentage points; `better` drives the colour */
export function rateDelta(current: StatusTotals, previous: StatusTotals): { text: string; better: boolean | null } | null {
  if (current.successRate === null || previous.successRate === null) return null;
  const points = Math.round(current.successRate * 100) - Math.round(previous.successRate * 100);
  if (points === 0) return { text: 'Igual que el periodo anterior', better: null };
  return { text: `${points > 0 ? '+' : '−'}${Math.abs(points)} pts frente al periodo anterior`, better: points > 0 };
}

/** "6 programadas · 2 manuales" */
export function failedBreakdown(byTrigger: Record<string, number>): string {
  return Object.entries(byTrigger)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([trigger, count]) => {
      const [one, many] = TRIGGER_PLURAL[trigger] ?? [trigger, trigger];
      return `${count.toLocaleString('es')} ${count === 1 ? one : many}`;
    })
    .join(' · ');
}
