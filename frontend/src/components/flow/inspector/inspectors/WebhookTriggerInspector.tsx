import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Copy, Check } from 'lucide-react';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import { getApiUrl } from '../../../../lib/api';
import type { Node } from '@xyflow/react';

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
  const webhookId = (node.data?.webhookId as string) || node.id;
  const secret = (node.data?.secret as string) || '';
  const [copied, setCopied] = useState(false);

  const fullUrl = getApiUrl(`/flows/webhook/${webhookId}`);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Webhook URL copy box */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>URL Pública del Webhook</span>
          <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-semibold">
            POST
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
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </Button>
        </div>
        <p className="text-[10px] text-muted">
          Envía una solicitud POST con <code>Content-Type: application/json</code> a esta URL para disparar el flujo.
        </p>
      </div>

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

      {/* HMAC Secret */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center justify-between">
          <span>Clave Secreta HMAC (Opcional)</span>
          <span className="text-[10px] text-muted">SHA-256</span>
        </label>
        <Input
          type="password"
          value={secret}
          onChange={(e) => updateNodeData('secret', e.target.value)}
          placeholder="Clave para validar firma..."
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted">
          Si se configura, se exigirá el encabezado <code>x-webhook-signature: sha256=&lt;hash&gt;</code>.
        </p>
      </div>

      {/* Variables usage guide */}
      <div className="p-2.5 bg-bg border border-border rounded text-xs space-y-1">
        <p className="font-medium text-fg">Uso de datos en el flujo:</p>
        <div className="space-y-0.5 font-mono text-[10px] text-muted">
          <p>• Payload completo: <span className="text-accent">{`{{${node.id}.body}}`}</span> o <span className="text-accent">{`{{body}}`}</span></p>
          <p>• Campos específicos: <span className="text-accent">{`{{body.cliente_id}}`}</span></p>
        </div>
      </div>

      {nodeResult && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg">Último payload recibido</label>
          <div className="max-h-48 overflow-auto border border-border rounded p-2 bg-bg text-[11px]">
            <JsonTreeViewer data={nodeResult} />
          </div>
        </div>
      )}
    </div>
  );
}
