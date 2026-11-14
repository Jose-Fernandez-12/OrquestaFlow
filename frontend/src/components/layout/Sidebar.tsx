import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  GitMerge,
  LayoutDashboard,
  Code2,
  Database,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Settings,
  HelpCircle,
  Layers
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toggleSidebar, openSettingsModal, openHelpModal, showToast } from '../../store/uiSlice';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ThemeSwitcher } from './ThemeSwitcher';
import { activateEnvironment, shortEnvironmentCode, useEnvironments } from '../settings/environmentsApi';

function envPillTone(slug: string | null | undefined): string {
  const code = shortEnvironmentCode(slug);
  if (code === 'PROD') return 'bg-danger/10 text-danger border-danger/30';
  if (code === 'STG') return 'bg-warn/15 text-amber-700 border-warn/35';
  if (code === 'DEV') return 'bg-success/10 text-success border-success/30';
  return 'bg-accent-light text-accent border-accent/30';
}

export function Sidebar() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const { environments, reload: reloadEnvs } = useEnvironments();
  const [switchingEnv, setSwitchingEnv] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { id: 'flujos', label: 'Flujos de trabajo', icon: GitMerge, path: '/flujos' },
    { id: 'scripts', label: 'Scripts', icon: Code2, path: '/scripts' },
    { id: 'bases', label: 'Bases de datos', icon: Database, path: '/bases' },
    { id: 'programacion', label: 'Programación', icon: Calendar, path: '/programacion' },
    { id: 'ejecuciones', label: 'Ejecuciones', icon: Activity, path: '/ejecuciones' },
  ];

  const activeEnv = environments?.find(e => Number(e.is_active) === 1) ?? environments?.[0] ?? null;
  const activeCode = shortEnvironmentCode(activeEnv?.slug);

  const handleSelectEnv = async (envId: string) => {
    if (!envId || envId === activeEnv?.id || switchingEnv) return;
    setSwitchingEnv(true);
    try {
      const updated = await activateEnvironment(envId);
      await reloadEnvs();
      dispatch(showToast(`Entorno activo: ${updated.name} (${shortEnvironmentCode(updated.slug)})`));
    } catch (err: unknown) {
      dispatch(showToast(`Error al cambiar entorno: ${err instanceof Error ? err.message : 'desconocido'}`));
    } finally {
      setSwitchingEnv(false);
    }
  };

  const isItemActive = (item: typeof navItems[0]) => {
    // '/' is a prefix of every route, so the dashboard only matches exactly
    if (item.id === 'dashboard') return location.pathname === '/';
    return location.pathname.startsWith(item.path);
  };

  const settings = useAppSelector((state) => state.settings?.settings);
  const userName = settings?.user_display_name || 'Jose Fernandez';
  const userRole = settings?.user_role_label || 'Administrador';
  const userInitials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase())
    .join('') || 'JF';

  return (
    <aside
      className={cn(
        "flex flex-col bg-surface border-r border-border transition-all duration-fast ease-standard z-10",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      {/* Logo & Toggle */}
      <div className="h-[60px] flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap font-display font-semibold">
            <div className="w-6 h-6 rounded-[6px] bg-accent flex items-center justify-center text-accent-on text-xs shrink-0">O</div>
            <span>OrquestaFlow</span>
          </div>
        )}
        <Button
          variant="icon"
          size="icon"
          onClick={() => dispatch(toggleSidebar())}
          className={cn(collapsed && "mx-auto")}
          title={collapsed ? "Expandir menu" : "Colapsar menu"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
      </div>

      {/* Active Environment Selector / Indicator */}
      <div className={cn("px-3 pt-3 pb-1", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button
            type="button"
            onClick={() => dispatch(openSettingsModal())}
            title={activeEnv ? `Entorno activo: ${activeEnv.name} (${activeCode})` : 'Entornos'}
            aria-label={activeEnv ? `Entorno activo: ${activeEnv.name}` : 'Entornos'}
            className={cn(
              "px-1.5 py-1 rounded border text-[10px] font-mono font-bold tracking-wider transition-colors",
              envPillTone(activeEnv?.slug)
            )}
          >
            {activeCode}
          </button>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm border border-border bg-bg/70">
            <Layers size={13} className="text-muted shrink-0" />
            <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wider shrink-0", envPillTone(activeEnv?.slug))}>
              {activeCode}
            </span>
            <select
              aria-label="Entorno activo"
              disabled={switchingEnv || !environments || environments.length === 0}
              value={activeEnv?.id || ''}
              onChange={(e) => void handleSelectEnv(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-xs font-medium text-fg focus:outline-none cursor-pointer truncate"
            >
              {!environments || environments.length === 0 ? (
                <option value="">Entorno local</option>
              ) : (
                environments.map(env => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))
              )}
            </select>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 flex flex-col gap-1 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={() => cn(
              "flex items-center gap-3 h-10 px-3 rounded-sm transition-colors relative group",
              isItemActive(item)
                ? "bg-accent-light text-accent font-medium before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:bg-accent before:rounded-r-sm"
                : "text-muted hover:bg-bg hover:text-fg"
            )}
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={20} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}

            {/* Tooltip for collapsed state */}
            {collapsed && (
              <div className="absolute left-[100%] ml-2 px-2 py-1 bg-fg text-surface text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 pointer-events-none">
                {item.label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer / User */}
      <div className="p-4 border-t border-border flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <Button
            variant="icon"
            size="sm"
            onClick={() => dispatch(openSettingsModal())}
            className="w-full justify-start gap-3"
            title="Configuración de tiempos de espera y sistema"
          >
            <Settings size={18} />
            {!collapsed && "Configuración"}
          </Button>
          <Button
            variant="icon"
            size="sm"
            onClick={() => dispatch(openHelpModal())}
            className="w-full justify-start gap-3"
            title="Guía rápida, variables y diagnóstico"
          >
            <HelpCircle size={18} />
            {!collapsed && "Ayuda"}
          </Button>
          <ThemeSwitcher collapsed={collapsed} />
        </div>

        <div className="mt-2 pt-2 border-t border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg border border-border flex items-center justify-center font-medium text-sm shrink-0">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{userName}</div>
              <div className="text-xs text-muted truncate">{userRole}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
