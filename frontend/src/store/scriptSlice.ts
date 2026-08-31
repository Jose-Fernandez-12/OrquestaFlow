import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface Script {
  id: string;
  name: string;
  description: string;
  file_path: string;
  language: string;
  schedule_cron: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
}

interface ScriptState {
  scripts: Script[];
  activeCount: number;
  executedToday: number;
  loading: boolean;
  executingId: string | null;
}

const initialState: ScriptState = {
  scripts: [],
  activeCount: 0,
  executedToday: 0,
  loading: false,
  executingId: null,
};

export const fetchScripts = createAsyncThunk('scripts/fetchAll', async () => {
  const res = await fetch(`${API_URL}/scripts`);
  const data = await res.json();
  return data;
});

export const executeScript = createAsyncThunk('scripts/execute', async (id: string) => {
  const res = await fetch(`${API_URL}/scripts/${id}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  return { id, result: await res.json() };
});

const scriptSlice = createSlice({
  name: 'scripts',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchScripts.pending, (state) => { state.loading = true; })
      .addCase(fetchScripts.fulfilled, (state, action) => {
        state.loading = false;
        state.scripts = action.payload.data;
        state.activeCount = action.payload.meta.activeCount;
        state.executedToday = action.payload.meta.executedToday;
      })
      .addCase(executeScript.pending, (state, action) => {
        state.executingId = action.meta.arg;
      })
      .addCase(executeScript.fulfilled, (state) => {
        state.executingId = null;
      })
      .addCase(executeScript.rejected, (state) => {
        state.executingId = null;
      });
  },
});

export default scriptSlice.reducer;
