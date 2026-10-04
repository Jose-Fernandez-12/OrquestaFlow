import React, { useEffect, useState, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchScripts, type Script } from '../../store/scriptSlice';
import { Play, Code, Upload, AlertCircle, CheckCircle2, Loader2, Calendar, FileCode2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { getApiUrl } from '../../lib/api';
import { ScriptConsoleModal } from './ScriptConsoleModal';

export function ScriptsView() {
  const dispatch = useAppDispatch();
  const { scripts, activeCount, executedToday, loading } = useAppSelector(state => state.scripts);

  const [filterText, setFilterText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [consoleFor, setConsoleFor] = useState<{ script: Script; autoRun: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatch(fetchScripts());
  }, [dispatch]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name.replace(/\.[^/.]+$/, ""));
    formData.append('description', 'Cargado vía interfaz web');

    setUploading(true);
    try {
      const response = await fetch(getApiUrl('/scripts/upload'), {
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

                  <div className="border-t border-border pt-4 flex items-center justify-between gap-2 text-xs text-muted mt-auto">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {script.last_run_status === 'completed' && <CheckCircle2 size={12} className="text-success shrink-0" />}
                      {script.last_run_status && script.last_run_status !== 'completed' && <AlertCircle size={12} className="text-danger shrink-0" />}
                      <span className="truncate">
                        Última ejecución:{' '}
                        {script.last_run_at ? new Date(script.last_run_at).toLocaleString() : 'Nunca'}
                      </span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConsoleFor({ script, autoRun: false })}
                        className="gap-2 h-8"
                        title="Ver el código y la consola sin ejecutar"
                      >
                        <FileCode2 size={12} />
                        Ver código
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setConsoleFor({ script, autoRun: true })}
                        className="gap-2 h-8"
                        title="Ejecutar en la consola interactiva"
                      >
                        <Play size={12} />
                        Ejecutar
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {consoleFor && (
        <ScriptConsoleModal
          script={consoleFor.script}
          autoRun={consoleFor.autoRun}
          onClose={() => setConsoleFor(null)}
          onFinished={() => dispatch(fetchScripts())}
        />
      )}
    </div>
  );
}
