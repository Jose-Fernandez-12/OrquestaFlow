import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { CheckCircle2, AlertCircle, Wand2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';

interface JsonCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
}

// {{variables}} may appear unquoted; swap them for a literal so the JSON can still be validated
function parseJson(text: string): { ok: boolean; value?: any; error?: string } {
  if (!text.trim()) return { ok: true };
  try {
    return { ok: true, value: JSON.parse(text.replace(/\{\{[^}]*\}\}/g, '0')) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'JSON inválido') };
  }
}

export function JsonCodeField({ value, onChange, placeholder, minHeight = '96px', maxHeight = '320px' }: JsonCodeFieldProps) {
  const check = useMemo(() => parseJson(value), [value]);
  const hasVars = /\{\{[^}]*\}\}/.test(value);

  const format = () => {
    if (!check.ok || hasVars || !value.trim()) return;
    onChange(JSON.stringify(JSON.parse(value), null, 2));
  };

  return (
    <div
      className={cn(
        'rounded-sm border bg-surface overflow-hidden transition-colors focus-within:ring-2',
        check.ok ? 'border-border focus-within:border-accent focus-within:ring-accent/15' : 'border-danger/50 focus-within:ring-danger/15'
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[javascript()]}
        theme="light"
        minHeight={minHeight}
        maxHeight={maxHeight}
        placeholder={placeholder}
        basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
        className="text-xs [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-gutters]:bg-bg [&_.cm-gutters]:border-border"
      />
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-t border-border bg-bg/60 text-[10px]">
        {check.ok ? (
          <span className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 size={11} /> JSON válido
          </span>
        ) : (
          <span className="flex items-center gap-1 text-danger truncate" title={check.error}>
            <AlertCircle size={11} className="shrink-0" /> <span className="truncate">{check.error}</span>
          </span>
        )}
        {check.ok && !hasVars && value.trim() && (
          <button type="button" onClick={format} className="flex items-center gap-1 text-muted hover:text-accent shrink-0">
            <Wand2 size={11} /> Formatear
          </button>
        )}
      </div>
    </div>
  );
}
