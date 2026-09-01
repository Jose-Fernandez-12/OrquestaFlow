import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

interface JsonTreeViewerProps {
  data: any;
  onSelectKey?: (path: string) => void;
  currentPath?: string;
  mode?: 'copy' | 'select';
  selectedPaths?: string[];
  onTogglePath?: (path: string) => void;
}

export function JsonTreeViewer({ 
  data, 
  onSelectKey, 
  currentPath = 'response',
  mode = 'copy',
  selectedPaths = [],
  onTogglePath
}: JsonTreeViewerProps) {
  const [collapsedKeys, setCollapsedKeys] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsedKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (val: any, path: string, isNested = true) => {
    if (typeof val === 'object' && val !== null) {
      const isArray = Array.isArray(val);
      const isCollapsed = collapsedKeys[path];

      return (
        <div className={cn(isNested && "pl-4", "w-full")}>
          <div className="flex items-center gap-1.5 group py-0.5">
            <button
              type="button"
              onClick={() => toggleCollapse(path)}
              className="inline-flex items-center gap-1 text-muted hover:text-fg font-mono text-xs focus:outline-none"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span>{isArray ? `Array [${val.length}]` : 'Object'}</span>
            </button>
            {mode === 'copy' && onSelectKey && (
              <button
                type="button"
                onClick={() => onSelectKey(path)}
                title={`Seleccionar ${path}`}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:text-accent transition-opacity shrink-0"
              >
                <Copy size={10} />
              </button>
            )}
          </div>
          
          {!isCollapsed && (
            <div className="border-l border-border pl-2 ml-1.5 my-1 flex flex-col gap-1.5">
              {Object.keys(val).map(k => {
                const itemPath = isArray ? `${path}[${k}]` : `${path}.${k}`;
                const isValObject = typeof val[k] === 'object' && val[k] !== null;

                return (
                  <div 
                    key={k} 
                    className={cn(
                      "flex font-mono text-xs group", 
                      isValObject ? "flex-col items-start gap-0.5" : "flex-row items-center gap-1.5"
                    )}
                  >
                    <span className="text-accent font-semibold shrink-0">{k}:</span>
                    {renderValue(val[k], itemPath, isValObject)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Primitive values
    let valStr = String(val);
    let valColor = 'text-green-600';
    if (typeof val === 'number') valColor = 'text-blue-600';
    if (typeof val === 'boolean') valColor = 'text-orange-600';
    if (val === null) {
      valStr = 'null';
      valColor = 'text-red-500 font-semibold';
    }

    const isSelected = selectedPaths.includes(path);

    return (
      <div 
        className={cn(
          "flex items-center gap-1.5 group py-0.5",
          mode === 'select' ? "cursor-pointer hover:bg-white/5 rounded px-1 -ml-1" : ""
        )}
        onClick={() => {
          if (mode === 'select' && onTogglePath) onTogglePath(path);
        }}
      >
        <span className={cn("font-mono text-xs", valColor)}>
          {typeof val === 'string' ? `"${valStr}"` : valStr}
        </span>
        {mode === 'copy' && onSelectKey && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectKey(path); }}
            title={`Seleccionar ${path}`}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:text-accent transition-opacity shrink-0"
          >
            <Copy size={10} />
          </button>
        )}
        {mode === 'select' && onTogglePath && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePath(path); }}
            title={isSelected ? `Deseleccionar ${path}` : `Seleccionar ${path}`}
            className={cn(
              "p-0.5 transition-opacity shrink-0 ml-2",
              isSelected ? "text-accent opacity-100" : "text-muted opacity-60 group-hover:opacity-100 group-hover:text-accent"
            )}
          >
            {isSelected ? <Check size={14} /> : <Plus size={14} />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-bg p-4 border border-border rounded-sm overflow-auto max-h-[350px]">
      {renderValue(data, currentPath, false)}
    </div>
  );
}
