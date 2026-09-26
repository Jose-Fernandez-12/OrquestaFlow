import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { API_URL } from '../lib/api';

export interface SystemSettings {
  http_timeout_seconds: number;
  mssql_connection_timeout_seconds: number;
  mssql_request_timeout_seconds: number;
  script_timeout_seconds: number;
  http_max_retries: number;
  table_preview_row_limit: number;
  user_display_name: string;
  user_role_label: string;
  experimental_nodes_enabled: boolean;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  http_timeout_seconds: 30,
  mssql_connection_timeout_seconds: 30,
  mssql_request_timeout_seconds: 300,
  script_timeout_seconds: 60,
  http_max_retries: 1,
  table_preview_row_limit: 500,
  user_display_name: 'Jose Fernandez',
  user_role_label: 'Administrador',
  experimental_nodes_enabled: false,
};

// Safe load from localStorage if available
function loadLocalFallback(): SystemSettings {
  try {
    const cached = localStorage.getItem('orquesta-system-settings');
    if (cached) {
      return { ...DEFAULT_SYSTEM_SETTINGS, ...JSON.parse(cached) };
    }
  } catch {}
  return DEFAULT_SYSTEM_SETTINGS;
}

interface SettingsState {
  settings: SystemSettings;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const initialState: SettingsState = {
  settings: loadLocalFallback(),
  loading: false,
  saving: false,
  error: null,
};

export const fetchSettings = createAsyncThunk('settings/fetchAll', async () => {
  const res = await fetch(`${API_URL}/settings`);
  if (!res.ok) throw new Error('Error al cargar configuración del sistema');
  const data = await res.json();
  return data.data as SystemSettings;
});

export const updateSettings = createAsyncThunk(
  'settings/update',
  async (body: Partial<SystemSettings>) => {
    const res = await fetch(`${API_URL}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Error al actualizar configuración');
    return data.data as SystemSettings;
  }
);

export const resetSettings = createAsyncThunk('settings/reset', async () => {
  const res = await fetch(`${API_URL}/settings/reset`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Error al restablecer configuración');
  return data.data as SystemSettings;
});

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setLocalSetting(state, action: PayloadAction<{ key: keyof SystemSettings; value: any }>) {
      (state.settings as any)[action.payload.key] = action.payload.value;
      try {
        localStorage.setItem('orquesta-system-settings', JSON.stringify(state.settings));
      } catch {}
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.settings = { ...DEFAULT_SYSTEM_SETTINGS, ...action.payload };
        try {
          localStorage.setItem('orquesta-system-settings', JSON.stringify(state.settings));
        } catch {}
      })
      .addCase(fetchSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error al cargar configuración';
      })
      // Update
      .addCase(updateSettings.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateSettings.fulfilled, (state, action) => {
        state.saving = false;
        state.settings = { ...DEFAULT_SYSTEM_SETTINGS, ...action.payload };
        try {
          localStorage.setItem('orquesta-system-settings', JSON.stringify(state.settings));
        } catch {}
      })
      .addCase(updateSettings.rejected, (state, action) => {
        state.saving = false;
        state.error = action.error.message || 'Error al guardar configuración';
      })
      // Reset
      .addCase(resetSettings.fulfilled, (state, action) => {
        state.settings = { ...DEFAULT_SYSTEM_SETTINGS, ...action.payload };
        try {
          localStorage.setItem('orquesta-system-settings', JSON.stringify(state.settings));
        } catch {}
      });
  },
});

export const { setLocalSetting } = settingsSlice.actions;
export default settingsSlice.reducer;
