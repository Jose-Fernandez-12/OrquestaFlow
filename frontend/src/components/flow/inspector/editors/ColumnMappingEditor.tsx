import React, { useState } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';

interface ColumnMapping {
  header: string;
  key: string;
}

interface ColumnMappingEditorProps {
  columns: ColumnMapping[];
  onChange: (cols: ColumnMapping[]) => void;
}

export function ColumnMappingEditor({ columns, onChange }: ColumnMappingEditorProps) {
  const [collapsed, setCollapsed] = useState(false);

  const addColumn = () => {
    onChange([...(columns || []), { header: '', key: '' }]);
  };

  const updateColumn = (index: number, field: 'header' | 'key', value: string) => {
    const newCols = [...(columns || [])];
    newCols[index] = { ...newCols[index], [field]: value };
    onChange(newCols);
  };

  const removeColumn = (index: number) => {
    const newCols = [...(columns || [])];
    newCols.splice(index, 1);
    onChange(newCols);
  };

  const count = (columns || []).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium hover:text-accent transition-colors"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          Mapeo de Columnas
          {count > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-mono leading-none">
              {count}
            </span>
          )}
        </button>
        {!collapsed && (
          <Button variant="default" size="sm" onClick={addColumn} className="h-6 text-[10px] px-2 py-0">
            <Plus size={11} className="mr-0.5" />
            Agregar
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pb-2">
          {(columns || []).map((col, i) => (
            <div key={i} className="flex gap-2 items-start bg-bg p-2 rounded-sm border border-border">
              <div className="flex-1 space-y-1.5">
                <Input
                  placeholder="Nombre Columna (ej: Precio)"
                  className="h-7 text-xs"
                  value={col.header}
                  onChange={e => updateColumn(i, 'header', e.target.value)}
                />
                <Input
                  placeholder="Llave JSON (ej: price)"
                  className="h-7 text-xs font-mono"
                  value={col.key}
                  onChange={e => updateColumn(i, 'key', e.target.value)}
                />
              </div>
              <Button
                variant="icon"
                size="icon"
                onClick={() => removeColumn(i)}
                className="text-danger hover:text-danger hover:bg-danger/10 shrink-0 mt-0.5"
              >
                <X size={14} />
              </Button>
            </div>
          ))}
          {(!columns || columns.length === 0) && (
            <div className="text-[10px] text-muted text-center py-4 bg-bg rounded-sm border border-border border-dashed">
              Sin mapeo. Se exportaran todos los campos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
