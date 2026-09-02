import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface Connection {
  id: string;
  name: string;
  group_name: string | null;
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
  grouped: Record<string, Record<string, Connection[]>>;
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
  return data as { data: Connection[]; grouped: Record<string, Record<string, Connection[]>> };
});

export const testConnection = createAsyncThunk('connections/test', async (id: string) => {
  const res = await fetch(`${API_URL}/connections/${id}/test`, { method: 'POST' });
  return res.json();
});

export const createConnection = createAsyncThunk('connections/create', async (connectionData: any) => {
  const res = await fetch(`${API_URL}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connectionData)
  });
  const data = await res.json();
  return data as { data: Connection };
});

export const updateConnection = createAsyncThunk('connections/update', async ({ id, ...connectionData }: { id: string } & any) => {
  const res = await fetch(`${API_URL}/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connectionData)
  });
  const data = await res.json();
  return data as { data: Connection };
});

export const deleteConnection = createAsyncThunk('connections/delete', async (id: string) => {
  const res = await fetch(`${API_URL}/connections/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Error deleting connection');
  return id;
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
      })
      .addCase(createConnection.fulfilled, (state, action) => {
        state.connections.push(action.payload.data);
        const groupName = action.payload.data.group_name || '';
        const region = action.payload.data.region;
        if (!state.grouped[groupName]) state.grouped[groupName] = {};
        if (!state.grouped[groupName][region]) state.grouped[groupName][region] = [];
        state.grouped[groupName][region].push(action.payload.data);
      })
      .addCase(updateConnection.fulfilled, (state, action) => {
        const idx = state.connections.findIndex(c => c.id === action.payload.data.id);
        if (idx >= 0) {
          const oldConn = state.connections[idx];
          const oldGroup = oldConn.group_name || '';
          const oldRegion = oldConn.region;
          state.connections[idx] = action.payload.data;
          
          if (oldGroup !== (action.payload.data.group_name || '') || oldRegion !== action.payload.data.region) {
            // Remove from old
            if (state.grouped[oldGroup] && state.grouped[oldGroup][oldRegion]) {
              state.grouped[oldGroup][oldRegion] = state.grouped[oldGroup][oldRegion].filter(c => c.id !== action.payload.data.id);
              if (state.grouped[oldGroup][oldRegion].length === 0) delete state.grouped[oldGroup][oldRegion];
              if (Object.keys(state.grouped[oldGroup]).length === 0) delete state.grouped[oldGroup];
            }
            
            // Add to new
            const newGroup = action.payload.data.group_name || '';
            const newRegion = action.payload.data.region;
            if (!state.grouped[newGroup]) state.grouped[newGroup] = {};
            if (!state.grouped[newGroup][newRegion]) state.grouped[newGroup][newRegion] = [];
            state.grouped[newGroup][newRegion].push(action.payload.data);
          } else {
            const gIdx = state.grouped[oldGroup][oldRegion].findIndex(c => c.id === action.payload.data.id);
            if (gIdx >= 0) state.grouped[oldGroup][oldRegion][gIdx] = action.payload.data;
          }
        }
        if (state.currentConnection?.id === action.payload.data.id) {
          state.currentConnection = action.payload.data;
        }
      })
      .addCase(deleteConnection.fulfilled, (state, action) => {
        const conn = state.connections.find(c => c.id === action.payload);
        if (conn) {
          const groupName = conn.group_name || '';
          if (state.grouped[groupName] && state.grouped[groupName][conn.region]) {
            state.grouped[groupName][conn.region] = state.grouped[groupName][conn.region].filter(c => c.id !== action.payload);
            if (state.grouped[groupName][conn.region].length === 0) delete state.grouped[groupName][conn.region];
            if (Object.keys(state.grouped[groupName]).length === 0) delete state.grouped[groupName];
          }
        }
        state.connections = state.connections.filter(c => c.id !== action.payload);
        if (state.currentConnection?.id === action.payload) {
          state.currentConnection = null;
        }
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
