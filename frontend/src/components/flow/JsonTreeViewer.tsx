import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

interface JsonTreeViewerProps {
  data: any;
  onSelectKey?: (path: string) => void;
  currentPath?: string;
}

export function JsonTreeViewer({ data, onSelectKey, currentPath = 'response' }: JsonTreeViewerProps) {
  const [collapsedKeys, setCollapsedKeys] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsedKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (val: any, path: string) => {
    if (typeof val === 'object' && val !== null) {
      const isArray = Array.isArray(val);
      const isCollapsed = collapsedKeys[path];

      return (
        <div className="pl-4">
          <button
            type="button"
            onClick={() => toggleCollapse(path)}
            className="inline-flex items-center gap-1 text-muted hover:text-fg font-mono text-xs focus:outline-none"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{isArray ? `Array [${val.length}]` : 'Object'}</span>
          </button>
          
          {!isCollapsed && (
            <div className="border-l border-border pl-2 ml-1.5 my-1 flex flex-col gap-1.5">
              {Object.keys(val).map(k => {
                const itemPath = isArray ? `${path}[${k}]` : `${path}.${k}`;
                return (
                  <div key={k} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 group/key">
                      <span className="font-mono text-xs text-accent font-semibold">{k}:</span>
                      {onSelectKey && (
                        <button
                          type="button"
                          onClick={() => onSelectKey(itemPath)}
                          title={`Seleccionar ${itemPath}`}
                          className="opacity-0 group-hover/key:opacity-100 p-0.5 text-muted hover:text-accent transition-opacity"
                        >
                          <Copy size={10} />
                        </button>
                      )}
                    </div>
                    {renderValue(val[k], itemPath)}
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

    return (
      <span className={cn("font-mono text-xs pl-4", valColor)}>
        {typeof val === 'string' ? `"${valStr}"` : valStr}
      </span>
    );
  };

  return (
    <div className="bg-bg p-4 border border-border rounded-sm overflow-auto max-h-[350px]">
      {renderValue(data, currentPath)}
    </div>
  );
}
