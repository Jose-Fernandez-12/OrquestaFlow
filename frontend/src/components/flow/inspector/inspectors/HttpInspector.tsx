import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Globe, ShieldCheck, Send, ArrowDownToLine, Repeat, Plus, Trash2, Wand2 } from 'lucide-react';
import { useAppSelector } from '../../../../store/hooks';
import { InspectorTabs } from '../InspectorTabs';
import { JsonSelectorModal } from '../editors/JsonSelectorModal';
import { KeyValueEditor, repairJsonString } from '../editors/KeyValueEditor';
import { getUpstreamNodes, findParentForEachNode } from '../utils';
import type { InspectorProps, TabDefinition } from '../types';

type HttpInspectorProps = Pick<
  InspectorProps,
  'node' | 'nodes' | 'edges' | 'updateNodeData' | 'setNodes' | 'selectedNodeId'
>;

export function HttpInspector({
  node,
  nodes,
  edges,
  updateNodeData,
  setNodes,
  selectedNodeId,
}: HttpInspectorProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [showRawHeaders, setShowRawHeaders] = useState(false);
  const [showRawBody, setShowRawBody] = useState(true);
  const [showRawParams, setShowRawParams] = useState(false);
  const [newParamKey, setNewParamKey] = useState('');

  const selectedNodeResult = useAppSelector(
    state => (state as any).flows?.nodeResults?.[selectedNodeId]
  );

  const upstreamDataNodes = React.useMemo(() => {
    return getUpstreamNodes(node, edges, nodes);
  }, [node, edges, nodes]);

  const parentForEachNode = React.useMemo(() => {
    return findParentForEachNode(node, edges, nodes);
  }, [node, edges, nodes]);

  const detectedResponseKeys = React.useMemo(() => {
    if (!selectedNodeResult) return [];
    let sample = selectedNodeResult;
    if (Array.isArray(sample) && sample.length > 0) {
      sample = sample[0];
    }
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      return Object.keys(sample);
    }
    return [];
  }, [selectedNodeResult]);

  const method = (node.data?.method as string) || 'GET';
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  const authType = (node.data?.authType as string) || 'none';
  const endpoint = (node.data?.endpoint as string) || '';

  // Parse params
  const paramsJson = (node.data?.params as string) || '';
  const paramsObj = React.useMemo(() => {
    try {
      if (!paramsJson || !paramsJson.trim()) return {};
      const parsed = JSON.parse(paramsJson);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }, [paramsJson]);

  const updateParamValue = (key: string, value: any) => {
    const updated = { ...paramsObj, [key]: value };
    updateNodeData('params', JSON.stringify(updated, null, 2));
  };

  const removeParam = (key: string) => {
    const updated = { ...paramsObj };
    delete updated[key];
    updateNodeData('params', Object.keys(updated).length === 0 ? '' : JSON.stringify(updated, null, 2));
  };

  const addParam = () => {
    const keyToAdd = newParamKey.trim() || `param_${Object.keys(paramsObj).length + 1}`;
    const updated = { ...paramsObj, [keyToAdd]: '' };
    updateNodeData('params', JSON.stringify(updated, null, 2));
    setNewParamKey('');
  };

  // URL Path Parameters Detection ({param_...}, {paramName}, or dynamic {{...}})
  const pathTokens = React.useMemo(() => {
    const unmapped = endpoint.match(/(?<!\{)\{([a-zA-Z0-9_-]+)\}(?!\})/g) || [];
    const mapped = endpoint.match(/\{\{([^{}]+)\}\}/g) || [];
    return {
      unmapped: Array.from(new Set(unmapped)),
      mapped: Array.from(new Set(mapped)),
      total: unmapped.length + mapped.length
    };
  }, [endpoint]);

  const tabs: TabDefinition[] = [
    {
      id: 'general',
      label: 'General',
      icon: Globe,
      status: endpoint ? 'ok' : 'warning',
    },
    {
      id: 'auth',
      label: 'Autenticación',
      icon: ShieldCheck,
      status: authType !== 'none' ? 'ok' : undefined,
    },
    {
      id: 'request',
      label: 'Request',
      icon: Send,
      badge: Object.keys(paramsObj).length > 0 ? Object.keys(paramsObj).length : undefined,
    },
    {
      id: 'response',
      label: 'Respuesta',
      icon: ArrowDownToLine,
      status: node.data?.extractPath ? 'ok' : undefined,
    },
    {
      id: 'iteration',
      label: 'Iteración',
      icon: Repeat,
      status: node.data?.iterateMode || parentForEachNode ? 'ok' : undefined,
    },
  ];

  return (
    <div className="flex flex-col -m-4">
      <InspectorTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="p-4 space-y-4">
        {/* Tab General */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Método HTTP</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm font-semibold focus-visible:outline-none focus-visible:border-accent"
                value={method}
                onChange={(e) => updateNodeData('method', e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium">Endpoint URL</label>
                <div className="flex gap-1">
                  {upstreamDataNodes.map(upNode => (
                    <JsonSelectorModal
                      key={upNode.id}
                      node={upNode}
                      customLabel="Mapear"
                      onSelectValue={(val) => {
                        const current = endpoint;
                        if (/\{param_[^{}]*\}/.test(current)) {
                          updateNodeData('endpoint', current.replace(/\{param_[^{}]*\}/, val));
                        } else if (/(?<!\{)\{[^{}]+\}(?!\})/.test(current)) {
                          updateNodeData('endpoint', current.replace(/(?<!\{)\{[^{}]+\}(?!\})/, val));
                        } else {
                          const sep = current.endsWith('/') || current === '' ? '' : '/';
                          updateNodeData('endpoint', current + sep + val);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
              <Input
                value={endpoint}
                onChange={(e) => {
                  updateNodeData('endpoint', e.target.value);
                }}
                onBlur={(e) => {
                  const newUrl = e.target.value;
                  if (newUrl.includes('?')) {
                    const qIndex = newUrl.indexOf('?');
                    const baseUrl = newUrl.substring(0, qIndex);
                    const queryString = newUrl.substring(qIndex + 1);

                    const searchParams = new URLSearchParams(queryString);
                    let existingParamsObj: Record<string, any> = {};
                    try {
                      if (node.data?.params) {
                        existingParamsObj = JSON.parse(node.data.params as string);
                      }
                    } catch {}

                    const newParamsObj = { ...existingParamsObj };
                    searchParams.forEach((value, key) => {
                      newParamsObj[key] = value;
                    });

                    setNodes(nds =>
                      nds.map(n => {
                        if (n.id === selectedNodeId) {
                          return {
                            ...n,
                            selected: true,
                            data: {
                              ...n.data,
                              endpoint: baseUrl,
                              params: JSON.stringify(newParamsObj, null, 2),
                            },
                          };
                        }
                        return n;
                      })
                    );
                  }
                }}
                placeholder="https://api.example.com/v1/users/{param_id}"
                className="font-mono text-xs"
              />

              {/* Path Parameters in URL Detector (both unmapped and mapped) */}
              {pathTokens.total > 0 && (
                <div className="p-2.5 bg-bg border border-border rounded-md space-y-2 mt-2">
                  <div className="flex items-center justify-between text-xs font-medium text-fg">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-accent/10 text-accent font-mono px-1.5 py-0.5 rounded border border-accent/20">
                        Ruta
                      </span>
                      Parámetros de ruta en URL ({pathTokens.total})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {/* Unmapped tokens ({param_...} or {token}) */}
                    {pathTokens.unmapped.map(token => (
                      <div
                        key={token}
                        className="flex items-center gap-2 bg-surface p-1.5 rounded border border-border"
                      >
                        <span className="text-xs font-mono font-semibold text-accent shrink-0 px-1.5 py-0.5 bg-accent/5 rounded border border-border">
                          {token}
                        </span>
                        <span className="text-[11px] text-muted shrink-0">Mapear con:</span>
                        <div className="flex-1 flex gap-1 items-center justify-end">
                          {upstreamDataNodes.map(upNode => (
                            <JsonSelectorModal
                              key={upNode.id}
                              node={upNode}
                              customLabel="Seleccionar campo"
                              onSelectValue={(val) => {
                                const nextUrl = endpoint.replace(token, val);
                                updateNodeData('endpoint', nextUrl);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Mapped tokens ({{...}}) */}
                    {pathTokens.mapped.map(token => (
                      <div
                        key={token}
                        className="flex items-center gap-2 bg-surface p-1.5 rounded border border-accent/30 bg-accent/5"
                      >
                        <span className="text-xs font-mono font-semibold text-accent shrink-0 px-1.5 py-0.5 bg-surface rounded border border-accent/40" title={token}>
                          {token}
                        </span>
                        <span className="text-[10px] text-emerald-600 font-medium shrink-0">Mapeado</span>
                        <div className="flex-1 flex gap-1 items-center justify-end">
                          {upstreamDataNodes.map(upNode => (
                            <JsonSelectorModal
                              key={upNode.id}
                              node={upNode}
                              customLabel="Cambiar"
                              onSelectValue={(val) => {
                                const nextUrl = endpoint.replace(token, val);
                                updateNodeData('endpoint', nextUrl);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato de respuesta</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={(node.data?.responseFormat as string) || 'JSON'}
                onChange={(e) => updateNodeData('responseFormat', e.target.value)}
              >
                <option value="JSON">JSON</option>
                <option value="XML">XML</option>
                <option value="Text">Texto plano</option>
              </select>
            </div>
          </div>
        )}

        {/* Tab Autenticación */}
        {activeTab === 'auth' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Tipo de Autenticación</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={authType}
                onChange={(e) => updateNodeData('authType', e.target.value)}
              >
                <option value="none">Sin Autenticación</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>

            {authType === 'bearer' && (
              <div className="space-y-2 bg-bg/50 p-3 rounded border border-border">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-accent">Token (Bearer)</label>
                  <div className="flex gap-1">
                    {upstreamDataNodes.map(upNode => (
                      <JsonSelectorModal
                        key={upNode.id}
                        node={upNode}
                        customLabel="Mapear"
                        onSelectValue={(val) => updateNodeData('authToken', val)}
                      />
                    ))}
                  </div>
                </div>
                <Input
                  className="h-8 text-xs font-mono"
                  value={(node.data?.authToken as string) || ''}
                  onChange={(e) => updateNodeData('authToken', e.target.value)}
                  placeholder="Token fijo o {{nodo_login.data.access_token}}"
                />
                <p className="text-[10px] text-muted">
                  Se enviará como encabezado <code>Authorization: Bearer &lt;token&gt;</code>
                </p>
              </div>
            )}

            {authType === 'basic' && (
              <div className="space-y-3 bg-bg/50 p-3 rounded border border-border">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-accent">Usuario</label>
                    <div className="flex gap-1">
                      {upstreamDataNodes.map(upNode => (
                        <JsonSelectorModal
                          key={upNode.id}
                          node={upNode}
                          customLabel="Mapear"
                          onSelectValue={(val) => updateNodeData('authUsername', val)}
                        />
                      ))}
                    </div>
                  </div>
                  <Input
                    className="h-8 text-xs font-mono"
                    value={(node.data?.authUsername as string) || ''}
                    onChange={(e) => updateNodeData('authUsername', e.target.value)}
                    placeholder="Usuario o {{nodo.user}}"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-accent">Contraseña</label>
                    <div className="flex gap-1">
                      {upstreamDataNodes.map(upNode => (
                        <JsonSelectorModal
                          key={upNode.id}
                          node={upNode}
                          customLabel="Mapear"
                          onSelectValue={(val) => updateNodeData('authPassword', val)}
                        />
                      ))}
                    </div>
                  </div>
                  <Input
                    type="password"
                    className="h-8 text-xs font-mono"
                    value={(node.data?.authPassword as string) || ''}
                    onChange={(e) => updateNodeData('authPassword', e.target.value)}
                    placeholder="Contraseña o {{nodo.pass}}"
                  />
                </div>
              </div>
            )}

            {authType === 'none' && (
              <div className="text-xs text-muted p-4 bg-bg border border-border rounded-sm border-dashed text-center">
                Esta petición se enviará sin credenciales de autenticación adicionales.
              </div>
            )}
          </div>
        )}

        {/* Tab Request (Headers, Params, Body) */}
        {activeTab === 'request' && (
          <div className="space-y-5">
            {/* Headers */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium">Headers</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRawHeaders(!showRawHeaders)}
                    className="text-[10px] text-accent hover:underline font-mono"
                  >
                    {showRawHeaders ? 'Vista Guiada' : 'Ver JSON'}
                  </button>
                  <div className="flex gap-1">
                    {upstreamDataNodes.map(upNode => (
                      <JsonSelectorModal
                        key={upNode.id}
                        node={upNode}
                        customLabel="Mapear"
                        onSelectValue={(val) =>
                          updateNodeData('headers', ((node.data?.headers as string) || '') + val)
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>

              {showRawHeaders ? (
                <textarea
                  className="flex w-full min-h-[70px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                  value={
                    (node.data?.headers as string) ||
                    '{\n  "Content-Type": "application/json"\n}'
                  }
                  onChange={(e) => updateNodeData('headers', e.target.value)}
                  placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                />
              ) : (
                <KeyValueEditor
                  hideToggle={true}
                  jsonString={(node.data?.headers as string) || '{\n  "Content-Type": "application/json"\n}'}
                  onChange={(newJson) => updateNodeData('headers', newJson)}
                  keyPlaceholder="Header (ej. Content-Type)"
                  valuePlaceholder="Valor (ej. application/json)"
                  addLabel="Agregar Header"
                />
              )}
            </div>

            {/* Query Params */}
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium">Parámetros de Consulta (Query Params)</label>
                <button
                  type="button"
                  onClick={() => setShowRawParams(!showRawParams)}
                  className="text-[10px] text-accent hover:underline font-mono"
                >
                  {showRawParams ? 'Vista Guiada' : 'Ver JSON'}
                </button>
              </div>

              {showRawParams ? (
                <textarea
                  className="flex w-full min-h-[70px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                  value={paramsJson}
                  onChange={(e) => updateNodeData('params', e.target.value)}
                  placeholder={'{\n  "id": "94",\n  "status": "active"\n}'}
                />
              ) : (
                <div className="space-y-2 border border-border rounded-sm p-2.5 bg-bg/50">
                  {Object.entries(paramsObj).length > 0 ? (
                    Object.entries(paramsObj).map(([key, val]) => (
                      <div
                        key={key}
                        className="flex flex-col gap-1 pb-2 border-b border-border/50 last:border-0 last:pb-0"
                      >
                        <div className="flex justify-between items-center gap-1">
                          <span
                            className="text-[11px] font-mono font-semibold text-accent truncate max-w-[140px]"
                            title={key}
                          >
                            {key}
                          </span>
                          <div className="flex gap-1 items-center">
                            {upstreamDataNodes.map(upNode => (
                              <JsonSelectorModal
                                key={upNode.id}
                                node={upNode}
                                customLabel="Mapear"
                                onSelectValue={(mappedVal) => updateParamValue(key, mappedVal)}
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => removeParam(key)}
                              className="text-muted hover:text-danger p-0.5"
                              title="Eliminar parámetro"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <Input
                          className="h-7 text-xs font-mono"
                          value={typeof val === 'string' ? val : JSON.stringify(val)}
                          onChange={(e) => updateParamValue(key, e.target.value)}
                          placeholder="Valor o {{nodo_1.data.id}}"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-muted text-center py-2 leading-relaxed">
                      No hay parámetros. Escribe en la URL con <code>?key=val</code> o agrégalos abajo.
                    </div>
                  )}

                  <div className="flex gap-1.5 pt-1.5 border-t border-border/50">
                    <Input
                      className="h-7 text-xs font-mono flex-1"
                      placeholder="Nombre del parámetro..."
                      value={newParamKey}
                      onChange={(e) => setNewParamKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addParam();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0 flex items-center gap-1"
                      onClick={addParam}
                    >
                      <Plus size={12} />
                      Agregar
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Body/Payload (for POST/PUT/PATCH) */}
            {hasBody && (
              <div className="space-y-1.5 pt-3 border-t border-border">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium">Body / Payload (JSON)</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const current = (node.data?.body as string) || '';
                        const repaired = repairJsonString(current);
                        if (repaired !== current) {
                          updateNodeData('body', repaired);
                        }
                      }}
                      className="text-[10px] text-muted hover:text-accent flex items-center gap-1 font-mono transition-colors"
                      title="Repara formato de arrays/objetos y remueve comillas escapadas"
                    >
                      <Wand2 size={11} />
                      <span>Reparar JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRawBody(!showRawBody)}
                      className="text-[10px] text-accent hover:underline font-mono"
                    >
                      {showRawBody ? 'Vista Guiada' : 'Ver JSON raw'}
                    </button>
                    <div className="flex gap-1">
                      {upstreamDataNodes.map(upNode => (
                        <JsonSelectorModal
                          key={upNode.id}
                          node={upNode}
                          customLabel="Mapear"
                          onSelectValue={(val) =>
                            updateNodeData('body', ((node.data?.body as string) || '') + val)
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {showRawBody ? (
                  <textarea
                    className="flex w-full min-h-[140px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent leading-relaxed"
                    value={(node.data?.body as string) || ''}
                    onChange={(e) => updateNodeData('body', e.target.value)}
                    placeholder={'{\n  "id": "{{start.data.id}}"\n}'}
                  />
                ) : (
                  <KeyValueEditor
                    hideToggle={true}
                    jsonString={(node.data?.body as string) || ''}
                    onChange={(newJson) => updateNodeData('body', newJson)}
                    keyPlaceholder="Campo (ej. email)"
                    valuePlaceholder="Valor o {{nodo.campo}}"
                    addLabel="Agregar Campo al Payload"
                    emptyMessage="Sin payload definido. Agrega campos clave-valor o cambia a 'Ver JSON raw'."
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab Respuesta */}
        {activeTab === 'response' && (
          <div className="space-y-4">
            {((node.data?.responseFormat as string) || 'JSON') === 'JSON' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-accent">
                    Extraer Propiedad de Respuesta
                  </label>
                  {Boolean(node.data?.extractPath) && (
                    <button
                      type="button"
                      onClick={() => updateNodeData('extractPath', '')}
                      className="text-[10px] text-muted hover:text-red-500 font-mono underline"
                    >
                      Limpiar
                    </button>
                  )}
                </div>

                <select
                  className="flex w-full min-h-[36px] rounded-sm border border-border bg-surface px-[9px] py-[6px] text-xs focus-visible:outline-none focus-visible:border-accent"
                  value={
                    ['', 'data', 'items', 'rows', 'result', 'results'].includes(
                      (node.data?.extractPath as string) || ''
                    ) || detectedResponseKeys.includes((node.data?.extractPath as string) || '')
                      ? (node.data?.extractPath as string) || ''
                      : '__custom__'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__custom__') {
                      if (!node.data?.extractPath) updateNodeData('extractPath', 'data');
                    } else {
                      updateNodeData('extractPath', val);
                    }
                  }}
                >
                  <option value="">Respuesta completa (sin extraer)</option>
                  <option value="data">data (Recomendado para APIs con envoltorio)</option>
                  <option value="items">items</option>
                  <option value="rows">rows</option>
                  <option value="result">result / results</option>
                  {detectedResponseKeys
                    .filter(k => !['data', 'items', 'rows', 'result', 'results'].includes(k))
                    .map(k => (
                      <option key={k} value={k}>
                        {k} (Detectado en respuesta)
                      </option>
                    ))}
                  <option value="__custom__">Escribir JSON Path personalizado...</option>
                </select>

                {!['', 'data', 'items', 'rows', 'result', 'results'].includes(
                  (node.data?.extractPath as string) || ''
                ) &&
                  !detectedResponseKeys.includes((node.data?.extractPath as string) || '') && (
                    <Input
                      className="h-8 text-xs font-mono bg-bg/50"
                      value={(node.data?.extractPath as string) || ''}
                      onChange={(e) => updateNodeData('extractPath', e.target.value)}
                      placeholder="ej. data.records o mi_propiedad"
                    />
                  )}

                <p className="text-[10px] text-muted leading-relaxed">
                  Selecciona <strong>data</strong> para que el flujo reciba directamente los registros
                  internos y no el envoltorio con código de estado.
                </p>
              </div>
            )}

            <div className="pt-3 border-t border-border space-y-2">
              <label className="text-xs font-medium block">Probar y Ejecutar</label>
              <JsonSelectorModal
                node={node}
                customLabel="Probar Petición HTTP (Ejecutar)"
                updateNodeData={updateNodeData}
              />
            </div>

            {upstreamDataNodes.length > 0 && (
              <div className="pt-3 border-t border-border space-y-2">
                <span className="text-[10px] text-muted block">
                  Inspeccionar datos de nodos anteriores:
                </span>
                {upstreamDataNodes.map(upNode => (
                  <div
                    key={upNode.id}
                    className="p-2.5 bg-bg border border-border rounded flex items-center justify-between"
                  >
                    <span className="text-xs font-medium truncate">
                      {(upNode.data?.label as string) || upNode.type}
                    </span>
                    <JsonSelectorModal
                      node={upNode}
                      customLabel="Ver JSON"
                      updateNodeData={updateNodeData}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Iteración */}
        {activeTab === 'iteration' && (
          <div className="space-y-4">
            {parentForEachNode ? (
              <div className="flex items-start gap-2.5 p-3 bg-bg border border-border rounded-md">
                <div className="w-6 h-6 rounded bg-accent/10 text-accent flex items-center justify-center shrink-0 mt-0.5">
                  <Repeat size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-fg">
                    Iteración del bucle activa
                  </div>
                  <div className="text-[11px] text-muted mt-1 leading-relaxed">
                    Este nodo se encuentra dentro de{' '}
                    <strong>{String(parentForEachNode.data?.label || parentForEachNode.id)}</strong> y
                    procesará cada elemento individualmente con{' '}
                    <code className="px-1 py-0.5 bg-surface border border-border rounded text-[10px] font-mono text-accent">
                      {'{{_item}}'}
                    </code>
                    . El modo batch interno se encuentra deshabilitado.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="iterateMode"
                    className="w-3.5 h-3.5 accent-accent"
                    checked={(node.data?.iterateMode as boolean) || false}
                    onChange={(e) => updateNodeData('iterateMode', e.target.checked)}
                  />
                  <label htmlFor="iterateMode" className="text-xs font-medium cursor-pointer">
                    Modo Iteración Interno (Batch)
                  </label>
                </div>

                {Boolean(node.data?.iterateMode) && (
                  <div className="p-3 bg-bg border border-border rounded space-y-2">
                    <label className="text-[11px] font-medium text-fg block">
                      Array base a iterar
                    </label>
                    <div className="flex gap-1">
                      <Input
                        className="h-8 text-xs font-mono flex-1"
                        value={(node.data?.iterateOver as string) || ''}
                        onChange={(e) => updateNodeData('iterateOver', e.target.value)}
                        placeholder="{{ID_NODO}}"
                      />
                      {upstreamDataNodes.map(upNode => (
                        <JsonSelectorModal
                          key={upNode.id}
                          node={upNode}
                          customLabel="Mapear"
                          onSelectValue={(val) => updateNodeData('iterateOver', val)}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted leading-relaxed">
                      Selecciona la lista completa con [*] y luego usa{' '}
                      <code>{'{{_item.propiedad}}'}</code> en la URL, headers o body.
                    </p>
                  </div>
                )}

                {!node.data?.iterateMode && (
                  <p className="text-[11px] text-muted leading-relaxed p-3 bg-bg border border-border rounded border-dashed">
                    Activa el modo de iteración si deseas que esta petición se ejecute múltiples veces por cada elemento de una lista previa.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
