import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ResolvedReference {
  expression: string;
  value: any;
  missing: boolean;
  masked?: boolean;
}

function formatValue(value: any): string {
  if (value === undefined) return 'sin valor';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return JSON.stringify(value);
}

/** Each {{reference}} a node uses and the value it took in this step; missing ones are highlighted. */
export function ResolvedReferences({ references }: { references?: ResolvedReference[] }) {
  if (!references || references.length === 0) return null;
  const missing = references.filter(r => r.missing).length;

  return (
    <div className="p-3 bg-surface rounded-md border border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-fg">Referencias resueltas</span>
        <span className={cn('text-[10px] font-mono', missing > 0 ? 'text-rose-600' : 'text-muted')}>
          {missing > 0 ? `${missing} sin valor de ${references.length}` : `${references.length} referencias`}
        </span>
      </div>
      <div className="bg-bg rounded border border-border overflow-hidden">
        <table className="w-full text-left text-xs font-mono">
          <tbody>
            {references.map(ref => (
              <tr key={ref.expression} className={cn('border-b border-border last:border-b-0', ref.missing && 'bg-rose-500/5')}>
                <td className="p-2 text-accent border-r border-border w-2/5 break-all align-top">{`{{${ref.expression}}}`}</td>
                <td className={cn('p-2 break-all align-top', ref.missing ? 'text-rose-600 italic' : 'text-fg')}>
                  {ref.missing && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                  {formatValue(ref.value)}
                  {ref.masked && <span className="ml-2 text-[10px] text-muted not-italic">(oculto)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing > 0 && (
        <p className="text-[11px] text-rose-600">
          Las referencias sin valor quedan vacías o se omiten (un parámetro sin valor no se agrega a la URL). Revisa el nombre del nodo o la ruta del campo.
        </p>
      )}
    </div>
  );
}
