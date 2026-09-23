import React, { useState, useEffect, useRef } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Plus, Trash2, Wand2 } from 'lucide-react';

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  /** Current JSON string or empty */
  jsonString: string;
  onChange: (newJsonString: string) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  emptyMessage?: string;
  hideToggle?: boolean;
  defaultRaw?: boolean;
}

/**
 * Recursively inspects a JSON string and unescapes any fields that were
 * accidentally serialized as escaped JSON strings (e.g. `"[{\"id\":...}]"` or `"[]"`).
 */
export function repairJsonString(rawJson: string): string {
  try {
    if (!rawJson || !rawJson.trim()) return rawJson;
    const parsed = JSON.parse(rawJson);
    if (typeof parsed !== 'object' || parsed === null) return rawJson;

    const unescapeField = (val: any): any => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (
          (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))
        ) {
          try {
            const inner = JSON.parse(trimmed);
            if (typeof inner === 'object' && inner !== null) {
              return unescapeField(inner);
            }
          } catch {}
        }
        return val;
      }
      if (Array.isArray(val)) {
        return val.map(unescapeField);
      }
      if (typeof val === 'object' && val !== null) {
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
          res[k] = unescapeField(v);
        }
        return res;
      }
      return val;
    };

    const cleaned = unescapeField(parsed);
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return rawJson;
  }
}

export function parseToEntries(jsonString: string): KeyValuePair[] {
  try {
    if (!jsonString || !jsonString.trim()) return [];
    const parsed = JSON.parse(jsonString);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => {
        let displayVal: string;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          // Detect and unescape doubly-stringified JSON (e.g. "[{\"id\":...}]" or "[]")
          if (
            (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'))
          ) {
            try {
              const unescaped = JSON.parse(trimmed);
              if (typeof unescaped === 'object' && unescaped !== null) {
                displayVal = JSON.stringify(unescaped);
              } else {
                displayVal = value;
              }
            } catch {
              displayVal = value;
            }
          } else {
            displayVal = value;
          }
        } else {
          displayVal = JSON.stringify(value);
        }
        return { key, value: displayVal };
      });
    }
  } catch {}
  return [];
}

export function entriesToJson(entries: KeyValuePair[]): string {
  if (entries.length === 0) return '';
  const obj: Record<string, any> = {};
  entries.forEach(({ key, value }) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    const trimmedVal = value.trim();

    // 1. If it's a JSON array or object, parse it so it isn't saved as an escaped string
    if (
      (trimmedVal.startsWith('[') && trimmedVal.endsWith(']')) ||
      (trimmedVal.startsWith('{') && trimmedVal.endsWith('}'))
    ) {
      try {
        obj[trimmedKey] = JSON.parse(trimmedVal);
        return;
      } catch {
        // e.g. contains template variable {{_item.foo}} inside brackets
      }
    }

    // 2. Booleans & null
    if (trimmedVal === 'true') {
      obj[trimmedKey] = true;
      return;
    }
    if (trimmedVal === 'false') {
      obj[trimmedKey] = false;
      return;
    }
    if (trimmedVal === 'null') {
      obj[trimmedKey] = null;
      return;
    }

    // 3. Keep as regular string
    obj[trimmedKey] = value;
  });
  return JSON.stringify(obj, null, 2);
}

export function KeyValueEditor({
  jsonString,
  onChange,
  keyPlaceholder = 'Clave',
  valuePlaceholder = 'Valor o {{variable}}',
  addLabel = 'Agregar',
  emptyMessage = 'Sin entradas. Agrega una clave-valor.',
  hideToggle = false,
  defaultRaw = false,
}: KeyValueEditorProps) {
  const [showRaw, setShowRaw] = useState(defaultRaw);
  const [newKey, setNewKey] = useState('');
  const [localEntries, setLocalEntries] = useState<KeyValuePair[]>(() => parseToEntries(jsonString));
  const isInternalChangeRef = useRef(false);

  useEffect(() => {
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }
    setLocalEntries(parseToEntries(jsonString));
  }, [jsonString]);

  const updateEntry = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...localEntries];
    updated[index] = { ...updated[index], [field]: val };
    setLocalEntries(updated);
    isInternalChangeRef.current = true;
    onChange(entriesToJson(updated));
  };

  const removeEntry = (index: number) => {
    const updated = localEntries.filter((_, i) => i !== index);
    setLocalEntries(updated);
    isInternalChangeRef.current = true;
    onChange(entriesToJson(updated));
  };

  const addEntry = () => {
    const keyToAdd = newKey.trim() || `key_${localEntries.length + 1}`;
    const updated = [...localEntries, { key: keyToAdd, value: '' }];
    setLocalEntries(updated);
    isInternalChangeRef.current = true;
    onChange(entriesToJson(updated));
    setNewKey('');
  };

  const handleRepair = () => {
    const repaired = repairJsonString(jsonString);
    if (repaired !== jsonString) {
      onChange(repaired);
    }
  };

  return (
    <div className="space-y-2">
      {/* Optional internal toggle and repair button */}
      {!hideToggle && (
        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={handleRepair}
            className="text-[10px] text-muted hover:text-accent flex items-center gap-1 font-mono transition-colors cursor-pointer"
            title="Reparar formato JSON y comillas escapadas"
          >
            <Wand2 size={11} />
            <span>Reparar JSON</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="text-[10px] text-accent hover:underline font-mono cursor-pointer"
          >
            {showRaw ? 'Vista Guiada' : 'Ver JSON raw'}
          </button>
        </div>
      )}

      {showRaw ? (
        <textarea
          className="flex w-full min-h-[90px] rounded-sm border border-border bg-surface px-[9px] py-[8px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent leading-relaxed"
          value={jsonString}
          onChange={e => onChange(e.target.value)}
          placeholder={'{\n  "clave": "valor"\n}'}
        />
      ) : (
        <div className="space-y-2 border border-border rounded-sm p-2.5 bg-bg/50">
          {localEntries.length > 0 ? (
            localEntries.map((entry, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={keyPlaceholder}
                  value={entry.key}
                  onChange={e => updateEntry(i, 'key', e.target.value)}
                />
                <Input
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={valuePlaceholder}
                  value={entry.value}
                  onChange={e => updateEntry(i, 'value', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  className="text-muted hover:text-danger p-0.5 shrink-0"
                  title="Eliminar"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="text-[10px] text-muted text-center py-2 leading-relaxed">
              {emptyMessage}
            </div>
          )}

          {/* Add new entry */}
          <div className="flex gap-1.5 pt-1.5 border-t border-border/50">
            <Input
              className="h-7 text-xs font-mono flex-1"
              placeholder="Nombre de la clave..."
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEntry();
                }
              }}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-7 px-2 text-xs shrink-0 flex items-center gap-1"
              onClick={addEntry}
            >
              <Plus size={12} />
              {addLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
