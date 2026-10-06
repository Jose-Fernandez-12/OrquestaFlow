import { useRef, useState, type ReactNode } from 'react';
import { X, Upload, FileCode2, FileText, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { ConsoleOutput, type ConsoleChunk } from '../ui/ConsoleOutput';
import { getApiUrl } from '../../lib/api';
import { cn } from '../../lib/utils';
import { apiRequest, followEnvJob, type EnvJob } from './pythonEnvApi';

interface UploadScriptDialogProps {
  /** The base environment is ready, so the dependencies can be installed right away */
  environmentReady: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

type Step = 'choose' | 'working' | 'done';

function FilePicker({ label, hint, accept, file, icon, onPick, optional }: {
  label: string; hint: string; accept: string; file: File | null; icon: ReactNode; onPick: (f: File | null) => void; optional?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
      className={cn('cursor-pointer rounded-md border border-dashed p-4 flex items-center gap-3 transition-colors',
        file ? 'border-accent/50 bg-accent-light/40' : 'border-border hover:border-accent/50 hover:bg-bg')}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => onPick(e.target.files?.[0] ?? null)} />
      <div className="p-2 rounded bg-surface border border-border text-muted shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{label}{optional && <span className="font-normal text-muted"> (opcional)</span>}</div>
        <div className="text-[11px] text-muted truncate">{file ? file.name : hint}</div>
      </div>
      {file && (
        <button type="button" onClick={e => { e.stopPropagation(); onPick(null); if (ref.current) ref.current.value = ''; }} className="p-1 rounded text-muted hover:text-fg" title="Quitar">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Upload a script and, for Python, the requirements.txt with its dependencies */
export function UploadScriptDialog({ environmentReady, onClose, onUploaded }: UploadScriptDialogProps) {
  const [script, setScript] = useState<File | null>(null);
  const [requirements, setRequirements] = useState<File | null>(null);
  const [prepareNow, setPrepareNow] = useState(true);
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Array<{ line: string; reason: string }>>([]);
  const [output, setOutput] = useState<ConsoleChunk[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const isPython = !!script && /\.py$/i.test(script.name);

  const submit = async () => {
    if (!script) { setError('Elige el archivo del script (.py o .js).'); return; }
    if (!/\.(py|js)$/i.test(script.name)) { setError('El script debe ser un archivo .py o .js.'); return; }
    if (requirements && !isPython) { setError('El requirements.txt solo aplica a scripts Python.'); return; }
    setError(null);
    setStep('working');
    try {
      const form = new FormData();
      form.append('file', script);
      const res = await fetch(getApiUrl('/scripts/upload'), { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'No se pudo subir el script');
      const created = json.data as { id: string; name: string };
      onUploaded();

      if (requirements && isPython) {
        const result = await apiRequest<{ imported: number; ignored: Array<{ line: string; reason: string }> }>(
          `/scripts/${created.id}/dependencies/import`, 'POST', { text: await requirements.text(), mode: 'replace' },
        );
        setIgnored(result.ignored);
        setSummary(`«${created.name}» subido con ${result.imported} paquete(s).`);
        if (prepareNow && environmentReady && result.imported > 0) {
          const job = await followEnvJob(() => apiRequest<EnvJob>(`/scripts/${created.id}/environment`, 'POST'), setOutput);
          setSummary(job.status === 'completed'
            ? `«${created.name}» subido y con sus dependencias instaladas.`
            : `«${created.name}» subido, pero la instalación falló: ${job.error || 'revisa la salida'}. Puedes reintentar desde su pestaña Dependencias.`);
          onUploaded();
        }
      } else {
        setSummary(`«${created.name}» subido.`);
      }
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('choose');
    }
  };

  const working = step === 'working';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget && !working) onClose(); }}>
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-lg max-h-[88vh] flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="p-2 bg-accent-light rounded-sm text-accent shrink-0"><Upload size={16} /></div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">Subir script</h2>
            <p className="text-[11px] text-muted">Python o Node.js. Para Python puedes adjuntar su requirements.txt.</p>
          </div>
          <Button variant="icon" size="icon" onClick={onClose} disabled={working} title="Cerrar"><X size={16} /></Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {step === 'choose' && (
            <>
              <FilePicker label="Script" hint="Arrastra o elige un archivo .py o .js" accept=".py,.js" file={script} icon={<FileCode2 size={16} />} onPick={f => { setScript(f); setError(null); }} />
              {(!script || isPython) && (
                <FilePicker label="requirements.txt" hint="Un paquete por línea, como para pip install -r" accept=".txt" file={requirements} icon={<FileText size={16} />} onPick={f => { setRequirements(f); setError(null); }} optional />
              )}
              {requirements && isPython && (
                <label className={cn('flex items-start gap-2 text-xs', !environmentReady && 'opacity-60')}>
                  <input type="checkbox" checked={prepareNow && environmentReady} disabled={!environmentReady} onChange={e => setPrepareNow(e.target.checked)} className="mt-0.5" />
                  <span>
                    Instalar las dependencias ahora
                    <span className="block text-[11px] text-muted">
                      {environmentReady
                        ? 'Se instalan en el entorno compartido o, si alguna versión choca, en un entorno propio del script.'
                        : 'Primero hay que preparar el entorno base; se instalarán al ejecutarlo por primera vez.'}
                    </span>
                  </span>
                </label>
              )}
              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          )}

          {step !== 'choose' && (
            <>
              <div className="flex items-center gap-2 text-sm">
                {working ? <Loader2 size={16} className="animate-spin text-accent" /> : <CheckCircle2 size={16} className="text-success" />}
                <span>{working ? 'Subiendo e instalando…' : summary}</span>
              </div>
              {ignored.length > 0 && (
                <div className="p-3 rounded-md border border-warn/40 bg-warn/10 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={12} className="text-warn" /> Líneas que no se importaron</div>
                  {ignored.map(i => (
                    <div key={i.line} className="flex gap-2"><code className="font-mono truncate">{i.line}</code><span className="text-muted shrink-0">— {i.reason}</span></div>
                  ))}
                </div>
              )}
              {output.length > 0 && <ConsoleOutput chunks={output} emptyText="" className="h-48 rounded-md" />}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2 shrink-0">
          {step === 'done' ? (
            <Button variant="primary" size="sm" onClick={onClose} className="h-8 min-h-0 text-xs">Listo</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={working} className="h-8 min-h-0 text-xs">Cancelar</Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={working || !script} className="h-8 min-h-0 gap-1.5 text-xs">
                {working ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Subir
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
