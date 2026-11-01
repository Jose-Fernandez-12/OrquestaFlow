import React, { useEffect } from 'react';
import { SquareTerminal, X } from 'lucide-react';
import { Button } from '../ui/button';
import { useAppSelector } from '../../store/hooks';
import { ScriptRunConsole } from './debug/ScriptRunConsole';

interface ScriptConsoleDialogProps {
  nodeId: string;
  label: string;
  onClose: () => void;
}

/**
 * Console of an "Ejecutar script" node, opened with a double click: follows the running script
 * live (or shows the output of its last run) without leaving the canvas.
 */
export function ScriptConsoleDialog({ nodeId, label, onClose }: ScriptConsoleDialogProps) {
  const scriptRun = useAppSelector(state => state.flows.nodeScriptRuns?.[nodeId]);
  const result = useAppSelector(state => state.flows.nodeResults[nodeId]);
  const running = useAppSelector(state => state.flows.executingNodeIds.includes(nodeId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-4xl h-[80vh] flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SquareTerminal size={18} className="text-slate-600 shrink-0" />
            <h2 className="text-base font-semibold truncate">Consola · {label}</h2>
          </div>
          <Button variant="icon" size="icon" onClick={onClose} title="Cerrar (Esc)">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 min-h-0 p-4 flex flex-col">
          {!scriptRun && !result && !running ? (
            <p className="text-sm text-muted">Este nodo aún no se ha ejecutado. Ejecuta el flujo para ver aquí lo que imprime el script.</p>
          ) : (
            <ScriptRunConsole key={scriptRun?.runId ?? 'sin-ejecucion'} runId={scriptRun?.runId} result={result} className="flex-1" />
          )}
        </div>
      </div>
    </div>
  );
}
