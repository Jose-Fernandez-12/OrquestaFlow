export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
  description: string;
  isCustom?: boolean;
}

export const PRESET_THEMES: ColorTheme[] = [
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
  {
    id: 'emerald',
    name: 'Esmeralda',
    accent: '#059669',
    description: 'Verde fresco y natural (#059669)',
  },
  {
    id: 'violet',
    name: 'Violeta / Púrpura',
    accent: '#7c3aed',
    description: 'Púrpura moderno y tecnológico (#7c3aed)',
  },
  {
    id: 'cyan',
    name: 'Cian / Turquesa',
    accent: '#0891b2',
    description: 'Cian nítido y balanceado (#0891b2)',
  },
  {
    id: 'rose',
    name: 'Rosa Frambuesa',
    accent: '#e11d48',
    description: 'Rosa vivo y vibrante (#e11d48)',
  },
];

const THEME_ACCENT_KEY = 'orquesta-theme-accent';
const CUSTOM_COLORS_KEY = 'orquesta-custom-theme-colors';

export function applyThemeColor(accentHex: string) {
  if (!accentHex || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--accent', accentHex);
  root.style.setProperty('--border-focus', accentHex);
}

export function getSavedTheme(): string {
  try {
    return localStorage.getItem(THEME_ACCENT_KEY) || '#2f6feb';
  } catch {
    return '#2f6feb';
  }
}

export function saveTheme(accentHex: string) {
  try {
    localStorage.setItem(THEME_ACCENT_KEY, accentHex);
  } catch {}
  applyThemeColor(accentHex);
  // Notificar a otros componentes que escuchan cambios de tema
  window.dispatchEvent(new CustomEvent('orquesta-theme-change', { detail: { accent: accentHex } }));
}

export function getCustomColors(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addCustomColor(hex: string): string[] {
  const current = getCustomColors();
  const normalized = hex.trim().toUpperCase();
  if (!isValidHex(normalized)) return current;
  
  const updated = Array.from(new Set([normalized, ...current])).slice(0, 8);
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

export function removeCustomColor(hex: string): string[] {
  const current = getCustomColors();
  const updated = current.filter(c => c.toUpperCase() !== hex.trim().toUpperCase());
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

export function isValidHex(hex: string): boolean {
  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(hex.trim());
}

export function getAllThemes(): ColorTheme[] {
  const customColors = getCustomColors();
  const customThemes: ColorTheme[] = customColors.map((hex, index) => ({
    id: `custom-${index}-${hex.replace('#', '')}`,
    name: `Personalizado (${hex})`,
    accent: hex,
    description: 'Color añadido por el usuario',
    isCustom: true,
  }));
  return [...PRESET_THEMES, ...customThemes];
}
