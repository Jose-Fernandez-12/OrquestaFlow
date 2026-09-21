import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Clock,
  Database,
  Globe,
  Code2,
  Sliders,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { closeSettingsModal, showToast } from '../../store/uiSlice';
import { updateSettings, resetSettings, type SystemSettings } from '../../store/settingsSlice';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

export function SettingsModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.settingsModalOpen);
  const { settings, saving, loading } = useAppSelector((state) => state.settings);

  const [activeTab, setActiveTab] = useState<'timeouts' | 'display'>('timeouts');
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
      setHasChanges(false);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleChange = (key: keyof SystemSettings, value: any) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      setHasChanges(true);
      return next;
    });
  };

  const handleNumberChange = (key: keyof SystemSettings, valStr: string, min = 1) => {
    const parsed = parseInt(valStr, 10);
    const num = isNaN(parsed) ? min : Math.max(min, parsed);
    handleChange(key, num);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await dispatch(updateSettings(formData)).unwrap();
      dispatch(showToast('Configuración guardada exitosamente'));
      setHasChanges(false);
      dispatch(closeSettingsModal());
    } catch (err: any) {
      dispatch(showToast(`Error al guardar: ${err.message}`));
    }
  };

  const handleReset = async () => {
    if (window.confirm('¿Deseas restablecer todos los valores de configuración a sus valores iniciales por defecto?')) {
      try {
        await dispatch(resetSettings()).unwrap();
        dispatch(showToast('Configuración restablecida'));
        setHasChanges(false);
      } catch (err: any) {
        dispatch(showToast(`Error al restablecer: ${err.message}`));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-accent/10 text-accent">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-fg">Configuración del Sistema</h2>
              <p className="text-xs text-muted">Ajusta tiempos de espera, límites y preferencias generales</p>
            </div>
          </div>
          <button
            onClick={() => dispatch(closeSettingsModal())}
            className="p-1 rounded-md text-muted hover:text-fg hover:bg-bg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border bg-bg/50 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('timeouts')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'timeouts'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <Clock size={14} />
            Tiempos de Espera (Timeouts)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('display')}
            className={cn(
              "flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'display'
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted hover:text-fg"
            )}
          >
            <Sliders size={14} />
            Visualización y Tablas
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'timeouts' && (
            <div className="space-y-4">
              <div className="p-3 bg-accent-light border border-accent/20 rounded-md text-xs text-fg leading-relaxed">
                Los límites de tiempo aplican tanto a la ejecución de flujos de trabajo como a las consultas directas en bases de datos y scripts del backend.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* HTTP Timeout */}
                <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                      <Globe size={14} className="text-accent" />
                      Peticiones HTTP
                    </label>
                    <span className="text-[11px] font-mono text-muted">segundos</span>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    value={formData.http_timeout_seconds || 30}
                    onChange={(e) => handleNumberChange('http_timeout_seconds', e.target.value, 1)}
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted">
                    Límite máximo para nodos HTTP (`GET`, `POST`, etc.). Por defecto: 30s.
                  </p>
                </div>

                {/* SQL Connection Timeout */}
                <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                      <Database size={14} className="text-accent" />
                      Conexión a Base de Datos
                    </label>
                    <span className="text-[11px] font-mono text-muted">segundos</span>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={formData.mssql_connection_timeout_seconds || 30}
                    onChange={(e) => handleNumberChange('mssql_connection_timeout_seconds', e.target.value, 1)}
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted">
                    Tiempo para establecer handshake inicial con el servidor SQL. Por defecto: 30s.
                  </p>
                </div>

                {/* SQL Request Timeout */}
                <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                      <Database size={14} className="text-accent" />
                      Ejecución de Query SQL
                    </label>
                    <span className="text-[11px] font-mono text-muted">segundos</span>
                  </div>
                  <Input
                    type="number"
                    min={5}
                    max={3600}
                    value={formData.mssql_request_timeout_seconds || 300}
                    onChange={(e) => handleNumberChange('mssql_request_timeout_seconds', e.target.value, 5)}
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted">
                    Límite para consultas pesadas antes de cancelar en el motor. Por defecto: 300s (5 min).
                  </p>
                </div>

                {/* Script Execution Timeout */}
                <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                      <Code2 size={14} className="text-accent" />
                      Scripts Python / JS
                    </label>
                    <span className="text-[11px] font-mono text-muted">segundos</span>
                  </div>
                  <Input
                    type="number"
                    min={5}
                    max={1800}
                    value={formData.script_timeout_seconds || 60}
                    onChange={(e) => handleNumberChange('script_timeout_seconds', e.target.value, 5)}
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted">
                    Tiempo de espera para procesos hijo de scripts externos. Por defecto: 60s.
                  </p>
                </div>
              </div>

              {/* Retries */}
              <div className="p-3.5 bg-bg rounded-md border border-border flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label className="text-xs font-semibold text-fg">Reintentos automáticos HTTP</label>
                  <p className="text-[11px] text-muted">Cantidad de intentos adicionales ante fallos de conexión transitorios (0 a 5)</p>
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={formData.http_max_retries ?? 1}
                    onChange={(e) => handleNumberChange('http_max_retries', e.target.value, 0)}
                    className="h-8 text-xs font-mono text-center"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'display' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-fg">Límite de filas en previsualización de tablas</label>
                  <span className="text-[11px] font-mono text-muted">filas</span>
                </div>
                <select
                  value={formData.table_preview_row_limit || 500}
                  onChange={(e) => handleNumberChange('table_preview_row_limit', e.target.value, 50)}
                  className="flex w-full min-h-[36px] rounded-sm border border-border bg-surface px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:border-accent"
                >
                  <option value={100}>100 filas (máximo rendimiento)</option>
                  <option value={250}>250 filas</option>
                  <option value={500}>500 filas (recomendado)</option>
                  <option value={1000}>1000 filas</option>
                </select>
                <p className="text-[11px] text-muted">
                  Controla la cantidad de registros renderizados en pantalla al explorar resultados de consultas SQL o archivos cargados en nodos de datos.
                </p>
              </div>
            </div>
          )}
        </form>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-surface">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-xs text-muted hover:text-fg gap-1.5"
            title="Restablecer todos los valores iniciales"
          >
            <RotateCcw size={13} />
            Restablecer predeterminados
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => dispatch(closeSettingsModal())}
              className="text-xs h-8"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="text-xs h-8 gap-1.5"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Guardar configuración
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
