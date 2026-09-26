import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Settings, Columns, Link2, Eye, FileSpreadsheet } from 'lucide-react';
import { useAppSelector } from '../../../../store/hooks';
import { InspectorTabs } from '../InspectorTabs';
import { ColumnMappingEditor } from '../editors/ColumnMappingEditor';
import { JoinMappingEditor } from '../editors/JoinMappingEditor';
import { JsonSelectorModal } from '../editors/JsonSelectorModal';
import { MapSourceButton } from '../editors/MapSourceButton';
import { NodeSourcePicker } from '../editors/NodeSourcePicker';
import { isDataProducerNode, getUpstreamNodes } from '../utils';
import type { InspectorProps, TabDefinition } from '../types';
import type { Node } from '@xyflow/react';

type ExportInspectorProps = Pick<InspectorProps, 'node' | 'nodes' | 'edges' | 'updateNodeData'>;

export function ExportInspector({ node, nodes, edges, updateNodeData }: ExportInspectorProps) {
  const [activeTab, setActiveTab] = useState('general');

  const selectedNodeResult = useAppSelector(
    state => (state as any).flows?.nodeResults?.[node.id]
  );

  const format = (node.data?.format as string) || 'CSV';
  const exportMode = (node.data?.exportMode as string) || 'single';
  const columns = (node.data?.columns as any[]) || [];
  const joins = (node.data?.joins as any[]) || [];

  const tabs: TabDefinition[] = [
    {
      id: 'general',
      label: 'General',
      icon: Settings,
      status: node.data?.fileName ? 'ok' : 'warning',
    },
    {
      id: 'columns',
      label: 'Columnas',
      icon: Columns,
      badge: columns.length > 0 ? columns.length : undefined,
    },
    {
      id: 'joins',
      label: 'Relaciones',
      icon: Link2,
      badge: joins.length > 0 ? joins.length : undefined,
    },
    {
      id: 'preview',
      label: 'Vista Previa',
      icon: Eye,
    },
  ];

  const upstreamDataNodes = React.useMemo(() => {
    return getUpstreamNodes(node, edges, nodes);
  }, [node, edges, nodes]);

  const mainSourceNodeId = React.useMemo(() => {
    return (node.data?.sourceNodeId as string) || (edges.find(e => e.target === node.id)?.source) || upstreamDataNodes[0]?.id;
  }, [node.data?.sourceNodeId, edges, node.id, upstreamDataNodes]);

  const handlePreviewExport = () => {
    window.dispatchEvent(
      new CustomEvent('preview-export-node', {
        detail: {
          id: node.id,
          label: node.data?.label || 'Exportar',
          fileName: node.data?.fileName,
          format: node.data?.format,
          result: selectedNodeResult,
          completed: Boolean(selectedNodeResult),
        },
      })
    );
  };

  return (
    <div className="flex flex-col -m-4">
      <InspectorTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="p-4 space-y-4">
        {/* Tab General */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <label className="text-xs font-medium">Nombre de archivo</label>
                <div className="flex gap-1.5 items-center flex-wrap justify-end">
                  <MapSourceButton nodes={upstreamDataNodes} onSelectValue={(val) => {
                        const current = (node.data?.fileName as string) || '';
                        const nextVal = current && current !== 'export' ? `${current}_${val}` : val;
                        updateNodeData('fileName', nextVal);
                      }} />
                </div>
              </div>
              <Input
                value={(node.data?.fileName as string) ?? 'export'}
                onChange={(e) => updateNodeData('fileName', e.target.value)}
                placeholder="ej. reporte_{{Variables.fechaInicio}} o export"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted leading-relaxed">
                Puedes escribir un nombre fijo o referenciar variables dinámicas usando <code>{'{{Variables.campo}}'}</code> o los botones de mapeo superiores.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato de exportación</label>
              <select
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={format}
                onChange={(e) => updateNodeData('format', e.target.value)}
              >
                <option value="CSV">CSV</option>
                <option value="Excel">Excel (.xlsx)</option>
              </select>
            </div>

            {format === 'Excel' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Modo de Exportación</label>
                <select
                  className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                  value={exportMode}
                  onChange={(e) => updateNodeData('exportMode', e.target.value)}
                >
                  <option value="single">Combinar en una hoja</option>
                  <option value="multi">Múltiples pestañas por nodo</option>
                </select>
              </div>
            )}

            {format === 'Excel' && exportMode === 'multi' ? (
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-semibold text-fg">Configuración de Pestañas</label>
                <p className="text-[10px] text-muted leading-tight">
                  Asigna un nombre de pestaña para cada nodo conectado. Se exportarán todas sus columnas automáticamente.
                </p>
                <div className="space-y-2">
                  {edges
                    .filter(e => e.target === node.id)
                    .map(e => nodes.find(n => n.id === e.source))
                    .filter(Boolean)
                    .map(upNode => {
                      const multiSheetConfig = (node.data?.multiSheetConfig as Record<string, string>) || {};
                      const currentSheetName =
                        multiSheetConfig[upNode!.id] || upNode!.data?.label || upNode!.type;
                      return (
                        <div
                          key={upNode!.id}
                          className="bg-bg p-2.5 rounded border border-border flex flex-col gap-1.5"
                        >
                          <span className="text-[11px] font-medium text-fg truncate">
                            Desde: {(upNode!.data?.label as string) || upNode!.type}
                          </span>
                          <Input
                            className="h-7 text-xs"
                            placeholder="Nombre de la pestaña"
                            value={currentSheetName as string}
                            onChange={(e) => {
                              const newConfig = { ...multiSheetConfig, [upNode!.id]: e.target.value };
                              updateNodeData('multiSheetConfig', newConfig);
                            }}
                          />
                        </div>
                      );
                    })}
                  {edges.filter(e => e.target === node.id).length === 0 && (
                    <div className="text-[10px] text-muted p-3 bg-bg border border-border border-dashed rounded text-center">
                      Conecta nodos a la entrada para configurar sus pestañas.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Nodo Origen de Datos</label>
                  <NodeSourcePicker
                    nodes={upstreamDataNodes}
                    value={(node.data?.sourceNodeId as string) || ''}
                    autoLabel="Auto-detectar"
                    onChange={(selectedId) => {
                      updateNodeData('sourceNodeId', selectedId);
                      updateNodeData('dataSource', selectedId ? `{{${selectedId}}}` : '');
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Ruta de Colección (Array Base)</label>
                  <Input
                    placeholder="{{httpGet_1.data.items}}"
                    className="font-mono text-xs"
                    value={(node.data?.dataSource as string) || ''}
                    onChange={(e) => updateNodeData('dataSource', e.target.value)}
                  />
                  <p className="text-[10px] text-muted leading-tight">
                    Dejar vacío para usar el último nodo conectado.
                  </p>
                </div>

                {format === 'Excel' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Color de encabezados</label>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-sm border border-border shrink-0 transition-colors"
                        style={{
                          backgroundColor: (() => {
                            const raw = (node.data?.headerColor as string) || '';
                            const normalized = raw.startsWith('#') ? raw : `#${raw}`;
                            return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(normalized)
                              ? normalized
                              : 'transparent';
                          })(),
                        }}
                      />
                      <Input
                        placeholder="#FF5733"
                        className="font-mono text-xs"
                        maxLength={7}
                        value={(node.data?.headerColor as string) || ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const normalized = raw && !raw.startsWith('#') ? `#${raw}` : raw;
                          updateNodeData('headerColor', normalized);
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-muted leading-tight">
                      Color de fondo hex para los encabezados de columna.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab Columnas */}
        {activeTab === 'columns' && (
          <div className="space-y-4">
            {format === 'Excel' && exportMode === 'multi' ? (
              <div className="p-3 bg-bg border border-border rounded text-xs text-muted space-y-1">
                <p className="font-medium text-fg">Modo Multi-Pestañas activo</p>
                <p className="text-[11px] leading-relaxed">
                  En este modo cada nodo exporta automáticamente todas sus columnas a su pestaña respectiva.
                </p>
              </div>
            ) : (
              <ColumnMappingEditor
                columns={columns}
                onChange={(cols) => updateNodeData('columns', cols)}
              />
            )}
          </div>
        )}

        {/* Tab Relaciones / Joins */}
        {activeTab === 'joins' && (
          <div className="space-y-4">
            {format === 'Excel' && exportMode === 'multi' ? (
              <div className="p-3 bg-bg border border-border rounded text-xs text-muted space-y-1">
                <p className="font-medium text-fg">Modo Multi-Pestañas activo</p>
                <p className="text-[11px] leading-relaxed">
                  No se requieren joins porque los datos se exportan en pestañas independientes.
                </p>
              </div>
            ) : (
              <JoinMappingEditor
                joins={joins}
                onChange={(newJoins) => updateNodeData('joins', newJoins)}
                upstreamNodes={upstreamDataNodes}
                mainNodeId={mainSourceNodeId}
                nodes={nodes}
                exportNode={node}
              />
            )}
          </div>
        )}

        {/* Tab Vista Previa */}
        {activeTab === 'preview' && (
          <div className="space-y-4">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-full gap-2 text-xs font-medium border-accent/40 text-accent hover:bg-accent/10"
              onClick={handlePreviewExport}
            >
              <Eye size={14} />
              <span>Previsualizar datos exportados</span>
            </Button>

            {upstreamDataNodes.length > 0 && (
              <div className="pt-3 border-t border-border space-y-2">
                <label className="text-xs font-medium block">
                  Inspeccionar datos de nodos conectados
                </label>
                {upstreamDataNodes.map(upNode => (
                  <div
                    key={upNode.id}
                    className="p-2.5 bg-bg border border-border rounded flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileSpreadsheet size={14} className="text-accent shrink-0" />
                      <span className="text-xs font-medium truncate">
                        {(upNode.data?.label as string) || upNode.type}
                      </span>
                    </div>
                    <JsonSelectorModal
                      node={upNode}
                      forExportNode={node}
                      customLabel="Ver JSON"
                      updateNodeData={updateNodeData}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
