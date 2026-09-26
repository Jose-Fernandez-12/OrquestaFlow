import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Node, Edge } from '@xyflow/react';
import { Code2, Copy, Check, X, Terminal, Braces, Sparkles, CheckCircle } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Button } from '../../../ui/button';
import { VariablePicker } from '../editors/VariableField';

interface JsonTransformModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  onChange: (newCode: string) => void;
  node: Node;
  nodes: Node[];
  edges: Edge[];
  templates: Array<{ label: string; code: string }>;
}

export function JsonTransformModal({
  isOpen,
  onClose,
  code,
  onChange,
  node,
  nodes,
  edges,
  templates,
}: JsonTransformModalProps) {
  const [currentCode, setCurrentCode] = useState(code);
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const editorRef = useRef<any>(null);

  // Sync internal state when opened
  React.useEffect(() => {
    if (isOpen) {
      setCurrentCode(code);
      setApplied(false);
    }
  }, [isOpen, code]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    onChange(currentCode);
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      onClose();
    }, 400);
  };

  const handleInsertVariable = (expr: string) => {
    const textToInsert = expr;
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: textToInsert },
        selection: { anchor: from + textToInsert.length }
      });
      setCurrentCode(view.state.doc.toString());
    } else {
      setCurrentCode(prev => prev + '\n' + textToInsert);
    }
  };

  const handleApplyTemplate = (templateCode: string) => {
    setCurrentCode(templateCode);
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: templateCode }
      });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-fg/40 animate-fade-in backdrop-blur-xs">
      <div className="bg-surface border border-border rounded-lg shadow-raised w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3.5 border-b border-border flex items-center justify-between shrink-0 bg-bg/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded bg-accent/10 text-accent shrink-0">
              <Code2 size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2 truncate">
                Editor de Código JavaScript
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                  {(node.data?.label as string) || 'Transformar Datos'}
                </span>
              </h3>
              <p className="text-[11px] text-muted truncate">
                Escribe lógica de transformación en JavaScript aislado con soporte de console.log()
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs h-8 px-2.5 gap-1.5"
              title="Copiar código al portapapeles"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-bg text-muted hover:text-fg transition-colors ml-1"
              title="Cerrar modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar: Templates and Variable Picker */}
        <div className="px-4 py-2 bg-bg/60 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-muted flex items-center gap-1 mr-1">
              <Sparkles size={12} className="text-accent" /> Plantillas:
            </span>
            {templates.map(t => (
              <button
                key={t.label}
                type="button"
                onClick={() => handleApplyTemplate(t.code)}
                className="text-xs px-2 py-1 rounded bg-surface border border-border text-fg hover:border-accent hover:text-accent transition-colors"
                title={t.code}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">Insertar variable:</span>
            <VariablePicker
              node={node}
              nodes={nodes}
              edges={edges}
              onSelect={handleInsertVariable}
            />
          </div>
        </div>

        {/* CodeMirror Editor Area */}
        <div className="p-4 flex-1 overflow-y-auto bg-bg/20 flex flex-col min-h-[400px]">
          <div className="border border-border rounded-md overflow-hidden bg-bg focus-within:border-accent flex-1 flex flex-col shadow-inner">
            <CodeMirror
              ref={editorRef}
              value={currentCode}
              height="480px"
              extensions={[javascript()]}
              theme="light"
              onChange={(val) => setCurrentCode(val)}
              className="text-xs font-mono border-0 flex-1 [&_.cm-editor]:text-xs [&_.cm-scroller]:font-mono [&_.cm-content]:text-xs [&_.cm-line]:text-xs"
              placeholder="// Escribe tu código JavaScript aquí...\n// Usa console.log(data) para depurar la ejecución"
            />
          </div>
        </div>

        {/* Footer with tips and action buttons */}
        <div className="p-3 border-t border-border flex items-center justify-between shrink-0 bg-bg/40 flex-wrap gap-2">
          <div className="flex items-center gap-3 text-[11px] text-muted font-mono">
            <span className="flex items-center gap-1">
              <Terminal size={12} className="text-accent" /> Usa <code>console.log(...)</code> para imprimir en modo debug
            </span>
            <span>•</span>
            <span>Límite: 5s</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleApply}
              className="text-xs gap-1.5"
            >
              {applied ? <CheckCircle size={14} className="text-emerald-400" /> : <Code2 size={14} />}
              <span>{applied ? 'Aplicado' : 'Guardar y Aplicar'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
