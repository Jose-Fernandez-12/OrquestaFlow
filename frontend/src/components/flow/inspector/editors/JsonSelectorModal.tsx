import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../ui/button';
import { X } from 'lucide-react';
import { JsonTreeViewer } from '../../JsonTreeViewer';
import { useAppSelector } from '../../../../store/hooks';
import { truncateArrays, extractExportableSample } from '../utils';
import { getApiUrl } from '../../../../lib/api';
import type { Node } from '@xyflow/react';

interface JsonSelectorModalProps {
  node: Node;
  forExportNode?: Node;
  updateNodeData?: (key: string, val: any) => void;
  onSelectValue?: (val: string) => void;
  customLabel?: string;
}

export function JsonSelectorModal({
  node,
  forExportNode,
  updateNodeData,
  onSelectValue,
  customLabel,
}: JsonSelectorModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [jsonData, setJsonData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extractArray, setExtractArray] = useState(false);
  const [extractIterate, setExtractIterate] = useState(false);

  const cachedResult = useAppSelector(
    state => (state as any).flows?.nodeResults?.[node.id] || (state as any).flows?.intermediateContext?.[node.id]
  );

  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const isMultiSelect = !!forExportNode;

  const handleOpen = async () => {
    setIsOpen(true);
    setSelectedPaths([]);

    if (jsonData) return;
    setError('');

    // 1. Use cached Redux result
    if (cachedResult) {
      let resultToDisplay = cachedResult;
      if (node.type === 'query') {
        resultToDisplay = cachedResult.rows || cachedResult.data?.rows || cachedResult;
      }
      if (node.type === 'dataSource' || node.type === 'fileSource') {
        resultToDisplay = cachedResult;
      }
      if (isMultiSelect) {
        resultToDisplay = extractExportableSample(resultToDisplay);
      }
      setJsonData(truncateArrays(resultToDisplay));
      return;
    }

    // dataSource / fileSource without cache
    if (node.type === 'dataSource' || node.type === 'fileSource') {
      if (node.data?.sampleRows && Array.isArray(node.data.sampleRows) && node.data.sampleRows.length > 0) {
        setJsonData(truncateArrays(node.data.sampleRows));
        return;
      }
      if (node.data?.filePath) {
        setLoading(true);
        try {
          const previewRes = await fetch(getApiUrl(`/file-manager/preview?filePath=${encodeURIComponent(node.data.filePath as string)}&limit=10`));
          if (previewRes.ok) {
            const pJson = await previewRes.json();
            if (pJson?.data?.rows) {
              setJsonData(truncateArrays(pJson.data.rows));
              return;
            }
          }
        } catch {} finally {
          setLoading(false);
        }
      }
      setError('Ejecuta el flujo para que este nodo genere sus datos y puedas seleccionarlos aqui.');
      return;
    }

    // dataList
    if (node.type === 'dataList') {
      if (node.data?.items) {
        try {
          const parsed = typeof node.data.items === 'string' ? JSON.parse(node.data.items) : node.data.items;
          setJsonData(truncateArrays(parsed));
          return;
        } catch {
          setError('El JSON de la lista de datos no es valido.');
          return;
        }
      }
      setError('Configura los elementos JSON en el nodo Lista de Datos para visualizarlos aqui.');
      return;
    }

    // forEach / forEachEnd
    if (node.type === 'forEach' || node.type === 'forEachEnd') {
      if (cachedResult) {
        setJsonData(truncateArrays(cachedResult));
        return;
      }
      setError('Ejecuta el flujo o inicia el Modo Debug para capturar los datos del bucle en tiempo real.');
      return;
    }

    // Live fetch
    let endpoint = node.data?.endpoint || '';
    if (node.type === 'query') {
      const queryId = node.data?.queryId;
      if (!queryId) {
        setError('No hay una consulta seleccionada en el nodo.');
        return;
      }
      endpoint = getApiUrl(`/queries/${queryId}/execute`);
    }

    if (!endpoint) {
      setError('No hay un endpoint configurado');
      return;
    }

    if ((endpoint as string).includes('storefront.com') || (!(endpoint as string).startsWith('http') && node.type !== 'query')) {
      setJsonData({
        status: 'success',
        code: 200,
        data: {
          items: [{ id: 'prod_01', name: 'Laptop Pro', price: 1299.99, stock: 45 }],
          pagination: { page: 1, total_pages: 5, total_items: 10 },
        },
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
            parsedParams = JSON.parse(node.data.queryParams as string);
          } catch {}
        }
        res = await fetch(endpoint as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_ids: [], params: parsedParams }),
        });
      } else {
        const method = (node.data?.method as string) || (node.type === 'httpPost' ? 'POST' : 'GET');
        const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        let payloadStr = '';
        if (node.data?.body) payloadStr = node.data.body as string;
        else if (node.data?.payload) payloadStr = JSON.stringify(node.data.payload);
        if (['POST', 'PUT', 'PATCH'].includes(method) && payloadStr) options.body = payloadStr;
        res = await fetch(endpoint as string, options);
      }

      if (!res.ok) {
        let errorMsg = `HTTP Error: ${res.status}`;
        try {
          const errData = await res.clone().json();
          if (errData.error) errorMsg = errData.error;
        } catch {}
        throw new Error(errorMsg);
      }

      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        let resultToDisplay = parsed;
        if (node.type === 'query') resultToDisplay = parsed.data?.rows || [];
        if (isMultiSelect) resultToDisplay = extractExportableSample(resultToDisplay);
        setJsonData(truncateArrays(resultToDisplay));
      } catch {
        setJsonData({ textResponse: text.slice(0, 500) + '...' });
      }
    } catch (err: any) {
      setError(
        err.message?.includes('Timeout') || err.message?.includes('Query execution failed')
          ? 'La consulta fallo (Faltan parametros dinamicos?). Ejecuta el flujo completo primero para visualizar los resultados aqui.'
          : err.message || 'Error al ejecutar la peticion.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSelectKey = (path: string) => {
    let formattedPath = path;
    if (extractIterate || node.type === 'forEach') {
      const lastBracket = path.lastIndexOf('].');
      if (lastBracket !== -1) {
        formattedPath = '_item.' + path.substring(lastBracket + 2);
      } else {
        const lastDot = path.lastIndexOf('.');
        if (lastDot !== -1) formattedPath = '_item.' + path.substring(lastDot + 1);
        else formattedPath = '_item';
      }
    } else if (extractArray) {
      const lastBracket = path.lastIndexOf('[');
      if (lastBracket !== -1) {
        formattedPath = path.substring(0, lastBracket) + '[*]' + path.substring(path.indexOf(']', lastBracket) + 1);
      } else {
        formattedPath = path.replace(/\[\d+\]/g, '[*]');
      }
    }
    const variableFormat = `{{${formattedPath}}}`;
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
    setSelectedPaths(prev => (prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]));
  };

  const handleAutoMapColumns = () => {
    if (!updateNodeData || !forExportNode) return;
    const currentCols = forExportNode.data?.columns || [];
    const newCols = selectedPaths.map(path => {
      let relativeKey = path;
      const bracketIndex = path.lastIndexOf('].');
      if (bracketIndex !== -1) relativeKey = path.substring(bracketIndex + 2);
      else {
        const dotIndex = path.lastIndexOf('.');
        if (dotIndex !== -1) relativeKey = path.substring(dotIndex + 1);
      }
      const headerName = relativeKey.split('.').pop() || relativeKey;
      const capitalized = headerName.charAt(0).toUpperCase() + headerName.slice(1);
      return { header: capitalized, key: relativeKey };
    });
    updateNodeData('columns', [...(currentCols as any[]), ...newCols]);
    alert(`${newCols.length} columnas agregadas correctamente.`);
    setIsOpen(false);
  };

  return (
    <>
      <Button variant="textLink" onClick={handleOpen}>
        {customLabel || 'Visualizar Respuesta (JSON)'}
      </Button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-lg p-6 relative flex flex-col gap-4">
              <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 text-muted hover:text-fg">
                <X size={18} />
              </button>

              <div>
                <h2 className="text-lg font-semibold">
                  {isMultiSelect ? 'Seleccionar columnas' : 'Selector de campos JSON'}
                </h2>
                <p className="text-xs text-muted mt-1">
                  {isMultiSelect
                    ? 'Marca los campos que deseas exportar. Se extraera la llave automaticamente.'
                    : 'Haz clic en cualquier propiedad para copiar su variable de referencia.'}
                </p>
                {!isMultiSelect && (
                  <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="extractArray"
                        className="w-3.5 h-3.5 accent-accent"
                        checked={extractArray}
                        onChange={e => {
                          setExtractArray(e.target.checked);
                          if (e.target.checked) setExtractIterate(false);
                        }}
                      />
                      <label htmlFor="extractArray" className="text-xs font-medium text-muted-foreground select-none cursor-pointer">
                        Extraer como lista completa (Array map [*])
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="extractIterate"
                        className="w-3.5 h-3.5 accent-accent"
                        checked={extractIterate}
                        onChange={e => {
                          setExtractIterate(e.target.checked);
                          if (e.target.checked) setExtractArray(false);
                        }}
                      />
                      <label htmlFor="extractIterate" className="text-xs font-medium text-muted-foreground select-none cursor-pointer">
                        Extraer para Modo Iteracion (usa _item)
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {loading && (
                <div className="text-center p-4 text-sm text-muted">
                  Realizando peticion a {node.data?.endpoint as string}...
                </div>
              )}
              {error && (
                <div className="text-center p-4 text-sm text-danger border border-danger/30 bg-danger/5 rounded-md">
                  {error}
                </div>
              )}
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
