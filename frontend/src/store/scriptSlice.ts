import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { API_URL } from '../lib/api';

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
}

const initialState: ScriptState = {
  scripts: [],
  activeCount: 0,
  executedToday: 0,
  loading: false,
};

export const fetchScripts = createAsyncThunk('scripts/fetchAll', async () => {
  const res = await fetch(`${API_URL}/scripts`);
  const data = await res.json();
  return data;
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
      });
  },
});

export default scriptSlice.reducer;
