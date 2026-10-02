import React, { useState, useEffect, useRef } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { MapSourceButton } from './MapSourceButton';
import { cn } from '../../../../lib/utils';

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
  /** Upstream nodes whose data can be mapped into any field, including fields nested in arrays/objects */
  mapNodes?: Node[];
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** True when the text is a non-empty JSON array/object that can be edited as a tree. */
function isStructured(text: string): boolean {
  const t = text.trim();
  if (!((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}')))) return false;
  try {
    const p = JSON.parse(t);
    return typeof p === 'object' && p !== null && Object.keys(p).length > 0;
  } catch {
    return false;
  }
}

/** Keeps the original scalar type when the new text still fits it (2102 stays a number). */
function coerceLike(original: Json, text: string): Json {
  if (typeof original === 'number' && text.trim() !== '' && !isNaN(Number(text))) return Number(text);
  if (typeof original === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

function emptyLike(sample: Json | undefined): Json {
  if (Array.isArray(sample)) return [];
  if (sample !== null && typeof sample === 'object') {
    return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, emptyLike(v)]));
  }
  return typeof sample === 'number' ? 0 : '';
}

interface JsonNodeProps {
  value: Json;
  onChange: (v: Json) => void;
  mapNodes: Node[];
}

const ROW_GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_20px] gap-2 items-center';

/** Text input with the "map from upstream node" icon sitting inside it, on the right. */
function MappableInput({
  value,
  onChange,
  mapNodes,
  placeholder = 'Valor o {{nodo.campo}}',
}: {
  value: string;
  onChange: (v: string) => void;
  mapNodes: Node[];
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        className={cn('h-7 w-full text-xs font-mono', mapNodes.length > 0 && 'pr-7')}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
      {mapNodes.length > 0 && (
        <div className="absolute right-0.5 top-1/2 -translate-y-1/2">
          <MapSourceButton nodes={mapNodes} iconOnly label="Mapear desde un nodo" onSelectValue={onChange} />
        </div>
      )}
    </div>
  );
}

function scalarText(v: Json): string {
  return v === null ? 'null' : String(v);
}

function JsonNode({ value, onChange, mapNodes }: JsonNodeProps) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1.5">
        {value.map((item, idx) => {
          const update = (v: Json) => onChange(value.map((x, j) => (j === idx ? v : x)));
          const remove = (
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== idx))}
              className="text-muted hover:text-danger p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              title="Quitar elemento"
            >
              <Trash2 size={11} />
            </button>
          );
          const isObj = item !== null && typeof item === 'object';
          return (
            <div key={idx} className="group rounded-sm border border-border/70 bg-bg/40 px-2 py-1.5">
              {isObj ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted">#{idx + 1}</span>
                    {remove}
                  </div>
                  <JsonNode value={item} mapNodes={mapNodes} onChange={update} />
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted w-5 shrink-0">#{idx + 1}</span>
                  <MappableInput
                    value={scalarText(item)}
                    mapNodes={mapNodes}
                    onChange={t => update(coerceLike(item, t))}
                  />
                  {remove}
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => onChange([...value, emptyLike(value[value.length - 1])])}
          className="text-[10px] text-muted hover:text-accent flex items-center gap-1 transition-colors"
        >
          <Plus size={10} /> Agregar elemento
        </button>
      </div>
    );
  }

  if (value !== null && typeof value === 'object') {
    return (
      <div className="space-y-1">
        {Object.entries(value).map(([k, v]) => {
          const update = (nv: Json) => onChange({ ...value, [k]: nv });
          if (v !== null && typeof v === 'object') {
            return (
              <div key={k} className="space-y-1">
                <span className="text-[11px] font-mono text-muted">{k}</span>
                <div className="pl-2 border-l border-border">
                  <JsonNode value={v} mapNodes={mapNodes} onChange={update} />
                </div>
              </div>
            );
          }
          return (
            <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 items-center">
              <span className="text-[11px] font-mono text-muted truncate" title={k}>
                {k}
              </span>
              <MappableInput value={scalarText(v)} mapNodes={mapNodes} onChange={t => update(coerceLike(v, t))} />
            </div>
          );
        })}
      </div>
    );
  }

  return <MappableInput value={scalarText(value)} mapNodes={mapNodes} onChange={t => onChange(coerceLike(value, t))} />;
}

function describe(value: Json): string {
  if (Array.isArray(value)) return `lista (${value.length})`;
  if (value !== null && typeof value === 'object') return `objeto (${Object.keys(value).length})`;
  return '';
}

/**
 * Row for an array/object value: the key on top and the value edited as a tree below it, where every
 * leaf can be mapped from upstream data. "Mapear todo" swaps the whole value for an upstream list.
 */
function StructuredRow({
  entryKey,
  value,
  mapNodes,
  keyPlaceholder,
  onKeyChange,
  onChange,
  onRemove,
}: {
  entryKey: string;
  value: string;
  mapNodes: Node[];
  keyPlaceholder: string;
  onKeyChange: (k: string) => void;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  let parsed: Json = null;
  try {
    parsed = JSON.parse(value);
  } catch {}

  return (
    <div className="space-y-1.5">
      <div className={ROW_GRID}>
        <Input
          className="h-7 text-xs font-mono"
          placeholder={keyPlaceholder}
          value={entryKey}
          onChange={e => onKeyChange(e.target.value)}
        />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-muted truncate">{describe(parsed)}</span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {mapNodes.length > 0 && (
              <MapSourceButton
                nodes={mapNodes}
                iconOnly
                label="Reemplazar todo el valor por datos de un nodo"
                onSelectValue={onChange}
              />
            )}
            <button
              type="button"
              onClick={() => setShowRaw(r => !r)}
              className="text-[10px] text-accent hover:underline font-mono"
            >
              {showRaw ? 'Campos' : 'JSON'}
            </button>
          </div>
        </div>
        <button type="button" onClick={onRemove} className="text-muted hover:text-danger p-0.5" title="Eliminar">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="ml-1 pl-3 border-l-2 border-accent/25 mr-7">
        {showRaw ? (
          <textarea
            className="flex w-full rounded-sm border border-border bg-surface px-[9px] py-[6px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent leading-relaxed resize-y"
            rows={Math.min(value.split('\n').length, 10)}
            spellCheck={false}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        ) : (
          <JsonNode value={parsed} mapNodes={mapNodes} onChange={v => onChange(JSON.stringify(v, null, 2))} />
        )}
      </div>
    </div>
  );
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

/** Non-empty arrays/objects are shown indented (multi-line); scalars and empty ones stay compact. */
function prettyValue(value: unknown): string {
  const isEmpty =
    typeof value === 'object' && value !== null && Object.keys(value).length === 0;
  return typeof value === 'object' && value !== null && !isEmpty
    ? JSON.stringify(value, null, 2)
    : JSON.stringify(value);
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
                displayVal = prettyValue(unescaped);
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
          displayVal = prettyValue(value);
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
  mapNodes = [],
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
            localEntries.map((entry, i) =>
              isStructured(entry.value) ? (
                <StructuredRow
                  key={i}
                  entryKey={entry.key}
                  value={entry.value}
                  mapNodes={mapNodes}
                  keyPlaceholder={keyPlaceholder}
                  onKeyChange={k => updateEntry(i, 'key', k)}
                  onChange={v => updateEntry(i, 'value', v)}
                  onRemove={() => removeEntry(i)}
                />
              ) : (
                <div key={i} className={ROW_GRID}>
                  <Input
                    className="h-7 text-xs font-mono"
                    placeholder={keyPlaceholder}
                    value={entry.key}
                    onChange={e => updateEntry(i, 'key', e.target.value)}
                  />
                  {entry.value.includes('\n') ? (
                    <textarea
                      className="flex w-full min-w-0 rounded-sm border border-border bg-surface px-[9px] py-[6px] text-xs font-mono focus-visible:outline-none focus-visible:border-accent leading-relaxed resize-y"
                      rows={Math.min(entry.value.split('\n').length, 10)}
                      spellCheck={false}
                      placeholder={valuePlaceholder}
                      value={entry.value}
                      onChange={e => updateEntry(i, 'value', e.target.value)}
                    />
                  ) : (
                    <MappableInput
                      value={entry.value}
                      mapNodes={mapNodes}
                      placeholder={valuePlaceholder}
                      onChange={v => updateEntry(i, 'value', v)}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeEntry(i)}
                    className="text-muted hover:text-danger p-0.5"
                    title="Eliminar"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            )
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
