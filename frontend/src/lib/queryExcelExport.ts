import { getApiUrl } from './api';

export const HEADER_COLOR_PRESETS = [
  { name: 'Azul oscuro', color: '#1E293B' },
  { name: 'Azul', color: '#2563EB' },
  { name: 'Verde esmeralda', color: '#059669' },
  { name: 'Morado', color: '#7C3AED' },
  { name: 'Carmesí', color: '#DC2626' },
  { name: 'Naranja', color: '#D97706' },
  { name: 'Pizarra', color: '#475569' },
  { name: 'Azul claro', color: '#E8F0FE' },
];

export const DEFAULT_HEADER_COLOR = '#1E293B';
const HEADER_COLOR_KEY = 'orquesta-query-export-header-color';
const FALLBACK_FILE_NAME = 'consulta_resultados';

/** '#1E293B', '1e293b' o '#abc' → '#1E293B'. Devuelve null si no es un hex válido. */
export function normalizeHexColor(input: string): string | null {
  const match = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map(c => c + c).join('') : match[1];
  return `#${hex.toUpperCase()}`;
}

/** Mismo criterio que el backend: texto claro sobre fondos oscuros, oscuro sobre fondos claros */
export function headerTextColorFor(hex: string): string {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_HEADER_COLOR;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0F172A' : '#FFFFFF';
}

export function loadHeaderColor(): string {
  try {
    return normalizeHexColor(localStorage.getItem(HEADER_COLOR_KEY) ?? '') ?? DEFAULT_HEADER_COLOR;
  } catch {
    return DEFAULT_HEADER_COLOR;
  }
}

export function saveHeaderColor(color: string): void {
  try {
    localStorage.setItem(HEADER_COLOR_KEY, color);
  } catch {}
}

/** Solo las columnas visibles, con valores que Excel pueda mostrar como texto */
export function buildExportRows(columns: string[], rows: Array<Record<string, any>>): Array<Record<string, unknown>> {
  return rows.map(row => Object.fromEntries(columns.map(col => {
    const value = row[col];
    if (value === undefined || value === null) return [col, null];
    return [col, typeof value === 'object' ? JSON.stringify(value) : value];
  })));
}

export function buildExcelExportBody(columns: string[], rows: Array<Record<string, any>>, fileName: string, headerColor: string) {
  return {
    columns,
    rows: buildExportRows(columns, rows),
    fileName: fileName.trim() || FALLBACK_FILE_NAME,
    headerColor,
  };
}

/** Nombre que devuelve el servidor en Content-Disposition, con el mismo fallback si falta */
export function fileNameFromDisposition(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match ? match[1] : `${FALLBACK_FILE_NAME}.xlsx`;
}

export async function exportQueryResultsToExcel(
  columns: string[],
  rows: Array<Record<string, any>>,
  fileName: string,
  headerColor: string
): Promise<void> {
  const response = await fetch(getApiUrl('/export/excel'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildExcelExportBody(columns, rows, fileName, headerColor)),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Error al generar el archivo Excel');
  }

  const blob = await response.blob();
  const downloadName = fileNameFromDisposition(response.headers.get('Content-Disposition'));
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = downloadName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(blobUrl);
  }, 1500);
}
