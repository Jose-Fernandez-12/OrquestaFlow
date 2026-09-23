import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  Database,
  Layers,
  ShieldAlert,
  Loader2,
  KeyRound
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { parseAndInspectFlowBundle, type FlowBundlePreview } from '../../lib/flowImportUtils';
import { useAppDispatch } from '../../store/hooks';
import { importFlowBundle, type Flow, type ImportSummary } from '../../store/flowSlice';
import { fetchConnections } from '../../store/connectionSlice';
import { fetchQueries } from '../../store/querySlice';
import { showToast } from '../../store/uiSlice';

interface ImportFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (flow: Flow, summary: ImportSummary) => void;
}

export function ImportFlowModal({ isOpen, onClose, onSuccess }: ImportFlowModalProps) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FlowBundlePreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [flowName, setFlowName] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFile(null);
    setPreview(null);
    setParseError(null);
    setFlowName('');
    setFlowDescription('');
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setParseError('Por favor selecciona un archivo con extensión .json');
      setSelectedFile(null);
      setPreview(null);
      return;
    }

    setSelectedFile(file);
    setParseError(null);

    try {
      const content = await file.text();
      const fallbackName = file.name.replace(/\.json$/i, '');
      const result = parseAndInspectFlowBundle(content, fallbackName);

      if (!result.success || !result.data) {
        setParseError(result.error || 'No se pudo leer la estructura del flujo.');
        setPreview(null);
        return;
      }

      setPreview(result.data);
      setFlowName(result.data.name);
      setFlowDescription(result.data.description);
    } catch (err: any) {
      setParseError(`Error al leer el archivo: ${err.message || 'Error desconocido'}`);
      setPreview(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleImport = async () => {
    if (!preview) return;

    setIsImporting(true);
    try {
      const payload = {
        ...preview.rawPayload,
        name: flowName.trim() || preview.name,
        description: flowDescription.trim()
      };

      const resultAction = await dispatch(importFlowBundle(payload));

      if (importFlowBundle.fulfilled.match(resultAction)) {
        const { data: createdFlow, summary } = resultAction.payload;

        // Synchronize connections and queries lists in Redux
        dispatch(fetchConnections());
        dispatch(fetchQueries());

        if (summary.requiresCredentials) {
          const connNames = summary.createdConnections.map(c => c.name).join(', ');
          dispatch(
            showToast(
              `Flujo importado con éxito. Se crearon conexiones (${connNames}) que requieren configurar usuario y contraseña en Conexiones.`
            )
          );
        } else {
          dispatch(showToast(`Flujo «${createdFlow.name}» importado correctamente.`));
        }

        if (onSuccess) {
          onSuccess(createdFlow, summary);
        }
        handleClose();
      } else {
        const errMsg = resultAction.error?.message || 'Error al importar el flujo';
        setParseError(errMsg);
      }
    } catch (err: any) {
      setParseError(err.message || 'Error inesperado al importar el flujo');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
      <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-fast">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-accent-light text-accent rounded-md">
              <Upload size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Importar flujo de trabajo</h2>
              <p className="text-xs text-muted">
                Carga un archivo .json exportado para crear el flujo, sus consultas y conexiones.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-muted hover:text-fg p-1 rounded-sm transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* File Upload Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 ${
              dragActive
                ? 'border-accent bg-accent-light/40'
                : selectedFile
                ? 'border-border bg-surface hover:bg-bg/50'
                : 'border-border hover:border-accent/60 bg-bg/30'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <div className="w-11 h-11 rounded-full bg-accent-light text-accent flex items-center justify-center">
              <FileJson size={22} />
            </div>
            <div>
              <div className="text-sm font-medium text-fg">
                {selectedFile ? selectedFile.name : 'Arrastra un archivo JSON aquí o haz clic para seleccionar'}
              </div>
              <p className="text-xs text-muted mt-0.5">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                  : 'Soporta paquetes de OrquestaFlow con flujos, queries y conexiones'}
              </p>
            </div>
          </div>

          {/* Error Message */}
          {parseError && (
            <div className="p-3.5 rounded-md bg-danger/10 border border-danger/20 text-danger text-xs flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{parseError}</div>
            </div>
          )}

          {/* Preview Details */}
          {preview && (
            <div className="space-y-4">
              {/* Flow Metadata Editing */}
              <div className="space-y-3 p-4 rounded-md bg-bg border border-border">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg">Nombre del flujo</label>
                  <Input
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    placeholder="Nombre del flujo"
                    className="bg-surface"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg">Descripción (opcional)</label>
                  <Input
                    value={flowDescription}
                    onChange={(e) => setFlowDescription(e.target.value)}
                    placeholder="Descripción o propósito del flujo"
                    className="bg-surface"
                  />
                </div>
              </div>

              {/* Metrics Card */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card className="p-3 bg-surface border-border flex items-center gap-3">
                  <div className="p-2 rounded bg-accent-light text-accent">
                    <Layers size={16} />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted font-medium">Nodos</div>
                    <div className="text-lg font-semibold text-fg">{preview.nodeCount}</div>
                  </div>
                </Card>

                <Card className="p-3 bg-surface border-border flex items-center gap-3">
                  <div className="p-2 rounded bg-success/10 text-success">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted font-medium">Conexiones</div>
                    <div className="text-lg font-semibold text-fg">{preview.edgeCount}</div>
                  </div>
                </Card>

                <Card className="p-3 bg-surface border-border flex items-center gap-3 col-span-2 sm:col-span-1">
                  <div className="p-2 rounded bg-amber-500/10 text-amber-500">
                    <Database size={16} />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted font-medium">Consultas SQL</div>
                    <div className="text-lg font-semibold text-fg">{preview.queries.length}</div>
                  </div>
                </Card>
              </div>

              {/* Node Types Badges */}
              {preview.nodeTypes.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-muted font-medium">Componentes en el flujo:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.nodeTypes.map((type) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-surface border border-border text-fg"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Database Connections & Security Notice */}
              {preview.requiresCredentials && (
                <div className="p-4 rounded-md bg-amber-500/10 border border-amber-500/25 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-semibold text-amber-500">
                        Atención: Consultas y conexiones a bases de datos detectadas
                      </h4>
                      <p className="text-xs text-muted mt-1 leading-relaxed">
                        Por motivos de seguridad, las contraseñas y usuarios no se transfieren en los archivos JSON.
                        Al importar, el sistema registrará las conexiones y vinculará las consultas SQL. Debes ingresar a
                        la sección de <strong className="text-fg">Conexiones</strong> y configurar las credenciales
                        (usuario y contraseña) antes de ejecutar el flujo.
                      </p>
                    </div>
                  </div>

                  {preview.connections.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-amber-500/20">
                      <span className="text-[11px] font-medium text-fg">Conexiones a registrar / asociar:</span>
                      <div className="space-y-1">
                        {preview.connections.map((c, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-xs bg-surface/80 px-2.5 py-1.5 rounded border border-border"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <Database size={13} className="text-accent shrink-0" />
                              <span className="font-medium truncate">{c.name}</span>
                              <span className="text-muted text-[11px]">
                                ({c.host}{c.database_name ? ` / ${c.database_name}` : ''})
                              </span>
                            </div>
                            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">
                              <KeyRound size={10} />
                              Requiere credenciales
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.queries.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-medium text-fg">Consultas SQL incluidas:</span>
                      <div className="space-y-1">
                        {preview.queries.map((q, i) => (
                          <div
                            key={i}
                            className="text-xs bg-surface/80 px-2.5 py-1.5 rounded border border-border flex items-center justify-between"
                          >
                            <span className="font-medium text-fg truncate">{q.name}</span>
                            <span className="text-muted text-[10px] font-mono shrink-0 ml-2">SQL asociado</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end items-center gap-2 px-6 py-4 border-t border-border shrink-0 bg-surface">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isImporting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={!preview || isImporting}
            className="gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload size={15} />
                Importar flujo
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
