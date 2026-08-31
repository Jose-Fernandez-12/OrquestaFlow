import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface Connection {
  id: string;
  name: string;
  region: string;
  city: string | null;
  host: string;
  database_name: string;
  port: number;
  driver: string;
  env_credential_key: string | null;
  is_active: number;
  last_tested_at: string | null;
  created_at: string;
}

interface ConnectionState {
  connections: Connection[];
  grouped: Record<string, Connection[]>;
  currentConnection: Connection | null;
  selectedDestinations: string[];
  loading: boolean;
  error: string | null;
}

const initialState: ConnectionState = {
  connections: [],
  grouped: {},
  currentConnection: null,
  selectedDestinations: [],
  loading: false,
  error: null,
};

export const fetchConnections = createAsyncThunk('connections/fetchAll', async () => {
  const res = await fetch(`${API_URL}/connections`);
  const data = await res.json();
  return data as { data: Connection[]; grouped: Record<string, Connection[]> };
});

export const testConnection = createAsyncThunk('connections/test', async (id: string) => {
  const res = await fetch(`${API_URL}/connections/${id}/test`, { method: 'POST' });
  return res.json();
});

const connectionSlice = createSlice({
  name: 'connections',
  initialState,
  reducers: {
    setCurrentConnection(state, action) {
      state.currentConnection = action.payload;
    },
    toggleDestination(state, action) {
      const id = action.payload as string;
      const idx = state.selectedDestinations.indexOf(id);
      if (idx >= 0) {
        state.selectedDestinations.splice(idx, 1);
      } else {
        state.selectedDestinations.push(id);
      }
    },
    selectAllDestinations(state) {
      state.selectedDestinations = state.connections.map(c => c.id);
    },
    clearDestinations(state) {
      state.selectedDestinations = [];
    },
    setDestinations(state, action) {
      state.selectedDestinations = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConnections.pending, (state) => { state.loading = true; })
      .addCase(fetchConnections.fulfilled, (state, action) => {
        state.loading = false;
        state.connections = action.payload.data;
        state.grouped = action.payload.grouped;
      })
      .addCase(fetchConnections.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error';
      });
  },
});

export const {
  setCurrentConnection,
  toggleDestination,
  selectAllDestinations,
  clearDestinations,
  setDestinations,
} = connectionSlice.actions;

export default connectionSlice.reducer;
