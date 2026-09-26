import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Copy, Check } from 'lucide-react';
import type { Node } from '@xyflow/react';

interface OAuth2ConnectorInspectorProps {
  node: Node;
  updateNodeData: (key: string, value: any) => void;
  nodeResult?: any;
}

export function OAuth2ConnectorInspector({
  node,
  updateNodeData,
  nodeResult,
}: OAuth2ConnectorInspectorProps) {
  const grantType = (node.data?.grantType as string) || 'client_credentials';
  const tokenUrl = (node.data?.tokenUrl as string) || '';
  const clientId = (node.data?.clientId as string) || '';
  const clientSecret = (node.data?.clientSecret as string) || '';
  const scope = (node.data?.scope as string) || '';
  const username = (node.data?.username as string) || '';
  const password = (node.data?.password as string) || '';
  const refreshToken = (node.data?.refreshToken as string) || '';

  const authMethod = (node.data?.authMethod as string) === 'basic' ? 'basic' : 'body';
  const cacheToken = node.data?.cacheToken !== false;

  const [copiedToken, setCopiedToken] = useState(false);
  const tokenVar = `{{${node.id}.authorization_header}}`;

  const handleCopyVar = () => {
    navigator.clipboard.writeText(tokenVar);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Grant Type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Tipo de Concesión (Grant Type)</label>
        <select
          value={grantType}
          onChange={(e) => updateNodeData('grantType', e.target.value)}
          className="flex w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
        >
          <option value="client_credentials">Client Credentials</option>
          <option value="password">Resource Owner Password</option>
          <option value="refresh_token">Refresh Token</option>
        </select>
      </div>

      {/* Token URL */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Token Endpoint URL</label>
        <Input
          value={tokenUrl}
          onChange={(e) => updateNodeData('tokenUrl', e.target.value)}
          placeholder="https://auth.ejemplo.com/oauth/v2/token"
          className="font-mono text-xs"
        />
      </div>

      {/* Client ID & Secret */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Client ID</label>
          <Input
            value={clientId}
            onChange={(e) => updateNodeData('clientId', e.target.value)}
            placeholder="cliente-id-api"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Client Secret</label>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => updateNodeData('clientSecret', e.target.value)}
            placeholder="secreto o env:NOMBRE_VARIABLE"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted">
            Usa <code>env:MI_SECRETO</code> para leerlo de las variables de entorno del servidor; los secretos escritos aquí no se incluyen al exportar el flujo.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Envío de credenciales del cliente</label>
          <select
            value={authMethod}
            onChange={(e) => updateNodeData('authMethod', e.target.value)}
            className="flex w-full h-8 rounded-sm border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
          >
            <option value="body">En el cuerpo (client_id / client_secret)</option>
            <option value="basic">Cabecera Authorization: Basic</option>
          </select>
        </div>
      </div>

      {/* Scope */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Alcance (Scope opcional)</label>
        <Input
          value={scope}
          onChange={(e) => updateNodeData('scope', e.target.value)}
          placeholder="read write offline_access"
          className="font-mono text-xs"
        />
      </div>

      {/* Password grant fields */}
      {grantType === 'password' && (
        <div className="space-y-3 p-2.5 bg-bg border border-border rounded">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Usuario (Username)</label>
            <Input
              value={username}
              onChange={(e) => updateNodeData('username', e.target.value)}
              placeholder="usuario@dominio.com"
              className="text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Contraseña (Password)</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => updateNodeData('password', e.target.value)}
              placeholder="••••••••"
              className="text-xs"
            />
          </div>
        </div>
      )}

      {/* Refresh token field */}
      {grantType === 'refresh_token' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Refresh Token</label>
          <Input
            type="password"
            value={refreshToken}
            onChange={(e) => updateNodeData('refreshToken', e.target.value)}
            placeholder="Token de refresco previo..."
            className="font-mono text-xs"
          />
        </div>
      )}

      <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={cacheToken}
          onChange={(e) => updateNodeData('cacheToken', e.target.checked)}
          className="accent-accent mt-0.5"
        />
        <span>
          Reutilizar el token mientras no expire
          <span className="block text-[10px] text-muted">Evita pedir un token nuevo en cada iteración de un bucle o en cada ejecución.</span>
        </span>
      </label>

      <div className="p-2.5 bg-bg border border-border rounded text-xs space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-medium text-fg">Valor para la cabecera Authorization:</span>
          <button
            type="button"
            onClick={handleCopyVar}
            className="text-[10px] text-accent hover:underline flex items-center gap-1 font-mono"
          >
            {copiedToken ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
            Copiar
          </button>
        </div>
        <div className="p-1.5 bg-surface border border-border rounded font-mono text-[11px] text-accent select-all">
          {tokenVar}
        </div>
      </div>

      {/* Token status */}
      {nodeResult?.access_token && (
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-xs space-y-1">
          <p className="font-semibold text-emerald-600 flex items-center gap-1">
            <Check size={13} /> {nodeResult.from_cache ? 'Token reutilizado de la caché' : 'Token obtenido'}
          </p>
          <p className="text-[11px] text-muted">
            Tipo: {String(nodeResult.token_type || 'Bearer')} | Expira en: {String(nodeResult.expires_in || 3600)}s | Obtenido: {String(nodeResult.acquired_at || '').replace('T', ' ').slice(0, 19)}
          </p>
        </div>
      )}
    </div>
  );
}
