import { normalizeHexColor } from './exportUtils';

export const QUERY_EXPORT_HEADER_COLOR_KEY = 'orquesta-query-export-header-color';
export const DEFAULT_QUERY_EXPORT_HEADER_COLOR = '#1E293B';

export const QUERY_EXPORT_COLOR_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: 'Acento', hex: '#2F6FEB' },
  { label: 'Azul oscuro', hex: '#1E293B' },
  { label: 'Verde', hex: '#166534' },
  { label: 'Rojo', hex: '#991B1B' },
  { label: 'Morado', hex: '#5B21B6' },
  { label: 'Gris', hex: '#374151' },
  { label: 'Naranja', hex: '#C2410C' },
];

export type QueryExportScope = 'all' | 'page';

export function loadQueryExportHeaderColor(): string {
  try {
    return normalizeHexColor(localStorage.getItem(QUERY_EXPORT_HEADER_COLOR_KEY) ?? '') ?? DEFAULT_QUERY_EXPORT_HEADER_COLOR;
  } catch {
    return DEFAULT_QUERY_EXPORT_HEADER_COLOR;
  }
}

export function saveQueryExportHeaderColor(color: string) {
  try {
    localStorage.setItem(QUERY_EXPORT_HEADER_COLOR_KEY, color);
  } catch {}
}

/** Quita caracteres no válidos en nombres de archivo y espacios. Devuelve '' si no queda nada. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120)
    .replace(/^[.-]+|[.-]+$/g, '');
}

export function defaultQueryExportFileName(queryName: string | undefined, date: Date = new Date()): string {
  const slug = sanitizeFileName(queryName ?? '') || 'resultados';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `consulta-${slug}-${yyyy}${mm}${dd}`;
}

export function selectExportRows<T>(scope: QueryExportScope, allRows: T[], pageRows: T[]): T[] {
  return scope === 'all' ? allRows : pageRows;
}

export function buildExportColumns(columns: string[]): { header: string; key: string }[] {
  return columns.map(column => ({ header: column, key: column }));
}
