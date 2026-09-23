import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Table, Sparkles, Check, Copy } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useAppSelector } from '../../../../store/hooks';
import { getForEachItems } from '../utils';
import type { InspectorProps } from '../types';
import type { Node } from '@xyflow/react';

type ForEachInspectorProps = Pick<InspectorProps, 'node' | 'nodes' | 'edges' | 'updateNodeData'>;

export function ForEachInspector({ node, nodes, edges, updateNodeData }: ForEachInspectorProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const nodeResults = useAppSelector(state => (state as any).flows?.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);

  const copyVariable = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const currentLoopItems = React.useMemo(() => {
    return getForEachItems(node, nodes, edges, nodeResults, intermediateContext);
  }, [node, nodes, edges, nodeResults, intermediateContext]);

  const currentLoopKeys = React.useMemo(() => {
    if (!currentLoopItems || currentLoopItems.length === 0) return [];
    const first = currentLoopItems[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return Object.keys(first);
    }
    return [];
  }, [currentLoopItems]);

  const forEachIncomingProducers = React.useMemo(() => {
    const incoming = edges.filter(e => e.target === node.id);
    return incoming.map(e => nodes.find(n => n.id === e.source)).filter(Boolean) as Node[];
  }, [node, edges, nodes]);

  return (
    <div className="space-y-4">
      {/* Origen de los datos */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Origen de los datos (Array)</span>
          {forEachIncomingProducers.length > 0 && (
            <span className="text-[10px] text-muted font-normal">
              {forEachIncomingProducers.length} conectado(s)
            </span>
          )}
        </label>

        {forEachIncomingProducers.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {forEachIncomingProducers.map(src => {
              const val = `{{${src.id}}}`;
              const isSelected =
                (node.data?.iterateOver as string) === val ||
                (!node.data?.iterateOver && src.id === forEachIncomingProducers[0]?.id);
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => updateNodeData('iterateOver', val)}
                  className={cn(
                    'text-[10px] px-2 py-1 rounded border font-mono transition-colors',
                    isSelected
                      ? 'bg-accent/15 border-accent text-accent font-semibold'
                      : 'bg-surface border-border text-muted hover:text-fg hover:border-border-hover'
                  )}
                >
                  {String(src.data?.label || src.id)} ({src.type})
                </button>
              );
            })}
          </div>
        )}

        <Input
          value={(node.data?.iterateOver as string) || ''}
          onChange={(e) => updateNodeData('iterateOver', e.target.value)}
          placeholder={
            forEachIncomingProducers[0]
              ? `{{${forEachIncomingProducers[0].id}}}`
              : '{{dataList_1}}'
          }
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted">
          {node.data?.iterateOver
            ? `Iterando sobre la referencia: ${node.data.iterateOver}`
            : forEachIncomingProducers[0]
            ? `Auto-detectando array de '${forEachIncomingProducers[0].data?.label || forEachIncomingProducers[0].id}'`
            : 'Referencia al nodo con el array. Ej: {{dataList_1}}'}
        </p>
      </div>

      {/* Visualizador de datos del bucle */}
      <div className="border border-border rounded-md bg-surface p-3 space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-1.5 font-medium text-xs text-fg">
            <Table size={14} className="text-accent" />
            <span>Datos Iniciales del Bucle</span>
          </div>
          {currentLoopItems.length > 0 ? (
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              {currentLoopItems.length} elemento{currentLoopItems.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg text-muted border border-border">
              0 elementos
            </span>
          )}
        </div>

        {currentLoopItems.length > 0 ? (
          <div className="space-y-2.5">
            {/* Campos detectados */}
            {currentLoopKeys.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted block">
                  Campos detectados (haz clic para copiar variable):
                </label>
                <div className="flex flex-wrap gap-1">
                  {currentLoopKeys.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => copyVariable(`{{_item.${k}}}`)}
                      className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-bg border border-border text-fg hover:border-accent hover:text-accent transition-colors"
                      title={`Copiar {{_item.${k}}}`}
                    >
                      <span>{k}</span>
                      {copiedKey === `{{_item.${k}}}` ? (
                        <Check size={10} className="text-emerald-500" />
                      ) : (
                        <Copy size={10} className="text-muted opacity-70" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Previsualización en tabla */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted block">
                Muestra de elementos que recibirá el bucle:
              </label>
              <div className="border border-border rounded overflow-x-auto max-h-44 text-[10px] font-mono bg-bg">
                {currentLoopKeys.length > 0 ? (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-surface border-b border-border text-muted sticky top-0">
                      <tr>
                        <th className="p-1.5 border-r border-border w-8 text-center">#</th>
                        {currentLoopKeys.slice(0, 5).map(col => (
                          <th key={col} className="p-1.5 border-r border-border last:border-r-0 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentLoopItems.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="border-b border-border last:border-b-0 hover:bg-surface/50">
                          <td className="p-1.5 border-r border-border text-center text-muted">{idx + 1}</td>
                          {currentLoopKeys.slice(0, 5).map(col => (
                            <td key={col} className="p-1.5 border-r border-border last:border-r-0 whitespace-nowrap max-w-[120px] truncate">
                              {typeof row?.[col] === 'object' && row?.[col] !== null
                                ? JSON.stringify(row[col])
                                : String(row?.[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <pre className="p-2 text-[10px] select-text">
                    {JSON.stringify(currentLoopItems.slice(0, 3), null, 2)}
                  </pre>
                )}
              </div>
              {currentLoopItems.length > 5 && (
                <p className="text-[9px] text-muted text-right">Mostrando primeros 5 de {currentLoopItems.length} elementos</p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-muted p-2.5 bg-bg/50 border border-border border-dashed rounded text-center space-y-1">
            <p>No se han detectado datos de entrada en memoria todavía.</p>
            <p className="text-[10px] text-muted/80">
              Conecta un nodo previo (Lista de Datos, Consulta SQL o HTTP) y ejecuta el flujo o activa el Modo Debug para capturarlos automáticamente.
            </p>
          </div>
        )}
      </div>

      {/* Guía de mapeo */}
      <div className="p-3 bg-bg border border-border rounded-md text-xs space-y-2">
        <div className="flex items-center gap-1.5 font-medium text-fg">
          <Sparkles size={13} className="text-accent" />
          <span>Mapeo en los nodos siguientes</span>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Los nodos dentro del bucle se ejecutarán una vez por cada elemento. Puedes usar estas expresiones en URLs, Parámetros o Payload:
        </p>
        <div className="space-y-1 font-mono text-[10px]">
          <div className="flex items-center justify-between p-1 bg-surface rounded border border-border">
            <span className="text-accent">{'{{_item.campo}}'}</span>
            <span className="text-muted text-[9px]">Valor del campo en la iteración</span>
          </div>
          <div className="flex items-center justify-between p-1 bg-surface rounded border border-border">
            <span className="text-accent">{'{{_item}}'}</span>
            <span className="text-muted text-[9px]">Objeto completo del elemento</span>
          </div>
          <div className="flex items-center justify-between p-1 bg-surface rounded border border-border">
            <span className="text-accent">{'{{_index}}'}</span>
            <span className="text-muted text-[9px]">Índice actual (0, 1, 2...)</span>
          </div>
          <div className="flex items-center justify-between p-1 bg-surface rounded border border-border">
            <span className="text-accent">{'{{_total}}'}</span>
            <span className="text-muted text-[9px]">Total de elementos a procesar</span>
          </div>
        </div>
      </div>
    </div>
  );
}
