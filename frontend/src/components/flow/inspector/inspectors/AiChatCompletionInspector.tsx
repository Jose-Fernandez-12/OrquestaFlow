import React from 'react';
import { Input } from '../../../ui/input';
import type { Node, Edge } from '@xyflow/react';
import { VariableField } from '../editors/VariableField';
import { JsonTreeViewer } from '../../JsonTreeViewer';

interface AiChatCompletionInspectorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
}

export function AiChatCompletionInspector({
  node,
  nodes,
  edges,
  updateNodeData,
  nodeResult,
}: AiChatCompletionInspectorProps) {
  const endpoint = (node.data?.endpoint as string) || 'https://api.openai.com/v1/chat/completions';
  const model = (node.data?.model as string) || 'gpt-4o-mini';
  const apiKey = (node.data?.apiKey as string) || '';
  const systemPrompt = (node.data?.systemPrompt as string) || '';
  const userPrompt = (node.data?.userPrompt as string) || '';
  const temperature = typeof node.data?.temperature === 'number' ? node.data.temperature : 0.7;
  const responseFormat = (node.data?.responseFormat as string) || 'text';

  const applyPreset = (presetEndpoint: string, presetModel: string) => {
    updateNodeData('endpoint', presetEndpoint);
    updateNodeData('model', presetModel);
  };

  return (
    <div className="space-y-4">
      {/* Presets */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Presets rápidos de proveedor</label>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => applyPreset('https://api.openai.com/v1/chat/completions', 'gpt-4o-mini')}
            className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors"
          >
            OpenAI
          </button>
          <button
            type="button"
            onClick={() => applyPreset('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile')}
            className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors"
          >
            Groq
          </button>
          <button
            type="button"
            onClick={() => applyPreset('https://openrouter.ai/api/v1/chat/completions', 'anthropic/claude-3.5-sonnet')}
            className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors"
          >
            OpenRouter
          </button>
          <button
            type="button"
            onClick={() => applyPreset('https://api.deepseek.com/chat/completions', 'deepseek-chat')}
            className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors"
          >
            DeepSeek
          </button>
          <button
            type="button"
            onClick={() => applyPreset('http://localhost:11434/v1/chat/completions', 'llama3.2')}
            className="text-[10px] px-2 py-1 rounded bg-bg border border-border hover:border-accent hover:text-accent transition-colors"
          >
            Ollama (Local)
          </button>
        </div>
      </div>

      {/* Endpoint & Model */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Endpoint API (Compatible con OpenAI)</label>
          <Input
            value={endpoint}
            onChange={(e) => updateNodeData('endpoint', e.target.value)}
            placeholder="https://api.openai.com/v1/chat/completions"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Modelo</label>
          <Input
            value={model}
            onChange={(e) => updateNodeData('model', e.target.value)}
            placeholder="gpt-4o-mini"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">API Key (Bearer Token)</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => updateNodeData('apiKey', e.target.value)}
            placeholder="sk-... o env:OPENAI_API_KEY"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted">
            Recomendado: <code>env:NOMBRE_VARIABLE</code> para leer la clave del servidor. Las claves escritas aquí no se exportan con el flujo.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Prompt de sistema</label>
        <VariableField
          node={node}
          nodes={nodes}
          edges={edges}
          multiline
          rows={3}
          value={systemPrompt}
          onChange={v => updateNodeData('systemPrompt', v)}
          placeholder="Eres un analista de datos especializado en logística…"
          className="bg-bg"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Prompt del usuario</label>
        <VariableField
          node={node}
          nodes={nodes}
          edges={edges}
          multiline
          rows={6}
          value={userPrompt}
          onChange={v => updateNodeData('userPrompt', v)}
          placeholder={'Resume los hallazgos clave de estos registros:\n{{nodo_anterior}}'}
          className="bg-bg"
        />
        <p className="text-[10px] text-muted">
          Usa el botón <code>{'{ }'}</code> para insertar campos. Listas y objetos se envían como JSON; dentro de un bucle usa <code>{'{{_item.campo}}'}</code>.
        </p>
      </div>

      {/* Parameters: Temperature & Format */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium flex justify-between">
            <span>Temperatura</span>
            <span className="font-mono text-muted">{temperature}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            value={temperature}
            onChange={(e) => updateNodeData('temperature', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Formato de respuesta</label>
          <select
            value={responseFormat}
            onChange={(e) => updateNodeData('responseFormat', e.target.value)}
            className="flex w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
          >
            <option value="text">Texto (Markdown)</option>
            <option value="json_object">JSON Mode (Estructurado)</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Máx. tokens de respuesta</label>
          <Input
            type="number"
            min={1}
            value={node.data?.maxTokens ? String(node.data.maxTokens) : ''}
            onChange={(e) => updateNodeData('maxTokens', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Sin límite"
            className="text-xs font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Tiempo de espera (s)</label>
          <Input
            type="number"
            min={5}
            value={node.data?.timeoutSeconds ? String(node.data.timeoutSeconds) : ''}
            onChange={(e) => updateNodeData('timeoutSeconds', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="120"
            className="text-xs font-mono"
          />
        </div>
      </div>

      {responseFormat === 'json_object' && (
        <p className="text-[10px] text-muted">
          En modo JSON el prompt debe pedir explícitamente una respuesta JSON. El objeto queda disponible en <code>{`{{${node.id}.parsed.campo}}`}</code>.
        </p>
      )}

      {/* Response Preview */}
      {nodeResult && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg flex items-center justify-between">
            <span>Respuesta generada</span>
            {nodeResult?.usage && (
              <span className="text-[10px] font-mono text-muted">
                {String(nodeResult.usage.total_tokens || 0)} tokens
              </span>
            )}
          </label>
          {nodeResult?.parsed ? (
            <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
              <JsonTreeViewer data={nodeResult.parsed} />
            </div>
          ) : (
            <div className="max-h-48 overflow-auto border border-border rounded p-2.5 bg-bg text-xs whitespace-pre-wrap font-mono">
              {String(nodeResult?.content ?? nodeResult?.error ?? JSON.stringify(nodeResult, null, 2))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
