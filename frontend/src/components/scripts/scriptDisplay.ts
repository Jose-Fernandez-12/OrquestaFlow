/** "scripts/3f2a…-…_limpiar_ventas.py" → "limpiar_ventas.py" */
export function displayFileName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || filePath;
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '');
}

/** SQLite datetime('now') values are UTC without a zone: "2026-10-04 07:48:14" */
export function parseDbDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function relativeTime(date: Date | null, now = Date.now()): string {
  if (!date) return 'Nunca';
  const s = Math.round((now - date.getTime()) / 1000);
  if (s < 45) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'ayer' : `hace ${d} días`;
  return date.toLocaleDateString();
}
