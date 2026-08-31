import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface Schedule {
  id: string;
  target_type: 'flow' | 'script' | 'query';
  target_id: string;
  name: string;
  cron_expression: string;
  next_run_at: string | null;
  is_active: number;
  target_name?: string;
  created_at: string;
  updated_at: string;
}

interface ScheduleState {
  schedules: Schedule[];
  loading: boolean;
}

const initialState: ScheduleState = {
  schedules: [],
  loading: false,
};

export const fetchSchedules = createAsyncThunk('schedules/fetchAll', async () => {
  const res = await fetch(`${API_URL}/schedules`);
  const data = await res.json();
  return data.data as Schedule[];
});

export const createSchedule = createAsyncThunk('schedules/create', async (body: { target_type: string; target_id: string; name?: string; cron_expression: string }) => {
  const res = await fetch(`${API_URL}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.data as Schedule;
});

export const updateSchedule = createAsyncThunk('schedules/update', async ({ id, ...body }: { id: string; name?: string; cron_expression?: string; is_active?: number }) => {
  const res = await fetch(`${API_URL}/schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.data as Schedule;
});

const scheduleSlice = createSlice({
  name: 'schedules',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSchedules.pending, (state) => { state.loading = true; })
      .addCase(fetchSchedules.fulfilled, (state, action) => {
        state.loading = false;
        state.schedules = action.payload;
      })
      .addCase(createSchedule.fulfilled, (state, action) => {
        state.schedules.unshift(action.payload);
      })
      .addCase(updateSchedule.fulfilled, (state, action) => {
        const idx = state.schedules.findIndex(s => s.id === action.payload.id);
        if (idx >= 0) state.schedules[idx] = action.payload;
      });
  },
});

export default scheduleSlice.reducer;
