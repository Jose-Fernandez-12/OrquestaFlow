import { AlertCircle, ArrowRight, MinusCircle, SquareTerminal } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ScriptPreview {
  kind: 'script';
  script: { id: string; name: string; fileName: string } | null;
  argv: string[];
  rows: Array<{ flag: string; value: string; argv: string[] }>;
  commandLength: number;
  maxCommandLength: number;
  input: { mode: 'file' | 'stdin'; format: 'json' | 'lines'; lines: number; chars: number; text: string } | null;
}

const quote = (arg: string) => (arg === '' || /\s|"/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** "Ejecutar script" paused before running: the command it will run and where each argument came from */
export function ScriptPreviewPanel({ preview }: { preview: ScriptPreview }) {
  const tooLong = preview.commandLength > preview.maxCommandLength;
  const sent = preview.rows.filter(r => r.argv.length > 0);
  const skipped = preview.rows.filter(r => r.argv.length === 0);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/20">
      <div className="p-3 bg-surface rounded-md border border-border flex items-center gap-3">
        <span className="w-8 h-8 rounded bg-accent/10 text-accent flex items-center justify-center shrink-0">
          <SquareTerminal size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg">{preview.script ? preview.script.name : 'Script no encontrado'}</div>
          <div className="text-[11px] text-muted">
            {preview.script
              ? 'Así se va a ejecutar, con las variables ya resueltas. Al continuar, la salida aparece en «Consola».'
              : 'El script seleccionado ya no existe en la sección Scripts: el nodo fallará.'}
          </div>
        </div>
      </div>

      <div className="p-3 bg-surface rounded-md border border-border space-y-2">
        <span className="text-xs font-semibold text-fg">Comando</span>
        <pre className="p-2.5 bg-fg text-surface/90 rounded text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">
          {[preview.script?.fileName || 'script', ...preview.argv.map(quote)].join(' ')}
        </pre>
        {tooLong && (
          <p className="text-[11px] text-rose-600 flex items-start gap-1.5">
            <AlertCircle size={12} className="shrink-0 mt-px" />
            Los argumentos suman {preview.commandLength.toLocaleString('es')} caracteres y superan el límite de Windows: el nodo fallará.
            Envía la lista como «Archivo temporal».
          </p>
        )}
      </div>

      {preview.rows.length > 0 && (
        <div className="p-3 bg-surface rounded-md border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg">Argumentos</span>
            <span className="text-[10px] text-muted">
              {sent.length} se envían{skipped.length > 0 ? ` · ${skipped.length} vacíos` : ''}
            </span>
          </div>
          <ul className="bg-bg rounded border border-border divide-y divide-border">
            {preview.rows.map((row, i) => {
              const omitted = row.argv.length === 0;
              const values = row.flag && row.argv[0] === row.flag ? row.argv.slice(1) : row.argv;
              return (
                <li key={i} className={cn('p-2 text-xs space-y-1', omitted && 'opacity-60')}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold text-fg shrink-0">{row.flag || '(posicional)'}</span>
                    <span className="font-mono text-[11px] text-muted truncate" title={row.value}>{row.value}</span>
                  </div>
                  {omitted ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <MinusCircle size={11} /> Quedó vacío: no se envía
                    </div>
                  ) : values.length === 0 ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <ArrowRight size={11} className="text-accent" /> Opción sin valor: se envía
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 text-[11px]">
                      <ArrowRight size={11} className="text-accent shrink-0 mt-0.5" />
                      <span className="font-mono text-fg break-all">
                        {values.length > 1 ? `${values.length} valores: ` : ''}
                        {values.slice(0, 30).map(quote).join(' ')}
                        {values.length > 30 ? ` … (+${values.length - 30})` : ''}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {preview.input && (
        <div className="p-3 bg-surface rounded-md border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg">
              Datos del nodo anterior · {preview.input.mode === 'file' ? 'archivo temporal' : 'entrada estándar'}
            </span>
            <span className="text-[10px] text-muted">
              {preview.input.format === 'lines' ? `${preview.input.lines} línea${preview.input.lines === 1 ? '' : 's'}` : 'JSON'} ·{' '}
              {preview.input.chars.toLocaleString('es')} caracteres
            </span>
          </div>
          {preview.input.chars === 0 ? (
            <p className="text-xs text-amber-600 italic p-2 bg-bg rounded border border-border">Está vacío: el script no recibirá datos.</p>
          ) : (
            <pre className="p-2 bg-bg rounded border border-border text-[11px] font-mono whitespace-pre-wrap break-all max-h-56 overflow-auto">
              {preview.input.text}
              {preview.input.chars > preview.input.text.length ? '\n…' : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
