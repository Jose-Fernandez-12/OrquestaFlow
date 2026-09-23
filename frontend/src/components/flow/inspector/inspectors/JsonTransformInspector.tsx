import React from 'react';
import { Input } from '../../../ui/input';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import type { Node } from '@xyflow/react';
import { cn } from '../../../../lib/utils';

interface JsonTransformInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  upstreamNodes: Node[];
  nodeResult?: any;
}

export function JsonTransformInspector({
  node,
  updateNodeData,
  upstreamNodes,
  nodeResult,
}: JsonTransformInspectorProps) {
  const transformType = (node.data?.transformType as string) || 'javascript';
  const inputData = (node.data?.inputData as string) || '';
  const expression = (node.data?.expression as string) || '';
  const pickFields = (node.data?.pickFields as string) || '';

  const insertTemplate = (code: string) => {
    updateNodeData('expression', code);
  };

  return (
    <div className="space-y-4">
      {/* Selector de modo */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Modo de transformación</label>
        <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-bg rounded border border-border">
          <button
            type="button"
            onClick={() => updateNodeData('transformType', 'javascript')}
            className={cn(
              "text-xs py-1.5 px-2 rounded font-medium transition-colors text-center",
              transformType === 'javascript'
                ? "bg-accent/15 text-accent border border-accent/40 font-semibold"
                : "text-muted hover:text-fg"
            )}
          >
            JavaScript Seguro
          </button>
          <button
            type="button"
            onClick={() => updateNodeData('transformType', 'pick')}
            className={cn(
              "text-xs py-1.5 px-2 rounded font-medium transition-colors text-center",
              transformType === 'pick'
                ? "bg-accent/15 text-accent border border-accent/40 font-semibold"
                : "text-muted hover:text-fg"
            )}
          >
            Seleccionar Claves (Pick)
          </button>
        </div>
      </div>

      {/* Origen de datos */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Origen de datos a transformar</span>
          <span className="text-[10px] text-muted">Opcional (auto-detecta previo)</span>
        </label>
        {upstreamNodes.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {upstreamNodes.map(up => (
              <button
                key={up.id}
                type="button"
                onClick={() => updateNodeData('inputData', `{{${up.id}}}`)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-accent hover:border-accent transition-colors"
              >
                + {String(up.data?.label || up.id)}
              </button>
            ))}
          </div>
        )}
        <Input
          value={inputData}
          onChange={(e) => updateNodeData('inputData', e.target.value)}
          placeholder="{{nodo_anterior}} o dejar vacío"
          className="font-mono text-xs"
        />
      </div>

      {transformType === 'javascript' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Expresión JavaScript</label>
            <span className="text-[10px] text-muted font-mono">retorna el nuevo resultado</span>
          </div>

          <div className="flex flex-wrap gap-1 mb-1">
            <button
              type="button"
              onClick={() => insertTemplate("return data.map(item => ({\n  id: item.id,\n  etiqueta: item.nombre\n}));")}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-fg"
            >
              Mapear array
            </button>
            <button
              type="button"
              onClick={() => insertTemplate("return data.filter(item => Boolean(item.activo));")}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-fg"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={() => insertTemplate("return {\n  totalRegistros: Array.isArray(data) ? data.length : 1,\n  procesadoEn: new Date().toISOString()\n};")}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-fg"
            >
              Resumen
            </button>
          </div>

          <textarea
            className="flex w-full min-h-[160px] rounded-sm border border-border bg-bg px-2.5 py-2 text-xs font-mono text-fg focus-visible:outline-none focus-visible:border-accent"
            value={expression}
            onChange={(e) => updateNodeData('expression', e.target.value)}
            placeholder={'// "data" contiene el resultado anterior\n// "context" contiene todas las variables\nreturn data.map(x => ({ id: x.id, title: x.name }));'}
          />
          <p className="text-[10px] text-muted">
            Ejecución aislada y segura en sandbox. Puedes acceder a <code>data</code> y al objeto <code>context</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Claves / Columnas a conservar</label>
          <Input
            value={pickFields}
            onChange={(e) => updateNodeData('pickFields', e.target.value)}
            placeholder="id, nombre, email, total"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted">
            Ingresa los nombres de campos separados por coma. Aplica a objetos y a arrays de objetos.
          </p>
        </div>
      )}

      {nodeResult && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg">Resultado transformado</label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={nodeResult} />
          </div>
        </div>
      )}
    </div>
  );
}
