import React, { useEffect, useState, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchScripts, executeScript } from '../../store/scriptSlice';
import { Play, Code, Upload, Terminal, AlertCircle, CheckCircle2, Loader2, Calendar } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

export function ScriptsView() {
  const dispatch = useAppDispatch();
  const { scripts, activeCount, executedToday, loading, executingId } = useAppSelector(state => state.scripts);

  const [filterText, setFilterText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [runLog, setRunLog] = useState<{ [id: string]: { success: boolean; output: string } }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatch(fetchScripts());
  }, [dispatch]);

  const handleRunScript = async (id: string) => {
    try {
      const res = await dispatch(executeScript(id)).unwrap();
      setRunLog(prev => ({
        ...prev,
        [id]: {
          success: res.result.success,
          output: res.result.output || res.result.message || 'Script ejecutado sin logs de salida.'
        }
      }));
    } catch (err: any) {
      setRunLog(prev => ({
        ...prev,
        [id]: {
          success: false,
          output: err.message || 'Error al ejecutar'
        }
      }));
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name.replace(/\.[^/.]+$/, ""));
    formData.append('description', 'Cargado vía interfaz web');

    setUploading(true);
    try {
      const response = await fetch('http://localhost:3001/api/scripts/upload', {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        dispatch(fetchScripts());
      }
    } catch (error) {
      console.error('Error uploading file', error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const filteredScripts = scripts.filter(s =>
    s.name.toLowerCase().includes(filterText.toLowerCase()) ||
    s.description.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scripts de procesamiento</h1>
          <p className="text-sm text-muted">Ejecuta scripts Python o Node.js para normalización de datos y ETLs.</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".py,.js"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Subir Script (.py / .js)
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-4 mb-6 shrink-0">
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs text-muted font-medium">Total de scripts</span>
          <strong className="text-2xl font-semibold mt-1">{scripts.length}</strong>
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs text-muted font-medium">Programaciones activas</span>
          <strong className="text-2xl font-semibold mt-1 text-accent">{activeCount}</strong>
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs text-muted font-medium">Ejecutados hoy</span>
          <strong className="text-2xl font-semibold mt-1 text-success">{executedToday}</strong>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 shrink-0">
        <Input
          placeholder="Buscar script por nombre o descripción..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="max-w-md"
        />
      </div>

      {/* Grid List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && scripts.length === 0 ? (
          <div className="p-8 text-center text-muted">Cargando scripts...</div>
        ) : filteredScripts.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-md text-muted">
            No se encontraron scripts.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filteredScripts.map(script => {
              const isExecuting = executingId === script.id;
              const log = runLog[script.id];

              return (
                <Card key={script.id} className="p-5 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="p-2 bg-accent-light rounded-sm text-accent">
                        <Code size={18} />
                      </div>
                      {script.schedule_cron && (
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted bg-bg px-2 py-0.5 rounded border border-border">
                          <Calendar size={10} />
                          {script.schedule_cron}
                        </div>
                      )}
                    </div>
                    <h2 className="text-base font-semibold mt-3">{script.name}</h2>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{script.description}</p>
                    <div className="text-[10px] text-muted font-mono mt-2 bg-bg px-2 py-1 rounded border border-border/60 inline-block">
                      {script.file_path}
                    </div>
                  </div>

                  {/* Terminal Log Output if executed */}
                  {log && (
                    <div className="bg-fg text-surface text-xs font-mono p-3 rounded border border-border overflow-x-auto max-h-[120px] flex flex-col gap-1">
                      <div className={cn("font-semibold flex items-center gap-1.5", log.success ? "text-success" : "text-danger")}>
                        {log.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {log.success ? 'Ejecución exitosa' : 'Ejecución fallida'}
                      </div>
                      <pre className="whitespace-pre-wrap opacity-80 mt-1 leading-normal">{log.output}</pre>
                    </div>
                  )}

                  <div className="border-t border-border pt-4 flex items-center justify-between text-xs text-muted mt-auto">
                    <span>
                      Última ejecución:{' '}
                      {script.last_run_at ? new Date(script.last_run_at).toLocaleString() : 'Nunca'}
                    </span>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleRunScript(script.id)}
                      disabled={isExecuting}
                      className="gap-2 h-8"
                    >
                      {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      Ejecutar
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
