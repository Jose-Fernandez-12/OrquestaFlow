import React, { useState } from 'react';
import { X, Copy, Download, Check, Terminal, Code2 } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface NodeResultModalProps {
  inspectNodeData: {
    id: string;
    label: string;
    result: any;
    hasError: boolean;
  };
  jsonStr: string;
  logs: Array<{ level: string; args: string[]; ts: number }>;
  hasLogs: boolean;
  onClose: () => void;
}

const LOG_LEVEL_STYLES: Record<string, { color: string; badge: string; badgeBg: string }> = {
  log:   { color: 'text-green-400',  badge: 'LOG',   badgeBg: 'bg-green-500/20 text-green-400' },
  info:  { color: 'text-blue-400',   badge: 'INFO',  badgeBg: 'bg-blue-500/20 text-blue-400' },
  warn:  { color: 'text-yellow-400', badge: 'WARN',  badgeBg: 'bg-yellow-500/20 text-yellow-400' },
  error: { color: 'text-red-400',    badge: 'ERROR', badgeBg: 'bg-red-500/20 text-red-400' },
};

export function NodeResultModal({ inspectNodeData, jsonStr, logs, hasLogs, onClose }: NodeResultModalProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'logs'>('data');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = jsonStr;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultado_${inspectNodeData.label.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
              Resultados del nodo: <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{inspectNodeData.label}</span>
            </h2>
            <div className={cn("text-xs mt-1", inspectNodeData.hasError ? "text-red-500" : "text-success")}>
              {inspectNodeData.hasError ? "Error en ejecucion" : "Ejecucion exitosa"}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            <Button
              variant="default"
              size="sm"
              onClick={handleCopy}
              className="text-xs h-8 px-2.5 gap-1.5"
              title="Copiar JSON al portapapeles"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar JSON'}</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              className="text-xs h-8 px-2.5 gap-1.5"
              title="Descargar como archivo JSON"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Descargar JSON</span>
            </Button>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-md text-muted-foreground ml-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabs (only if logs exist) */}
        {hasLogs && (
          <div className="flex border-b border-border shrink-0 bg-bg/30">
            <button
              type="button"
              onClick={() => setActiveTab('data')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                activeTab === 'data'
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-fg"
              )}
            >
              <Code2 size={13} /> Datos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                activeTab === 'logs'
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-fg"
              )}
            >
              <Terminal size={13} /> Consola
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-mono">{logs.length}</span>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto bg-bg/50">
          {activeTab === 'data' ? (
            <div className="p-4">
              <pre className="text-xs font-mono p-4 bg-black/80 text-green-400 rounded-md overflow-auto max-h-[60vh]">
                {jsonStr}
              </pre>
            </div>
          ) : (
            <div className="p-4">
              <div className="bg-gray-950 rounded-md border border-gray-800 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/80">
                  <Terminal size={12} className="text-gray-500" />
                  <span className="text-[11px] text-gray-500 font-mono">Consola de ejecucion</span>
                  <span className="text-[10px] text-gray-600 ml-auto font-mono">{logs.length} mensajes</span>
                </div>
                <div className="max-h-[55vh] overflow-auto p-1">
                  {logs.map((log, i) => {
                    const style = LOG_LEVEL_STYLES[log.level] || LOG_LEVEL_STYLES.log;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex items-start gap-2 px-3 py-1.5 text-xs font-mono border-b border-gray-800/50 last:border-0",
                          "hover:bg-gray-900/60 transition-colors"
                        )}
                      >
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5", style.badgeBg)}>
                          {style.badge}
                        </span>
                        <span className={cn("flex-1 break-all whitespace-pre-wrap", style.color)}>
                          {log.args.join(' ')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex justify-end shrink-0">
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
