export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
  description: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'blue',
    name: 'Azul Original',
    accent: '#2f6feb',
    description: 'El azul clásico de OrquestaFlow',
  },
  {
    id: 'orange-warm',
    name: 'Ámbar Intenso',
    accent: '#FB8500',
    description: 'Naranja brillante y enérgico (#FB8500)',
  },
  {
    id: 'orange-rust',
    name: 'Óxido / Mandarina',
    accent: '#D9480F',
    description: 'Naranja rojizo profundo y elegante (#D9480F)',
  },
];

const STORAGE_KEY = 'orquesta-theme-accent';

export function applyThemeColor(accentHex: string) {
  const root = document.documentElement;
  root.style.setProperty('--accent', accentHex);
  root.style.setProperty('--border-focus', accentHex);
}

export function getSavedTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '#2f6feb';
  } catch {
    return '#2f6feb';
  }
}

export function saveTheme(accentHex: string) {
  try {
    localStorage.setItem(STORAGE_KEY, accentHex);
  } catch {}
  applyThemeColor(accentHex);
}
