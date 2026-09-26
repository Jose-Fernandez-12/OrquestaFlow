import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Database, Sliders, Layers, Eye, Copy, Check, X, AlignLeft } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { format as formatSql } from 'sql-formatter';
import { useAppSelector } from '../../../../store/hooks';
import { InspectorTabs } from '../InspectorTabs';
import { JsonSelectorModal } from '../editors/JsonSelectorModal';
import { MapSourceButton } from '../editors/MapSourceButton';
import { getUpstreamNodes } from '../utils';
import type { InspectorProps, TabDefinition } from '../types';

type QueryInspectorProps = Pick<InspectorProps, 'node' | 'nodes' | 'edges' | 'updateNodeData'>;

export function QueryInspector({ node, nodes, edges, updateNodeData }: QueryInspectorProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [showSqlModal, setShowSqlModal] = useState(false);

  const queries = useAppSelector(state => state.queries.queries);
  const selectedQuery = queries.find(q => q.id === (node?.data?.queryId as string));

  const detectedParams = React.useMemo(() => {
    if (!selectedQuery?.sql_text) return [];
    const regex = /(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const params = new Set<string>();
    let match;
    while ((match = regex.exec(selectedQuery.sql_text)) !== null) {
      params.add(match[1]);
    }
    return Array.from(params);
  }, [selectedQuery]);

  const currentParamsObj = React.useMemo(() => {
    try {
      return JSON.parse((node?.data?.queryParams as string) || '{}');
    } catch {
      return {};
    }
  }, [node?.data?.queryParams]);

  const upstreamDataNodes = React.useMemo(() => {
    return getUpstreamNodes(node, edges, nodes);
  }, [node, edges, nodes]);

  const tabs: TabDefinition[] = [
    {
      id: 'general',
      label: 'Consulta',
      icon: Database,
      status: selectedQuery ? 'ok' : 'warning',
    },
    {
      id: 'params',
      label: 'Parámetros',
      icon: Sliders,
      badge: detectedParams.length > 0 ? detectedParams.length : undefined,
    },
    {
      id: 'upstream',
      label: 'Datos Entrada',
      icon: Layers,
      badge: upstreamDataNodes.length > 0 ? upstreamDataNodes.length : undefined,
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
              <label className="text-xs font-medium">Seleccionar Consulta</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={(node.data?.queryId as string) || ''}
                onChange={(e) => updateNodeData('queryId', e.target.value)}
              >
                <option value="">Seleccionar consulta...</option>
                {queries.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedQuery && (
              <div className="flex items-center justify-between text-xs pt-0.5">
                <span className="text-[11px] text-muted truncate max-w-[190px]">
                  {detectedParams.length > 0
                    ? `${detectedParams.length} ${detectedParams.length === 1 ? 'parámetro detectado' : 'parámetros detectados'}`
                    : 'Sin parámetros requeridos'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium px-2 py-1 rounded bg-accent/5 hover:bg-accent/10 border border-accent/20 transition-colors"
                  title="Ver sentencia SQL completa"
                >
                  <Eye size={12} />
                  <span>Ver query</span>
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Modo de extracción</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={(node.data?.extractMode as string) || 'all'}
                onChange={(e) => updateNodeData('extractMode', e.target.value)}
              >
                <option value="all">Todas las filas (Array)</option>
                <option value="selected_columns">Solo columnas específicas</option>
              </select>
            </div>

            {node.data?.extractMode === 'selected_columns' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Columnas (separadas por coma)</label>
                <Input
                  placeholder="ej. codigo_eds, nombre_eds"
                  value={(node.data?.extractColumns as string) || ''}
                  onChange={(e) => updateNodeData('extractColumns', e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Tab Parámetros */}
        {activeTab === 'params' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Mapeo de Parámetros SQL</label>
              {detectedParams.length > 0 ? (
                <div className="space-y-2 border border-border rounded-sm p-3 bg-bg/50">
                  {detectedParams.map(param => (
                    <div key={param} className="flex flex-col gap-1 pb-2 border-b border-border/50 last:border-0 last:pb-0">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] font-mono font-medium text-accent">
                          #param_{param}
                        </label>
                        <div className="flex gap-1">
                          <MapSourceButton nodes={upstreamDataNodes} onSelectValue={(val) => {
                                const newParams = { ...currentParamsObj, [param]: val };
                                updateNodeData('queryParams', JSON.stringify(newParams, null, 2));
                              }} />
                        </div>
                      </div>
                      <Input
                        className="h-7 text-xs font-mono"
                        placeholder="Valor fijo o {{ruta}}"
                        value={currentParamsObj[param] || ''}
                        onChange={(e) => {
                          const newParams = { ...currentParamsObj, [param]: e.target.value };
                          updateNodeData('queryParams', JSON.stringify(newParams, null, 2));
                        }}
                      />
                    </div>
                  ))}
                  <p className="text-[10px] text-muted leading-tight mt-2">
                    Escribe un valor fijo o mapea a variables dinámicas (ej. <code>{'{{start.data.codigo}}'}</code>).
                  </p>
                </div>
              ) : (
                <div className="text-[10px] text-muted p-4 bg-bg border border-border rounded-sm border-dashed text-center">
                  La consulta seleccionada no requiere parámetros (#param_nombre).
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Upstream */}
        {activeTab === 'upstream' && (
          <div className="space-y-3">
            <label className="text-xs font-medium block">
              Inspeccionar datos desde nodos anteriores
            </label>
            {upstreamDataNodes.length > 0 ? (
              upstreamDataNodes.map(upNode => (
                <div
                  key={upNode.id}
                  className="p-3 bg-bg border border-border rounded flex items-center justify-between"
                >
                  <div>
                    <span className="text-xs font-medium block text-fg">
                      {(upNode.data?.label as string) || upNode.type}
                    </span>
                    <span className="text-[10px] text-muted font-mono">{upNode.id}</span>
                  </div>
                  <JsonSelectorModal
                    node={upNode}
                    customLabel="Ver JSON"
                    updateNodeData={updateNodeData}
                  />
                </div>
              ))
            ) : (
              <div className="text-[10px] text-muted p-4 bg-bg border border-border rounded-sm border-dashed text-center">
                Conecta un nodo previo a este para inspeccionar su estructura JSON.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal para ver la consulta SQL completa */}
      {showSqlModal && selectedQuery && (
        <SqlQueryModal
          isOpen={showSqlModal}
          onClose={() => setShowSqlModal(false)}
          queryName={selectedQuery.name}
          sqlText={selectedQuery.sql_text}
          connectionId={selectedQuery.connection_ids}
        />
      )}
    </div>
  );
}

function SqlQueryModal({
  isOpen,
  onClose,
  queryName,
  sqlText,
  connectionId,
}: {
  isOpen: boolean;
  onClose: () => void;
  queryName: string;
  sqlText: string;
  connectionId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [isFormatted, setIsFormatted] = useState(false);

  const formattedConnection = React.useMemo(() => {
    if (!connectionId) return '';
    try {
      const parsed = JSON.parse(connectionId);
      if (Array.isArray(parsed)) return parsed.join(', ');
      return String(parsed);
    } catch {
      return String(connectionId);
    }
  }, [connectionId]);

  const displaySql = React.useMemo(() => {
    if (!isFormatted) return sqlText;
    try {
      return formatSql(sqlText, { language: 'tsql', keywordCase: 'upper' });
    } catch {
      return sqlText;
    }
  }, [sqlText, isFormatted]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(displaySql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-fg/40 animate-fade-in backdrop-blur-xs">
      <div className="bg-surface border border-border rounded-lg shadow-raised w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3.5 border-b border-border flex items-center justify-between shrink-0 bg-bg/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded bg-accent/10 text-accent shrink-0">
              <Database size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg truncate">{queryName}</h3>
              {formattedConnection && (
                <p className="text-[11px] text-muted truncate font-mono">Bases de datos: {formattedConnection}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFormatted(prev => !prev)}
              className="text-xs h-7 px-2 gap-1.5"
              title="Alternar formato con sangría y mayúsculas"
            >
              <AlignLeft size={13} />
              <span>{isFormatted ? 'Original' : 'Formatear SQL'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs h-7 px-2 gap-1.5"
              title="Copiar sentencia SQL"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-bg text-muted hover:text-fg transition-colors ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* CodeMirror SQL Editor matching Consultas BD */}
        <div className="p-4 flex-1 overflow-y-auto bg-bg/20">
          <div className="border border-border rounded-sm overflow-hidden bg-bg focus-within:border-accent">
            <CodeMirror
              value={displaySql}
              height="520px"
              extensions={[sql()]}
              theme="light"
              className="text-xs font-mono border-0 [&_.cm-editor]:text-xs [&_.cm-scroller]:font-mono [&_.cm-content]:text-xs [&_.cm-line]:text-xs"
              readOnly={true}
              editable={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between shrink-0 bg-bg/40">
          <span className="text-[11px] text-muted font-mono">
            Solo lectura • Sintaxis SQL idéntica al visor de Consultas BD
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={onClose}
            className="text-xs"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
