import React from 'react';
import { Input } from '../../../ui/input';
import type { Node } from '@xyflow/react';

interface AiChatCompletionInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  upstreamNodes: Node[];
  nodeResult?: any;
}

export function AiChatCompletionInspector({
  node,
  updateNodeData,
  upstreamNodes,
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
            placeholder="sk-..."
            className="font-mono text-xs"
          />
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Prompt de Sistema (System Prompt)</label>
        <textarea
          className="flex w-full min-h-[60px] rounded-sm border border-border bg-bg px-2.5 py-2 text-xs font-mono text-fg focus-visible:outline-none focus-visible:border-accent"
          value={systemPrompt}
          onChange={(e) => updateNodeData('systemPrompt', e.target.value)}
          placeholder="Eres un analista de datos especializado en flotas y logística..."
        />
      </div>

      {/* User Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Prompt del Usuario (User Prompt)</span>
          {upstreamNodes.length > 0 && (
            <span className="text-[10px] text-muted">Insertar variables:</span>
          )}
        </label>
        {upstreamNodes.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {upstreamNodes.map(up => (
              <button
                key={up.id}
                type="button"
                onClick={() => updateNodeData('userPrompt', (userPrompt ? userPrompt + '\n' : '') + `{{${up.id}}}`)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-muted hover:text-accent hover:border-accent transition-colors"
              >
                + {String(up.data?.label || up.id)}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="flex w-full min-h-[100px] rounded-sm border border-border bg-bg px-2.5 py-2 text-xs font-mono text-fg focus-visible:outline-none focus-visible:border-accent"
          value={userPrompt}
          onChange={(e) => updateNodeData('userPrompt', e.target.value)}
          placeholder={'Analiza los siguientes registros y resume hallazgos clave:\n{{nodo_anterior}}'}
        />
        <p className="text-[10px] text-muted">
          Soporta interpolación dinámica con <code>{`{{variable}}`}</code> y <code>{`{{_item.campo}}`}</code> dentro de bucles.
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
      </div>

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
          <div className="max-h-48 overflow-auto border border-border rounded p-2.5 bg-bg text-xs whitespace-pre-wrap font-mono">
            {typeof nodeResult?.content === 'object'
              ? JSON.stringify(nodeResult.content, null, 2)
              : String(nodeResult?.content || JSON.stringify(nodeResult, null, 2))}
          </div>
        </div>
      )}
    </div>
  );
}
