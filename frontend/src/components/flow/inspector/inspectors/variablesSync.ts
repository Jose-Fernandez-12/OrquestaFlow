// The variables node keeps its variables twice: as a table (`variables`, what the engine runs) and as
// the text of the JSON editor (`rawJson`). Every edit writes both, so they never disagree.

export interface FlowVariable {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  value: any;
  description?: string;
}

export function variablesToJson(variables: FlowVariable[]): string {
  const obj: Record<string, any> = {};
  for (const v of variables) {
    if (!v?.key) continue;
    let value = v.value;
    if (v.type === 'json' && typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // keep the text as typed
      }
    }
    obj[v.key] = value;
  }
  return JSON.stringify(obj, null, 2);
}

/**
 * Variables from the JSON editor text, or null when the text is not a JSON object yet (still typing).
 * A key that already existed keeps its description, and its type when the value still fits it
 * (a date stays a date instead of becoming plain text).
 */
export function variablesFromJson(text: string, previous: FlowVariable[] = []): FlowVariable[] | null {
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const byKey = new Map(previous.map(v => [v.key, v]));
  return Object.entries(parsed as Record<string, any>).map(([key, val]) => {
    let type: FlowVariable['type'] = 'string';
    if (typeof val === 'number') type = 'number';
    else if (typeof val === 'boolean') type = 'boolean';
    else if (typeof val === 'object' && val !== null) type = 'json';

    const prev = byKey.get(key);
    if (prev && typeof val === 'string' && (prev.type === 'date' || prev.type === 'string')) type = prev.type;

    return {
      key,
      type,
      value: typeof val === 'object' && val !== null ? JSON.stringify(val) : val,
      description: prev?.description || '',
    };
  });
}
