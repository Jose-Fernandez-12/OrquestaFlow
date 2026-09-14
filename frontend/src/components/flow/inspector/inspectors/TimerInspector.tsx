import React from 'react';
import { Input } from '../../../ui/input';
import { Clock } from 'lucide-react';
import type { InspectorProps } from '../types';

type TimerInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function TimerInspector({ node, updateNodeData }: TimerInspectorProps) {
  const dur = parseFloat(node.data?.duration as any ?? 10) || 10;
  const u = (node.data?.unit as string) || 'seconds';
  const sec = u === 'minutes' ? dur * 60 : u === 'hours' ? dur * 3600 : dur;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Tiempo de pausa</label>
        <div className="flex gap-2">
          <Input
            type="number"
            min="1"
            className="w-24"
            value={(node.data?.duration as number | undefined) ?? 10}
            onChange={e => updateNodeData('duration', Math.max(1, parseFloat(e.target.value) || 1))}
          />
          <select
            className="flex flex-1 min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
            value={node.data?.unit as string || 'seconds'}
            onChange={e => updateNodeData('unit', e.target.value)}
          >
            <option value="seconds">Segundos</option>
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
          </select>
        </div>
        <p className="text-[10px] text-muted">
          El flujo pausara su ciclo en este punto durante el tiempo configurado y luego continuara automaticamente hacia los nodos conectados.
        </p>
      </div>

      <div className="p-3 bg-bg rounded-sm border border-border flex items-center gap-2 text-xs">
        <Clock size={16} className="text-amber-500 shrink-0" />
        <span>
          Tiempo efectivo:{' '}
          <strong className="text-fg">
            {sec >= 60
              ? `${Math.floor(sec / 60)} min ${sec % 60} s (${sec}s)`
              : `${sec} segundos`}
          </strong>
        </span>
      </div>
    </div>
  );
}
