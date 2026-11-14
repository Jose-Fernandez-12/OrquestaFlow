import React, { useCallback, useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Copy, Check, ChevronDown, RefreshCw, Loader2, ShieldCheck } from 'lucide-react';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import { getApiUrl, readApiResponse } from '../../../../lib/api';
import { copyToClipboard } from '../../../../lib/clipboard';
import { parseDbDate } from '../../../scripts/scriptDisplay';
import { useAppSelector } from '../../../../store/hooks';
import { cn } from '../../../../lib/utils';
import type { Node } from '@xyflow/react';

interface WebhookLogEntry {
  id: string;
  method?: string;
  status_code?: number;
  created_at?: string;
  idempotency_key?: string | null;
  headers_json?: string | Record<string, any> | null;
  query_json?: string | Record<string, any> | null;
  body_json?: string | Record<string, any> | null;
  response_json?: string | Record<string, any> | null;
}

const HTTP_METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'ANY'] as const;

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

interface WebhookTriggerInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
}

export function WebhookTriggerInspector({
  node,
  updateNodeData,
  nodeResult,
}: WebhookTriggerInspectorProps) {
  const flowId = useAppSelector(state => state.flows.currentFlow?.id);
  const webhookId = (node.data?.webhookId as string) || node.id;
  const secret = (node.data?.secret as string) || '';
  const httpMethod = String(node.data?.httpMethod || 'POST');
  const responseMode = node.data?.responseMode === 'sync' ? 'sync' : 'async';
  const idempotencyEnabled = node.data?.idempotencyEnabled !== false;

  const [copied, setCopied] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebhookLogEntry[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fullUrl = getApiUrl(`/flows/webhook/${webhookId}`);

  const handleCopy = async () => {
    const ok = await copyToClipboard(fullUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fetchLogs = useCallback(async () => {
    if (!flowId) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await fetch(getApiUrl(`/flows/${flowId}/webhook-logs`));
      const data = await readApiResponse<any>(res, 'No se pudo cargar el historial del webhook');
      const entries = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : Array.isArray(data?.data) ? data.data : [];
      setLogs(entries);
    } catch (err: any) {
      setLogsError(err?.message || 'Error al cargar llamadas del webhook');
    } finally {
      setLogsLoading(false);
    }
  }, [flowId]);

  const toggleLogs = () => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) void fetchLogs();
  };

  return (
    <div className="space-y-4">
      {/* Webhook URL copy box */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>URL Pública del Webhook</span>
          <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-semibold">
            {httpMethod}
          </span>
        </label>
        <div className="flex gap-1.5">
          <Input
            readOnly
            value={fullUrl}
            className="font-mono text-xs bg-bg select-all text-fg"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCopy}
            className="shrink-0 text-xs px-2.5"
            aria-label="Copiar URL del webhook"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </Button>
        </div>
        <p className="text-[10px] text-muted">
          Envía una solicitud <code>{httpMethod}</code> a esta URL para disparar el flujo.
        </p>
      </div>

      {/* HTTP method & Response mode */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="webhook-http-method" className="text-xs font-medium block">
            Método HTTP
          </label>
          <select
            id="webhook-http-method"
            aria-label="Método HTTP del webhook"
            value={httpMethod}
            onChange={(e) => updateNodeData('httpMethod', e.target.value)}
            className="w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs text-fg focus-visible:outline-none focus-visible:border-accent"
          >
            {HTTP_METHODS.map(m => (
              <option key={m} value={m}>
                {m === 'ANY' ? 'ANY (Cualquiera)' : m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="webhook-response-mode" className="text-xs font-medium block">
            Modo de respuesta
          </label>
          <select
            id="webhook-response-mode"
            aria-label="Modo de respuesta del webhook"
            value={responseMode}
            onChange={(e) => updateNodeData('responseMode', e.target.value)}
            className="w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs text-fg focus-visible:outline-none focus-visible:border-accent"
          >
            <option value="async">Asíncrono (202 inmediato)</option>
            <option value="sync">Síncrono (esperar Responder Webhook)</option>
          </select>
        </div>
      </div>

      {responseMode === 'sync' && (
        <p className="text-[10px] text-pink-600 bg-pink-500/5 border border-pink-500/20 rounded px-2.5 py-1.5 leading-relaxed">
          Modo síncrono activo: conecta un nodo <strong>Responder Webhook</strong> en la rama principal o de error para devolver estado y cuerpo al cliente HTTP.
        </p>
      )}

      {/* Idempotency toggle */}
      <label className="flex items-start gap-2 p-2.5 rounded border border-border bg-bg/50 cursor-pointer hover:border-border-hover">
        <input
          type="checkbox"
          checked={idempotencyEnabled}
          onChange={(e) => updateNodeData('idempotencyEnabled', e.target.checked)}
          className="mt-0.5 rounded border-border accent-accent"
        />
        <div className="space-y-0.5 text-xs">
          <span className="font-medium text-fg flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-accent" />
            Idempotencia por cabecera <code className="text-[10px] font-mono">Idempotency-Key</code>
          </span>
          <p className="text-[10px] text-muted leading-relaxed">
            Evita ejecuciones duplicadas cuando el emisor reintenta la misma llamada con el mismo <code className="text-fg">Idempotency-Key</code>.
          </p>
        </div>
      </label>

      {/* Webhook ID / Slug */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Identificador del Webhook (Slug / ID)</label>
        <Input
          value={node.data?.webhookId as string || ''}
          onChange={(e) => updateNodeData('webhookId', e.target.value)}
          placeholder={node.id}
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted">
          Ruta personalizada para identificar el webhook en el sistema.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Secreto (recomendado)</span>
          <span className="text-[10px] text-muted">HMAC SHA-256 o Bearer</span>
        </label>
        <Input
          type="password"
          value={secret}
          onChange={(e) => updateNodeData('secret', e.target.value)}
          placeholder="Secreto compartido con el emisor"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted leading-relaxed">
          Con secreto, cada petición debe traer <code>x-webhook-signature: sha256=&lt;HMAC del cuerpo&gt;</code> o{' '}
          <code>Authorization: Bearer &lt;secreto&gt;</code>; si no, se rechaza con 401. Sin secreto, cualquiera que conozca la URL
          puede disparar el flujo.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Payload de prueba (JSON)</span>
          <span className="text-[10px] text-muted">para ejecuciones manuales</span>
        </label>
        <textarea
          value={String(node.data?.samplePayload ?? '')}
          onChange={(e) => updateNodeData('samplePayload', e.target.value)}
          placeholder={'{\n  "cliente_id": 123,\n  "estado": "pagado"\n}'}
          className="flex w-full min-h-[90px] rounded-sm border border-border bg-bg px-2.5 py-2 text-xs font-mono text-fg focus-visible:outline-none focus-visible:border-accent"
        />
        <p className="text-[10px] text-muted">
          Al ejecutar desde el editor (normal o debug) el nodo entrega este cuerpo, así puedes mapear sus campos sin esperar una llamada real.
        </p>
      </div>

      <div className="p-2.5 bg-bg border border-border rounded text-xs space-y-1">
        <p className="font-medium text-fg">Uso de datos en el flujo:</p>
        <div className="space-y-0.5 font-mono text-[10px] text-muted">
          <p>• Cuerpo completo: <span className="text-accent">{`{{${node.id}.body}}`}</span></p>
          <p>• Un campo: <span className="text-accent">{`{{${node.id}.body.cliente_id}}`}</span></p>
          <p>• Query string: <span className="text-accent">{`{{${node.id}.query.param}}`}</span></p>
        </div>
      </div>

      {nodeResult && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg">{nodeResult.manual ? 'Payload de prueba usado' : 'Último payload recibido'}</label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={nodeResult} />
          </div>
        </div>
      )}

      {/* Collapsible recent webhook calls */}
      {flowId && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={toggleLogs}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-bg/60 hover:bg-bg text-xs font-semibold text-fg transition-colors"
          >
            <span>Últimas llamadas recibidas</span>
            <ChevronDown size={14} className={cn('text-muted transition-transform', logsOpen && 'rotate-180')} />
          </button>

          {logsOpen && (
            <div className="p-2.5 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted">Últimas 50 peticiones al endpoint</span>
                <button
                  type="button"
                  onClick={() => void fetchLogs()}
                  disabled={logsLoading}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-accent hover:underline disabled:opacity-50"
                >
                  {logsLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Actualizar
                </button>
              </div>

              {logsError && (
                <p className="text-[11px] text-danger bg-danger/5 border border-danger/20 rounded px-2 py-1.5">
                  {logsError}
                </p>
              )}

              {!logsLoading && !logsError && logs.length === 0 && (
                <p className="text-[11px] text-muted text-center py-3">
                  Sin llamadas registradas todavía.
                </p>
              )}

              {logs.length > 0 && (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {logs.map(entry => {
                    const isExpanded = expandedLogId === entry.id;
                    const parsedBody = tryParseJson(entry.body_json);
                    const parsedResponse = tryParseJson(entry.response_json);
                    const status = entry.status_code ?? 200;
                    return (
                      <div key={entry.id} className="border border-border rounded bg-surface">
                        <button
                          type="button"
                          onClick={() => setExpandedLogId(isExpanded ? null : entry.id)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-bg/60"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono font-semibold text-[10px] px-1 py-px rounded bg-bg border border-border">
                              {entry.method || 'POST'}
                            </span>
                            <span
                              className={cn(
                                'font-mono text-[10px] px-1 py-px rounded font-semibold',
                                status >= 400
                                  ? 'bg-red-500/10 text-red-600'
                                  : 'bg-emerald-500/10 text-emerald-600'
                              )}
                            >
                              {status}
                            </span>
                            {entry.idempotency_key && (
                              <span className="text-[9px] font-mono text-muted truncate" title={`Idempotency-Key: ${entry.idempotency_key}`}>
                                #{entry.idempotency_key.slice(0, 8)}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted shrink-0">
                            {parseDbDate(entry.created_at)?.toLocaleString('es-CO', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              day: '2-digit',
                              month: '2-digit',
                            }) ?? ''}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="p-2 border-t border-border bg-bg/40 space-y-2 text-[10px]">
                            {parsedBody !== null && parsedBody !== undefined && (
                              <div>
                                <div className="font-semibold text-muted mb-1">Body recibido</div>
                                <div className="max-h-32 overflow-auto">
                                  <JsonTreeViewer data={parsedBody} />
                                </div>
                              </div>
                            )}
                            {parsedResponse !== null && parsedResponse !== undefined && (
                              <div>
                                <div className="font-semibold text-muted mb-1">Respuesta devuelta</div>
                                <div className="max-h-32 overflow-auto">
                                  <JsonTreeViewer data={parsedResponse} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
