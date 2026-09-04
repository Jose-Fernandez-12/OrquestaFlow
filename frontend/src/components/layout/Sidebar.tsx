import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  GitMerge,
  Code2,
  Database,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Settings,
  HelpCircle,
  LogOut
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toggleSidebar } from '../../store/uiSlice';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export function Sidebar() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);

  const navItems = [
    { id: 'flujos', label: 'Flujos de trabajo', icon: GitMerge, path: '/' },
    { id: 'scripts', label: 'Scripts', icon: Code2, path: '/scripts' },
    { id: 'bases', label: 'Bases de datos', icon: Database, path: '/bases' },
    { id: 'programacion', label: 'Programación', icon: Calendar, path: '/programacion' },
  ];

  const isItemActive = (item: typeof navItems[0]) => {
    if (item.id === 'flujos') {
      return location.pathname === '/' || location.pathname.startsWith('/flujos');
    }
    return location.pathname.startsWith(item.path);
  };

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

      {/* Navigation */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
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
          <Button variant="icon" size="sm" className="w-full justify-start gap-3">
            <Settings size={18} />
            {!collapsed && "Configuración"}
          </Button>
          <Button variant="icon" size="sm" className="w-full justify-start gap-3">
            <HelpCircle size={18} />
            {!collapsed && "Ayuda"}
          </Button>
        </div>

        <div className="mt-2 pt-2 border-t border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg border border-border flex items-center justify-center font-medium text-sm shrink-0">
            JF
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">Jose Fernandez</div>
              <div className="text-xs text-muted truncate">Adminisitrador</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
