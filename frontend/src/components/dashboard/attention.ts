import type { Flow } from '../../store/flowSlice';
import type { Script } from '../../store/scriptSlice';
import { validateFlow } from '../flow/validation/flowValidation';
import { ENV_VIEW } from '../scripts/envLabels';
import { relativeTime } from '../scripts/scriptDisplay';
import type { DashboardSummary, TargetType } from './dashboardApi';
import { formatWhen, plural, timeUntil, triggerLabel } from './dashboardFormat';

export type AttentionKind = 'failed' | 'missed' | 'invalid-flow' | 'python-base' | 'script-env';

/**
 * One row of «Requiere atención»: something broken or that will break, with what the user can do about it.
 * The title is only the name; what happened goes in the detail, which wraps instead of being cut off.
 */
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  severity: 'danger' | 'warn';
  title: string;
  detail: string;
  targetType?: TargetType;
  targetId?: string;
  targetName?: string;
}

export interface FlowHealth {
  flow: Flow;
  errors: number;
  warnings: number;
}

/** Checks a flow with the same rules the editor uses, so the dashboard and the canvas agree */
export function checkFlow(flow: Flow): FlowHealth {
  try {
    const def = JSON.parse(flow.definition || '{}');
    const issues = validateFlow(def.nodes ?? [], def.edges ?? []);
    return {
      flow,
      errors: issues.filter(i => i.level === 'error').length,
      warnings: issues.filter(i => i.level === 'warning').length,
    };
  } catch {
    return { flow, errors: 1, warnings: 0 };
  }
}

const date = (iso: string | null) => (iso ? new Date(iso) : null);

interface AttentionInput {
  summary: DashboardSummary | null;
  flows: Flow[];
  scripts: Script[];
  /** null while the base environment is still being checked */
  pythonReady: boolean | null;
  now?: number;
}

/**
 * Everything that needs the user, most urgent first: runs that failed, runs that never happened,
 * flows that will fail when they run, and Python environments that block scripts.
 */
export function buildAttention({ summary, flows, scripts, pythonReady, now = Date.now() }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const scheduled = new Set(summary?.scheduledTargets ?? []);

  // Failures of something that runs unattended come first: nobody was watching
  const failing = [...(summary?.failing ?? [])].sort((a, b) => Number(b.scheduled) - Number(a.scheduled));
  for (const f of failing) {
    const reason = f.error ? `${f.error}${f.failedNode ? ` (nodo «${f.failedNode}»)` : ''}` : 'Sin mensaje de error';
    items.push({
      key: `failed:${f.targetType}:${f.targetId}`,
      kind: 'failed',
      severity: 'danger',
      title: f.targetName,
      detail: `Falló ${relativeTime(date(f.failedAt), now)} · ${triggerLabel(f.trigger)} · ${reason}`,
      targetType: f.targetType,
      targetId: f.targetId,
      targetName: f.targetName,
    });
  }

  for (const m of summary?.missed ?? []) {
    const next = m.nextRunAt ? ` · siguiente ${timeUntil(date(m.nextRunAt), now)}` : '';
    items.push({
      key: `missed:${m.scheduleId}`,
      kind: 'missed',
      severity: 'warn',
      title: m.targetName ?? m.scheduleName,
      detail: `No se ejecutó el ${formatWhen(date(m.missedAt))}: el servidor no estaba en marcha${next}`,
      targetType: m.targetType,
      targetId: m.targetId,
      targetName: m.targetName ?? m.scheduleName,
    });
  }

  const invalid = flows
    .map(checkFlow)
    .filter(h => h.errors > 0)
    .map(h => ({ ...h, scheduled: scheduled.has(`flow:${h.flow.id}`) }))
    .sort((a, b) => Number(b.scheduled) - Number(a.scheduled) || b.errors - a.errors);
  for (const h of invalid) {
    const consequence = h.scheduled ? 'está programado y fallará en su próxima ejecución' : 'fallará si se ejecuta';
    const found = `${plural(h.errors, 'error de validación', 'errores de validación')} · ${consequence}`;
    items.push({
      key: `invalid:${h.flow.id}`,
      kind: 'invalid-flow',
      severity: h.scheduled ? 'danger' : 'warn',
      title: h.flow.name,
      detail: h.warnings > 0 ? `${found} · ${plural(h.warnings, 'aviso', 'avisos')}` : found,
      targetType: 'flow',
      targetId: h.flow.id,
      targetName: h.flow.name,
    });
  }

  const pythonScripts = scripts.filter(s => s.env);
  const baseMissing = pythonReady === false && pythonScripts.length > 0;
  if (baseMissing) {
    const blocked = pythonScripts.filter(s => s.env?.view === 'no-preparado');
    const names = blocked.slice(0, 3).map(s => s.name).join(', ');
    items.push({
      key: 'python-base',
      kind: 'python-base',
      severity: 'warn',
      title: 'Entorno Python base sin preparar',
      detail: blocked.length > 0
        ? `Bloquea ${plural(blocked.length, 'script', 'scripts')}: ${names}${blocked.length > 3 ? '…' : ''}`
        : 'Los scripts Python lo necesitan para instalar sus dependencias',
    });
  }

  for (const script of pythonScripts) {
    const view = script.env!.view;
    // Scripts waiting for the base environment are already covered by the row above
    const needsWork = view === 'pendiente' || view === 'invalido' || (view === 'no-preparado' && !baseMissing);
    if (!needsWork) continue;
    items.push({
      key: `script-env:${script.id}`,
      kind: 'script-env',
      severity: 'warn',
      title: script.name,
      detail: `${ENV_VIEW[view].label} · ${ENV_VIEW[view].hint}`,
      targetType: 'script',
      targetId: script.id,
      targetName: script.name,
    });
  }

  return items;
}

/** The one-line answer to «¿hay algo roto?» */
export function headline(items: AttentionItem[]): { tone: 'ok' | 'warn' | 'danger'; text: string } {
  const failed = items.filter(i => i.kind === 'failed').length;
  const rest = items.length - failed;
  if (items.length === 0) return { tone: 'ok', text: 'Todo en orden' };

  const failedText = failed > 0 ? plural(failed, 'ejecución fallida', 'ejecuciones fallidas') : '';
  const restText = rest > 0 ? plural(rest, 'pendiente por revisar', 'pendientes por revisar') : '';
  return {
    tone: items.some(i => i.severity === 'danger') ? 'danger' : 'warn',
    text: [failedText, restText].filter(Boolean).join(' y '),
  };
}
