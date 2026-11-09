import React, { useState, useEffect } from 'react';
import { COLOR_THEMES, getSavedTheme, saveTheme } from '../../lib/theme';
import { Palette, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ThemeSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const [currentAccent, setCurrentAccent] = useState(getSavedTheme());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCurrentAccent(getSavedTheme());
  }, []);

  const handleSelect = (accentHex: string) => {
    setCurrentAccent(accentHex);
    saveTheme(accentHex);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2.5 w-full rounded-sm text-xs font-medium text-muted hover:text-fg hover:bg-bg transition-colors py-1.5 px-2",
          collapsed && "justify-center px-0"
        )}
        title="Cambiar color de acentuación"
      >
        <span
          className="w-4 h-4 rounded-full border border-border shadow-xs shrink-0 transition-transform hover:scale-110"
          style={{ backgroundColor: currentAccent }}
        />
        {!collapsed && (
          <span className="flex-1 text-left truncate flex items-center justify-between">
            <span>Color del tema</span>
            <Palette size={13} className="text-muted" />
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute z-50 bg-surface border border-border rounded-md shadow-raised p-2 w-56 bottom-full mb-2 animate-in fade-in-50 zoom-in-95",
              collapsed ? "left-12" : "left-0"
            )}
          >
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider px-2 py-1 mb-1">
              Color de Acentuación
            </div>
            <div className="space-y-1">
              {COLOR_THEMES.map((theme) => {
                const isSelected = currentAccent.toLowerCase() === theme.accent.toLowerCase();
                return (
                  <button
                    key={theme.id}
                    onClick={() => handleSelect(theme.accent)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-xs transition-colors text-left",
                      isSelected ? "bg-bg font-medium text-fg" : "hover:bg-bg text-muted hover:text-fg"
                    )}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-border shrink-0 shadow-xs flex items-center justify-center"
                      style={{ backgroundColor: theme.accent }}
                    >
                      {isSelected && <Check size={10} className="text-white" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate">{theme.name}</div>
                      <div className="text-[10px] text-muted font-mono">{theme.accent}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
