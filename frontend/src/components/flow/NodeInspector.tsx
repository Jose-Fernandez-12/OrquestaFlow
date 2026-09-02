import React, { useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { JsonTreeViewer } from './JsonTreeViewer';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Node, Edge } from '@xyflow/react';
import { useAppSelector } from '../../store/hooks';

interface NodeInspectorProps {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  edges: Edge[];
  selectedNodeId: string;
}

export function NodeInspector({ nodes, setNodes, edges, selectedNodeId }: NodeInspectorProps) {
  const queries = useAppSelector(state => state.queries.queries);
  const node = nodes.find(n => n.id === selectedNodeId);
  
  const selectedQuery = queries.find(q => q.id === (node?.data?.queryId as string));
  
  const detectedParams = React.useMemo(() => {
    if (!selectedQuery?.sql_text) return [];
    const regex = /:([a-zA-Z0-9_]+)/g;
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
  
  const updateNodeData = (key: string, value: any) => {
    setNodes(nds =>
      nds.map(n => {
        if (n.id === selectedNodeId) {
          return { ...n, data: { ...n.data, [key]: value } };
        }
        return n;
      })
    );
  };

  if (!node) {
    return (
      <div className="w-[300px] bg-surface border-l border-border flex flex-col p-4 z-10 shrink-0">
        Nodo no encontrado
      </div>
    );
  }

  return (
    <div className="w-[300px] bg-surface border-l border-border flex flex-col h-full z-10 shrink-0">
      <div className="p-4 border-b border-border font-medium flex items-center justify-between">
        Configuración
        <span className="text-xs text-muted px-2 py-1 bg-bg rounded-sm font-mono">{node.type || 'unknown'}</span>
      </div>
      <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
        
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Etiqueta del nodo</label>
          <Input 
            value={node.data?.label as string || ''} 
            onChange={(e) => updateNodeData('label', e.target.value)} 
          />
        </div>

        {node.type?.startsWith('http') && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Método</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                value={node.data?.method as string || 'GET'}
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
              <label className="text-xs font-medium">Endpoint URL</label>
              <Input 
                value={node.data?.endpoint as string || ''} 
                onChange={(e) => updateNodeData('endpoint', e.target.value)}
                placeholder="https://api.example.com/v1/users/{{start.data.id}}" 
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Headers (JSON)</label>
              <textarea 
                className="flex w-full min-h-[60px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                value={node.data?.headers as string || '{\n  "Content-Type": "application/json"\n}'}
                onChange={(e) => updateNodeData('headers', e.target.value)}
                placeholder={'{\n  "Authorization": "Bearer token"\n}'}
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Query Params (JSON)</label>
              <textarea 
                className="flex w-full min-h-[60px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                value={node.data?.params as string || ''}
                onChange={(e) => updateNodeData('params', e.target.value)}
                placeholder={'{\n  "status": "active"\n}'}
              />
            </div>

            {['POST', 'PUT', 'PATCH'].includes((node.data?.method as string) || 'GET') && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Body / Payload (JSON)</label>
                <textarea 
                  className="flex w-full min-h-[100px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent"
                  value={node.data?.body as string || ''}
                  onChange={(e) => updateNodeData('body', e.target.value)}
                  placeholder={'{\n  "id": "{{start.data.id}}"\n}'}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato de respuesta</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                value={node.data?.responseFormat as string || 'JSON'}
                onChange={(e) => updateNodeData('responseFormat', e.target.value)}
              >
                <option value="JSON">JSON</option>
                <option value="XML">XML</option>
                <option value="Text">Texto plano</option>
              </select>
            </div>
            
            {/* JSON Selector Modal Trigger */}
            <div className="pt-2 border-t border-border mt-2">
              <JsonSelectorTrigger node={node} />
            </div>
          </>
        )}

        {node.type === 'query' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Seleccionar Consulta</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={node.data?.queryId as string || ''}
                onChange={(e) => updateNodeData('queryId', e.target.value)}
              >
                <option value="">Seleccionar consulta...</option>
                {queries.map(q => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Modo de extracción</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent"
                value={node.data?.extractMode as string || 'all'}
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
                  value={node.data?.extractColumns as string || ''}
                  onChange={(e) => updateNodeData('extractColumns', e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Mapeo de Parámetros</label>
              {detectedParams.length > 0 ? (
                <div className="space-y-2 border border-border rounded-sm p-3 bg-bg/50">
                  {detectedParams.map(param => (
                    <div key={param} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-mono font-medium text-accent">:{param}</label>
                        <div className="flex gap-1">
                          {edges
                            .filter(e => e.target === node.id)
                            .map(e => nodes.find(n => n.id === e.source))
                            .filter(n => n && (n.type?.startsWith('http') || n.type === 'query'))
                            .map(upNode => (
                              <JsonSelectorTrigger 
                                key={upNode!.id}
                                node={upNode} 
                                customLabel={`Mapear desde ${upNode!.data?.label || upNode!.type}`}
                                onSelectValue={(val) => {
                                  const newParams = { ...currentParamsObj, [param]: val };
                                  updateNodeData('queryParams', JSON.stringify(newParams, null, 2));
                                }}
                              />
                            ))
                          }
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
                    Escribe un valor fijo para pruebas, o mapea a variables de forma dinámica (ej. <code>{`{{start.data.codigo}}`}</code>).
                  </p>
                </div>
              ) : (
                <div className="text-[10px] text-muted p-3 bg-bg border border-border rounded-sm border-dashed text-center">
                  La consulta no requiere parámetros (:param).
                </div>
              )}
            </div>

            {/* Render JSON Viewer for upstream HTTP/Query nodes to make mapping easier */}
            {edges
              .filter(e => e.target === node.id)
              .map(e => nodes.find(n => n.id === e.source))
              .filter(n => n && (n.type?.startsWith('http') || n.type === 'query'))
              .map(upNode => (
                <div key={upNode!.id} className="pt-2 border-t border-border mt-4">
                  <span className="text-[10px] text-muted block mb-1">Inspeccionar datos desde: {(upNode!.data?.label as string) || upNode!.type}</span>
                  <JsonSelectorTrigger node={upNode} updateNodeData={updateNodeData} />
                </div>
              ))
            }
          </>
        )}

        {node.type === 'scraping' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">URL a scrapear</label>
              <Input 
                value={node.data?.url as string || ''} 
                onChange={(e) => updateNodeData('url', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Script de extracción (.py)</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                value={node.data?.script as string || ''}
                onChange={(e) => updateNodeData('script', e.target.value)}
              >
                <option value="">Seleccionar script...</option>
                <option value="1">extraer_precios.py</option>
                <option value="2">parse_table.py</option>
              </select>
            </div>
          </>
        )}

        {node.type === 'export' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nombre de archivo</label>
              <Input 
                value={node.data?.fileName as string || 'export'} 
                onChange={(e) => updateNodeData('fileName', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Formato</label>
              <select 
                className="flex w-full min-h-[38px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-sm focus-visible:outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/70"
                value={node.data?.format as string || 'CSV'}
                onChange={(e) => updateNodeData('format', e.target.value)}
              >
                <option value="CSV">CSV</option>
                <option value="Excel">Excel (.xlsx)</option>
              </select>
            </div>

            <div className="space-y-1.5 mt-2">
              <label className="text-xs font-medium">Ruta de Colección (Array Base)</label>
              <Input 
                placeholder="{{httpGet_1.data.items}}"
                className="font-mono text-xs"
                value={node.data?.dataSource as string || ''} 
                onChange={(e) => updateNodeData('dataSource', e.target.value)}
              />
              <p className="text-[10px] text-muted leading-tight">Dejar vacío para usar todo el resultado del nodo anterior.</p>
            </div>

            {node.data?.format === 'Excel' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Color de encabezados</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-sm border border-border shrink-0 transition-colors"
                    style={{
                      backgroundColor: (() => {
                        const raw = (node.data?.headerColor as string) || '';
                        const normalized = raw.startsWith('#') ? raw : `#${raw}`;
                        return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(normalized) ? normalized : 'transparent';
                      })()
                    }}
                  />
                  <Input
                    placeholder="#FF5733"
                    className="font-mono text-xs"
                    maxLength={7}
                    value={node.data?.headerColor as string || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const normalized = raw && !raw.startsWith('#') ? `#${raw}` : raw;
                      updateNodeData('headerColor', normalized);
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted leading-tight">Color de fondo en formato hex para la fila de encabezados del reporte.</p>
              </div>
            )}

            <ColumnMappingEditor 
              columns={node.data?.columns as any || []}
              onChange={cols => updateNodeData('columns', cols)}
            />

            {/* Render JSON Viewer for upstream HTTP/Query nodes to make mapping easier */}
            {edges
              .filter(e => e.target === node.id)
              .map(e => nodes.find(n => n.id === e.source))
              .filter(n => n && (n.type?.startsWith('http') || n.type === 'query'))
              .map(upNode => (
                <div key={upNode!.id} className="pt-2 border-t border-border mt-4">
                  <span className="text-[10px] text-muted block mb-1">Inspeccionar datos desde: {(upNode!.data?.label as string) || upNode!.type}</span>
                  <JsonSelectorTrigger node={upNode} forExportNode={node} updateNodeData={updateNodeData} />
                </div>
              ))
            }
          </>
        )}

        <div className="mt-8 pt-4 border-t border-border">
          <Button 
            variant="default" 
            className="w-full text-danger border-danger/20 hover:bg-danger/10 hover:border-danger/30"
            onClick={() => setNodes(nds => nds.filter(n => n.id !== selectedNodeId))}
          >
            Eliminar Nodo
          </Button>
        </div>

      </div>
    </div>
  );
}

function truncateArrays(obj: any): any {
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      // Mantener hasta 3 elementos como referencia para el usuario
      return obj.slice(0, 3).map(truncateArrays);
    }
    return [];
  } else if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = truncateArrays(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function JsonSelectorTrigger({ node, forExportNode, updateNodeData, onSelectValue, customLabel }: { node: any, forExportNode?: any, updateNodeData?: (key: string, val: any) => void, onSelectValue?: (val: string) => void, customLabel?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [jsonData, setJsonData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const cachedResult = useAppSelector(state => (state as any).flows?.nodeResults?.[node.id]);

  // Multi-select state for column auto-mapping
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const isMultiSelect = !!forExportNode;

  const handleOpen = async () => {
    setIsOpen(true);
    setSelectedPaths([]);
    
    // Si ya tenemos los datos cacheados, no volver a hacer la petición
    if (jsonData) return;

    setError('');
    
    // 1. Usar resultado en caché de Redux (si el flujo ya se ejecutó recientemente)
    if (cachedResult) {
      if (node.type === 'query') {
        setJsonData(truncateArrays(cachedResult.rows || cachedResult.data?.rows || cachedResult));
      } else {
        setJsonData(truncateArrays(cachedResult));
      }
      return;
    }
    
    // 2. Si no hay caché, intentar hacer una petición en vivo
    let endpoint = node.data?.endpoint || '';
    if (node.type === 'query') {
      const queryId = node.data?.queryId;
      if (!queryId) {
        setError('No hay una consulta seleccionada en el nodo.');
        return;
      }
      endpoint = `http://localhost:3001/api/queries/${queryId}/execute`;
    }

    if (!endpoint) {
      setError('No hay un endpoint configurado');
      return;
    }

    if (endpoint.includes('storefront.com') || (!endpoint.startsWith('http') && node.type !== 'query')) {
       // use sample mock
       setJsonData({
         status: "success",
         code: 200,
         data: {
           items: [
             { id: "prod_01", name: "Laptop Pro", price: 1299.99, stock: 45 }
           ],
           pagination: { page: 1, total_pages: 5, total_items: 10 }
         }
       });
       return;
    }

    setLoading(true);
    try {
      let res;
      if (node.type === 'query') {
        let parsedParams = {};
        if (node.data?.queryParams) {
          try {
            parsedParams = JSON.parse(node.data.queryParams);
          } catch(e) {
            console.error('Error parsing queryParams JSON for preview', e);
          }
        }
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_ids: [], params: parsedParams })
        });
      } else {
        const method = node.type === 'httpPost' ? 'POST' : 'GET';
        const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (method === 'POST' && node.data?.payload) {
          options.body = JSON.stringify(node.data.payload);
        }
        res = await fetch(endpoint, options);
      }

      if (!res.ok) {
        let errorMsg = `HTTP Error: ${res.status}`;
        try {
          const errData = await res.clone().json();
          if (errData.error) errorMsg = errData.error;
        } catch (e) {}
        throw new Error(errorMsg);
      }
      
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (node.type === 'query') {
          setJsonData(truncateArrays(parsed.data?.rows || []));
        } else {
          setJsonData(truncateArrays(parsed));
        }
      } catch (e) {
        setJsonData({ textResponse: text.slice(0, 500) + '...' });
      }
    } catch (err: any) {
      setError(
        err.message?.includes('Timeout') || err.message?.includes('Query execution failed')
          ? 'La consulta falló (¿Faltan parámetros dinámicos?). Ejecuta el flujo completo primero para visualizar los resultados aquí.'
          : err.message || 'Error al ejecutar la petición.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSelectKey = (path: string) => {
    // path already starts with nodeId (it's the currentPath)
    const variableFormat = `{{${path}}}`;
    setSelectedKey(variableFormat);
    
    if (onSelectValue) {
      onSelectValue(variableFormat);
      setIsOpen(false);
    } else {
      navigator.clipboard.writeText(variableFormat);
      alert(`Copiado al portapapeles: ${variableFormat}`);
    }
  };

  const handleTogglePath = (path: string) => {
    setSelectedPaths(prev => 
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const handleAutoMapColumns = () => {
    if (!updateNodeData || !forExportNode) return;
    
    const currentCols = forExportNode.data?.columns || [];
    
    const newCols = selectedPaths.map(path => {
      // Intentar limpiar el path para obtener solo la clave relativa
      // ej: "response[0].name" -> "name", "response.data.items[0].price" -> "price"
      let relativeKey = path;
      const bracketIndex = path.lastIndexOf('].');
      if (bracketIndex !== -1) {
        relativeKey = path.substring(bracketIndex + 2);
      } else {
        const dotIndex = path.lastIndexOf('.');
        if (dotIndex !== -1) relativeKey = path.substring(dotIndex + 1);
      }

      // El nombre por defecto puede ser la llave capitalizada
      const headerName = relativeKey.split('.').pop() || relativeKey;
      const capitalized = headerName.charAt(0).toUpperCase() + headerName.slice(1);

      return {
        header: capitalized,
        key: relativeKey
      };
    });

    updateNodeData('columns', [...currentCols, ...newCols]);
    alert(`${newCols.length} columnas agregadas correctamente.`);
    setIsOpen(false);
  };

  return (
    <>
      <Button variant="textLink" onClick={handleOpen}>
        {customLabel || 'Visualizar Respuesta (JSON)'}
      </Button>

      {isOpen && createPortal(
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-lg p-6 relative flex flex-col gap-4">
            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-fg"
            >
              <X size={18} />
            </button>

            <div>
              <h2 className="text-lg font-semibold">
                {isMultiSelect ? 'Seleccionar columnas' : 'Selector de campos JSON'}
              </h2>
              <p className="text-xs text-muted mt-1">
                {isMultiSelect 
                  ? 'Marca los campos que deseas exportar. Se extraerá la llave automáticamente.'
                  : 'Haz clic en cualquier propiedad para copiar su variable de referencia.'
                }
              </p>
            </div>

            {loading && <div className="text-center p-4 text-sm text-muted">Realizando petición a {node.data?.endpoint}...</div>}
            {error && <div className="text-center p-4 text-sm text-danger border border-danger/30 bg-danger/5 rounded-md">{error}</div>}
            {!loading && !error && jsonData && (
              <JsonTreeViewer 
                data={jsonData} 
                mode={isMultiSelect ? 'select' : 'copy'}
                onSelectKey={isMultiSelect ? undefined : handleSelectKey}
                currentPath={node.id}
                selectedPaths={selectedPaths}
                onTogglePath={handleTogglePath}
              />
            )}

            {!isMultiSelect && selectedKey && (
              <div className="p-3 bg-bg border border-border rounded-sm">
                <span className="text-xs text-muted block mb-1">Variable seleccionada</span>
                <code className="text-xs text-accent font-semibold">{selectedKey}</code>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-2">
              {isMultiSelect && selectedPaths.length > 0 && (
                <Button variant="primary" size="sm" onClick={handleAutoMapColumns}>
                  Agregar {selectedPaths.length} seleccionadas
                </Button>
              )}
              <Button variant="default" size="sm" onClick={() => setIsOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function ColumnMappingEditor({ columns, onChange }: { columns: { header: string, key: string }[], onChange: (cols: any) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  const addColumn = () => {
    onChange([...(columns || []), { header: '', key: '' }]);
  };

  const updateColumn = (index: number, field: 'header' | 'key', value: string) => {
    const newCols = [...(columns || [])];
    newCols[index] = { ...newCols[index], [field]: value };
    onChange(newCols);
  };

  const removeColumn = (index: number) => {
    const newCols = [...(columns || [])];
    newCols.splice(index, 1);
    onChange(newCols);
  };

  const count = (columns || []).length;

  return (
    <div className="space-y-2 mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium hover:text-accent transition-colors"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          Mapeo de Columnas
          {count > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-mono leading-none">
              {count}
            </span>
          )}
        </button>
        {!collapsed && (
          <Button variant="default" size="sm" onClick={addColumn} className="h-6 text-[10px] px-2 py-0">
            + Agregar
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pb-2">
          {(columns || []).map((col, i) => (
            <div key={i} className="flex gap-2 items-start bg-bg p-2 rounded-sm border border-border">
              <div className="flex-1 space-y-1.5">
                <Input
                  placeholder="Nombre Columna (ej: Precio)"
                  className="h-7 text-xs"
                  value={col.header}
                  onChange={e => updateColumn(i, 'header', e.target.value)}
                />
                <Input
                  placeholder="Llave JSON (ej: price)"
                  className="h-7 text-xs font-mono"
                  value={col.key}
                  onChange={e => updateColumn(i, 'key', e.target.value)}
                />
              </div>
              <Button variant="icon" size="icon" onClick={() => removeColumn(i)} className="text-danger hover:text-danger hover:bg-danger/10 shrink-0 mt-0.5">
                <X size={14} />
              </Button>
            </div>
          ))}
          {(!columns || columns.length === 0) && (
            <div className="text-[10px] text-muted text-center py-4 bg-bg rounded-sm border border-border border-dashed">
              Sin mapeo. Se exportarán todos los campos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
