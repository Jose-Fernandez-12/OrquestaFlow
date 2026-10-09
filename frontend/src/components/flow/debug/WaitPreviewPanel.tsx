import { Hourglass, CheckCircle2, MinusCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type WaitedNodeState = 'completed' | 'skipped' | 'error' | 'ignored' | 'pending';

export interface WaitPreview {
  kind: 'wait';
  waitedFor: Array<{ id: string; label: string; state: WaitedNodeState }>;
}

const STATE_INFO: Record<WaitedNodeState, { text: string; hint: string; className: string; Icon: typeof CheckCircle2 }> = {
  completed: { text: 'Terminó', hint: 'El nodo ya se ejecutó.', className: 'text-emerald-600', Icon: CheckCircle2 },
  skipped: {
    text: 'Omitido',
    hint: 'Una bifurcación no tomó su rama: no se ejecutará y la espera continúa.',
    className: 'text-muted',
    Icon: MinusCircle,
  },
  error: { text: 'Con error', hint: 'El nodo falló.', className: 'text-rose-600', Icon: AlertCircle },
  ignored: {
    text: 'Ignorado',
    hint: 'Está dentro de un bucle: la espera no puede verlo desde fuera.',
    className: 'text-amber-600',
    Icon: AlertCircle,
  },
  pending: { text: 'Pendiente', hint: 'Aún no terminó.', className: 'text-amber-600', Icon: Loader2 },
};

/** The nodes an "Esperar nodo" was holding for and how each of them ended. */
export function WaitPreviewPanel({ preview }: { preview: WaitPreview }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
      <div className="p-3 bg-surface rounded-md border border-border flex items-center gap-3">
        <span className="w-8 h-8 rounded bg-accent/10 text-accent flex items-center justify-center shrink-0">
          <Hourglass size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg">Esperar nodo</div>
          <div className="text-[11px] text-muted">
            Las ramas que siguen estaban retenidas hasta que terminaran estos nodos. Los datos que pasan son los de su entrada.
          </div>
        </div>
      </div>

      <div className="p-3 bg-surface rounded-md border border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Nodos esperados</span>
          <span className="text-[10px] font-mono text-muted">{preview.waitedFor.length}</span>
        </div>
        {preview.waitedFor.length === 0 ? (
          <p className="text-xs text-muted italic p-2 bg-bg rounded border border-border">
            No espera a ningún nodo (no hay ninguno elegido o ya no existen).
          </p>
        ) : (
          <ul className="bg-bg rounded border border-border divide-y divide-border">
            {preview.waitedFor.map(n => {
              const { text, hint, className, Icon } = STATE_INFO[n.state];
              return (
                <li key={n.id} className="p-2 flex items-center gap-2 text-xs" title={hint}>
                  <Icon size={14} className={cn('shrink-0', className, n.state === 'pending' && 'animate-spin')} />
                  <span className="font-medium text-fg truncate">{n.label}</span>
                  <span className={cn('ml-auto font-mono text-[10px] shrink-0', className)}>{text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
