import React, { useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Loader2, Plus, ScanSearch, Trash2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { apiRequest } from '../../../scripts/pythonEnvApi';
import { VariableField } from '../editors/VariableField';
import { mergeDetectedArgs, valuePlaceholder, type ArgRow, type DetectedArg } from './runScriptArgs';

interface RunScriptArgsEditorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  rows: ArgRow[];
  onChange: (rows: ArgRow[]) => void;
  scriptId?: string;
  scriptFileName?: string;
}

const isTemplate = (v: string) => v.includes('{{');

export function RunScriptArgsEditor({ node, nodes, edges, rows, onChange, scriptId, scriptFileName }: RunScriptArgsEditorProps) {
  const [detecting, setDetecting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const update = (idx: number, patch: Partial<ArgRow>) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { flag: '', value: '' }]);

  const detect = async () => {
    if (!scriptId) return;
    setDetecting(true);
    setNotice(null);
    try {
      const detected = await apiRequest<DetectedArg[]>(`/scripts/${scriptId}/arguments`);
      if (detected.length === 0) {
        setNotice({ tone: 'warn', text: 'El script no declara argumentos con argparse (add_argument). Agrégalos a mano.' });
        return;
      }
      const merged = mergeDetectedArgs(rows, detected);
      const added = merged.length - rows.length;
      onChange(merged);
      setNotice({
        tone: 'ok',
        text: added > 0
          ? `Se agregaron ${added} argumento${added === 1 ? '' : 's'} del script. Los que dejes vacíos no se envían.`
          : 'Los argumentos ya estaban; se actualizó su descripción.',
      });
    } catch (err: any) {
      setNotice({ tone: 'warn', text: err?.message || 'No se pudieron leer los argumentos del script.' });
    } finally {
      setDetecting(false);
    }
  };

  // What will run, with the templates still unresolved
  const preview = rows
    .filter(r => (r.kind === 'switch' ? r.flag.trim() : r.value.trim()))
    .flatMap(r => {
      const flag = r.flag.trim();
      if (r.kind === 'switch') return [{ text: flag, template: isTemplate(r.value) }];
      if (flag.endsWith('=')) return [{ text: `${flag}${r.value}`, template: isTemplate(r.value) }];
      return [...(flag ? [{ text: flag, template: false }] : []), { text: r.value, template: isTemplate(r.value) }];
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium">Argumentos</label>
        <button
          type="button"
          onClick={detect}
          disabled={!scriptId || detecting}
          className="text-[10px] text-accent hover:underline disabled:text-muted disabled:no-underline flex items-center gap-1"
          title={scriptId ? 'Lee los add_argument() del script' : 'Selecciona primero un script'}
        >
          {detecting ? <Loader2 size={10} className="animate-spin" /> : <ScanSearch size={10} />} Detectar del script
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="px-2.5 py-2 rounded-sm border border-dashed border-border text-[11px] text-muted">
          Sin argumentos. Usa «Detectar del script» o agrega uno.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const isSwitch = row.kind === 'switch';
            return (
              <div key={idx} className="space-y-1 p-2 rounded-sm border border-border bg-bg/40">
                <div className="flex items-center gap-1.5">
                  <input
                    value={row.flag}
                    onChange={e => update(idx, { flag: e.target.value.trim() })}
                    placeholder="--opción"
                    title="Opción del script (--tickets, -f…). Vacía para un argumento posicional."
                    className="h-8 w-[104px] shrink-0 rounded-sm border border-border bg-surface px-2 text-xs font-mono text-fg placeholder:text-muted focus-visible:outline-none focus-visible:border-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <VariableField
                      node={node}
                      nodes={nodes}
                      edges={edges}
                      value={row.value}
                      onChange={v => update(idx, { value: v })}
                      placeholder={valuePlaceholder(row)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="p-1 text-muted hover:text-danger shrink-0"
                    title="Quitar argumento"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-muted">
                  <span className="flex-1 min-w-0 truncate" title={row.hint}>
                    {row.required && <span className="text-amber-600 font-medium">Obligatorio · </span>}
                    {!row.flag && !row.hint ? 'Posicional' : row.hint}
                  </span>
                  {!isSwitch && isTemplate(row.value) && (
                    <span className="flex items-center gap-1 shrink-0" title="Cómo llega una lista de valores al script">
                      Lista:
                      {(['comma', 'separate'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => update(idx, { list: mode })}
                          className={cn(
                            'px-1 rounded border',
                            (row.list ?? 'comma') === mode ? 'border-accent/50 bg-accent/10 text-accent' : 'border-transparent hover:text-fg'
                          )}
                        >
                          {mode === 'comma' ? 'a,b,c' : 'a b c'}
                        </button>
                      ))}
                    </span>
                  )}
                  <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Opción sin valor, como --verbose (action=store_true)">
                    <input
                      type="checkbox"
                      checked={isSwitch}
                      onChange={e => update(idx, { kind: e.target.checked ? 'switch' : 'value' })}
                      className="h-3 w-3"
                    />
                    Sin valor
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" onClick={add} className="text-[10px] text-accent hover:underline flex items-center gap-1">
        <Plus size={10} /> Agregar argumento
      </button>

      {notice && (
        <p className={cn('text-[10px] leading-relaxed', notice.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600')}>{notice.text}</p>
      )}

      <p className="text-[10px] text-muted leading-relaxed">
        Cada valor es un solo argumento aunque tenga espacios (no necesita comillas). Si queda vacío, la opción no se envía.
        Para una columna completa elige «campo · todas las filas» en <span className="font-mono">{'{ }'}</span>: llega como{' '}
        <code className="text-fg">a,b,c</code> o, con «a b c», como un argumento por elemento (argparse <code className="text-fg">nargs="*"</code>).
      </p>

      {preview.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted">Se ejecutará:</div>
          <div className="flex flex-wrap gap-1 p-1.5 rounded-sm bg-bg border border-border">
            <span className="px-1 py-0.5 text-[10px] font-mono text-muted">{scriptFileName || 'script'}</span>
            {preview.map((t, i) => (
              <span
                key={i}
                className={cn(
                  'px-1.5 py-0.5 rounded border text-[10px] font-mono max-w-full truncate',
                  t.template ? 'border-accent/40 bg-accent/5 text-accent' : 'border-border bg-surface text-fg'
                )}
                title={t.text}
              >
                {t.text}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
