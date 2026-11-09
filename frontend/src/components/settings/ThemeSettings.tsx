import React, { useState, useEffect } from 'react';
import {
  PRESET_THEMES,
  getSavedTheme,
  saveTheme,
  getCustomColors,
  addCustomColor,
  removeCustomColor,
  isValidHex,
} from '../../lib/theme';
import { Palette, Plus, Trash2, Check, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

export function ThemeSettings() {
  const [currentAccent, setCurrentAccent] = useState(getSavedTheme());
  const [customColors, setCustomColors] = useState<string[]>(getCustomColors());
  const [newColorInput, setNewColorInput] = useState('#FB8500');
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentAccent(getSavedTheme());
    setCustomColors(getCustomColors());
  }, []);

  const handleSelectAccent = (hex: string) => {
    setCurrentAccent(hex);
    saveTheme(hex);
  };

  const handleAddCustomColor = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanHex = newColorInput.trim();
    if (!isValidHex(cleanHex)) {
      setInputError('Código hexadecimal no válido (ej: #FB8500 o #D9480F)');
      return;
    }
    const updated = addCustomColor(cleanHex);
    setCustomColors(updated);
    setInputError(null);
    handleSelectAccent(cleanHex);
  };

  const handleRemoveColor = (hex: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = removeCustomColor(hex);
    setCustomColors(updated);
    if (currentAccent.toLowerCase() === hex.toLowerCase()) {
      handleSelectAccent('#2f6feb');
    }
  };

  return (
    <div className="space-y-5">
      {/* Explicación */}
      <div className="p-3.5 bg-bg rounded-md border border-border flex items-start gap-3">
        <div className="p-2 rounded-md bg-accent/10 text-accent shrink-0 mt-0.5">
          <Palette size={18} />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-fg">Personalización del Color Principal</h4>
          <p className="text-[11px] text-muted leading-relaxed mt-0.5">
            Elige el color de acentuación de la interfaz. Aplica a botones principales, pestañas activas,
            indicadores de ejecución, bordes de selección y elementos clave de OrquestaFlow.
          </p>
        </div>
      </div>

      {/* Paleta predefinida */}
      <div className="p-4 bg-bg rounded-md border border-border space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
            <Sparkles size={13} className="text-accent" />
            Paletas predeterminadas
          </label>
          <span className="text-[11px] font-mono text-muted">Acento actual: {currentAccent}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {PRESET_THEMES.map((theme) => {
            const isSelected = currentAccent.toLowerCase() === theme.accent.toLowerCase();
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => handleSelectAccent(theme.accent)}
                className={cn(
                  "flex items-center gap-3 p-2.5 rounded-md border text-left transition-all",
                  isSelected
                    ? "border-accent bg-surface shadow-xs ring-1 ring-accent/30 font-medium"
                    : "border-border bg-surface/70 hover:border-muted hover:bg-surface text-muted hover:text-fg"
                )}
              >
                <div
                  className="w-6 h-6 rounded-full border border-border/60 shrink-0 shadow-xs flex items-center justify-center transition-transform"
                  style={{ backgroundColor: theme.accent }}
                >
                  {isSelected && <Check size={13} className="text-white drop-shadow-sm" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate text-fg font-medium">{theme.name}</div>
                  <div className="text-[10px] text-muted font-mono">{theme.accent}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Agregar color personalizado */}
      <div className="p-4 bg-bg rounded-md border border-border space-y-3">
        <label className="text-xs font-semibold text-fg">Agregar nuevo color personalizado</label>
        <p className="text-[11px] text-muted">
          Introduce cualquier código hexadecimal (como <span className="font-mono text-fg">#FB8500</span> o <span className="font-mono text-fg">#D9480F</span>) o utiliza el selector de color nativo.
        </p>

        <form onSubmit={handleAddCustomColor} className="flex items-center gap-2 max-w-md">
          {/* Native Color Picker Box */}
          <div className="relative w-9 h-9 rounded-md border border-border overflow-hidden shrink-0 cursor-pointer shadow-xs">
            <input
              type="color"
              value={isValidHex(newColorInput) ? newColorInput : '#FB8500'}
              onChange={(e) => {
                setNewColorInput(e.target.value.toUpperCase());
                setInputError(null);
              }}
              className="absolute -inset-2 w-14 h-14 cursor-pointer"
              title="Abrir selector de color"
            />
          </div>

          <Input
            type="text"
            placeholder="#FB8500"
            value={newColorInput}
            onChange={(e) => {
              setNewColorInput(e.target.value);
              setInputError(null);
            }}
            className="h-9 font-mono text-xs uppercase"
          />

          <Button type="submit" size="sm" variant="default" className="gap-1.5 shrink-0">
            <Plus size={14} />
            Agregar y aplicar
          </Button>
        </form>

        {inputError && (
          <p className="text-xs text-danger font-medium">{inputError}</p>
        )}

        {/* Colores agregados por el usuario */}
        {customColors.length > 0 && (
          <div className="pt-2 border-t border-border/80 space-y-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Tus colores guardados
            </span>
            <div className="flex flex-wrap gap-2">
              {customColors.map((hex) => {
                const isSelected = currentAccent.toLowerCase() === hex.toLowerCase();
                return (
                  <div
                    key={hex}
                    onClick={() => handleSelectAccent(hex)}
                    className={cn(
                      "flex items-center gap-2 pl-2 pr-1.5 py-1 rounded border bg-surface cursor-pointer text-xs transition-all",
                      isSelected
                        ? "border-accent ring-1 ring-accent/30 text-fg font-medium"
                        : "border-border hover:border-muted text-muted hover:text-fg"
                    )}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-border shadow-xs"
                      style={{ backgroundColor: hex }}
                    />
                    <span className="font-mono text-[11px]">{hex}</span>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveColor(hex, e)}
                      className="p-1 rounded text-muted hover:text-danger hover:bg-bg transition-colors ml-1"
                      title="Eliminar color"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

