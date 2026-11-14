import React, { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { CheckCircle2, AlertCircle, Wand2, Reply } from 'lucide-react';
import { Input } from '../../../ui/input';
import { VariableField } from '../editors/VariableField';
import { JsonTreeViewer } from '../../JsonTreeViewer';

interface WebhookRespondInspectorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
}

const STATUS_PRESETS = [
  { code: 200, label: '200 OK' },
  { code: 201, label: '201 Created' },
  { code: 202, label: '202 Accepted' },
  { code: 204, label: '204 No Content' },
  { code: 400, label: '400 Bad Request' },
  { code: 401, label: '401 Unauthorized' },
  { code: 404, label: '404 Not Found' },
  { code: 422, label: '422 Unprocessable Entity' },
  { code: 500, label: '500 Internal Server Error' },
];

function validateOptionalJson(text: string): { ok: boolean; error?: string } {
  if (!text.trim()) return { ok: true };
  try {
    JSON.parse(text.replace(/\{\{[^}]*\}\}/g, '0'));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || 'JSON inválido') };
  }
}

export function WebhookRespondInspector({
  node,
  nodes,
  edges,
  updateNodeData,
  nodeResult,
}: WebhookRespondInspectorProps) {
  const rawStatusCode = node.data?.statusCode;
  const statusCode = typeof rawStatusCode === 'number' || typeof rawStatusCode === 'string' ? rawStatusCode : 200;
  const headersText = String(node.data?.headers ?? '{\n  "Content-Type": "application/json"\n}');
  const bodyText = String(node.data?.body ?? node.data?.bodyTemplate ?? '');

  const headersValidation = useMemo(() => validateOptionalJson(headersText), [headersText]);
  const bodyValidation = useMemo(() => validateOptionalJson(bodyText), [bodyText]);
  const canFormatBody = bodyText.trim().length > 0 && bodyValidation.ok && !/\{\{[^}]*\}\}/.test(bodyText);

  const formatBodyJson = () => {
    if (!canFormatBody) return;
    try {
      updateNodeData('body', JSON.stringify(JSON.parse(bodyText), null, 2));
    } catch {
      // Ignore formatting if parse fails
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-pink-500/20 bg-pink-500/5 p-2.5 text-[11px] text-muted leading-relaxed">
        <Reply size={14} className="text-pink-600 shrink-0 mt-0.5" />
        <span>
          Envía la respuesta HTTP al cliente cuando el <strong className="text-fg">Webhook Trigger</strong> está en modo síncrono.
        </span>
      </div>

      {/* Status code */}
      <div className="space-y-1.5">
        <label htmlFor="webhook-respond-status-preset" className="text-xs font-medium block">
          Código de estado HTTP
        </label>
        <div className="grid grid-cols-[1fr_92px] gap-2">
          <select
            id="webhook-respond-status-preset"
            aria-label="Preajuste de código de estado HTTP"
            value={STATUS_PRESETS.some(p => p.code === Number(statusCode)) ? String(Number(statusCode)) : 'custom'}
            onChange={(e) => {
              if (e.target.value !== 'custom') {
                updateNodeData('statusCode', Number(e.target.value));
              }
            }}
            className="h-8 rounded-sm border border-border bg-surface px-2 text-xs text-fg focus-visible:outline-none focus-visible:border-accent"
          >
            {STATUS_PRESETS.map(p => (
              <option key={p.code} value={String(p.code)}>
                {p.label}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
          <Input
            type="number"
            min={100}
            max={599}
            aria-label="Código de estado numérico"
            value={statusCode}
            onChange={(e) => {
              const raw = e.target.value;
              updateNodeData('statusCode', raw === '' ? '' : Number(raw));
            }}
            className="h-8 font-mono text-xs text-center"
          />
        </div>
      </div>

      {/* Response Headers */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium">Cabeceras de respuesta (JSON)</label>
          {headersText.trim() && (
            <span className={headersValidation.ok ? 'text-[10px] text-emerald-600 flex items-center gap-1' : 'text-[10px] text-danger flex items-center gap-1'}>
              {headersValidation.ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
              {headersValidation.ok ? 'JSON válido' : 'JSON inválido'}
            </span>
          )}
        </div>
        <VariableField
          node={node}
          nodes={nodes}
          edges={edges}
          multiline
          rows={3}
          value={headersText}
          onChange={(val) => updateNodeData('headers', val)}
          placeholder={'{\n  "Content-Type": "application/json"\n}'}
        />
      </div>

      {/* Response Body Template */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium">Cuerpo de la respuesta (JSON o texto)</label>
          {canFormatBody && (
            <button
              type="button"
              onClick={formatBodyJson}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-accent transition-colors"
            >
              <Wand2 size={11} />
              Formatear JSON
            </button>
          )}
        </div>
        <VariableField
          node={node}
          nodes={nodes}
          edges={edges}
          multiline
          rows={6}
          value={bodyText}
          onChange={(val) => updateNodeData('body', val)}
          placeholder={'{\n  "ok": true,\n  "id": "{{nodo.id}}"\n}'}
        />
        <p className="text-[10px] text-muted">
          Puedes usar expresiones como <code className="text-fg">{'{{nodo.campo}}'}</code> o{' '}
          <code className="text-fg">{'{{$error.message}}'}</code> dentro del cuerpo o las cabeceras.
        </p>
      </div>

      {nodeResult && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg">Última respuesta enviada</label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={nodeResult} />
          </div>
        </div>
      )}
    </div>
  );
}
