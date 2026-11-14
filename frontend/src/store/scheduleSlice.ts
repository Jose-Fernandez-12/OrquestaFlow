import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { API_URL, readApiResponse } from '../lib/api';

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
  error: string | null;
}

const initialState: ScheduleState = {
  schedules: [],
  loading: false,
  error: null,
};

export const fetchSchedules = createAsyncThunk('schedules/fetchAll', async () => {
  const res = await fetch(`${API_URL}/schedules`);
  const data = await readApiResponse<{ data: Schedule[] }>(res, 'Error al cargar programaciones');
  return data.data;
});

export const createSchedule = createAsyncThunk('schedules/create', async (body: { target_type: string; target_id: string; name?: string; cron_expression: string }) => {
  const res = await fetch(`${API_URL}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readApiResponse<{ data: Schedule }>(res, 'Error al crear programación');
  return data.data;
});

export const updateSchedule = createAsyncThunk('schedules/update', async ({ id, ...body }: { id: string; name?: string; cron_expression?: string; is_active?: number; target_type?: 'flow' | 'script' | 'query'; target_id?: string }) => {
  const res = await fetch(`${API_URL}/schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readApiResponse<{ data: Schedule }>(res, 'Error al actualizar programación');
  return data.data;
});

export const deleteSchedule = createAsyncThunk('schedules/delete', async (id: string) => {
  const res = await fetch(`${API_URL}/schedules/${id}`, {
    method: 'DELETE',
  });
  await readApiResponse(res, 'Error al eliminar programación');
  return id;
});

const scheduleSlice = createSlice({
  name: 'schedules',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSchedules.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSchedules.fulfilled, (state, action) => {
        state.loading = false;
        state.schedules = action.payload;
      })
      .addCase(fetchSchedules.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error al cargar programaciones';
      })
      .addCase(createSchedule.fulfilled, (state, action) => {
        state.error = null;
        state.schedules.unshift(action.payload);
      })
      .addCase(createSchedule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error al crear programación';
      })
      .addCase(updateSchedule.fulfilled, (state, action) => {
        state.error = null;
        const idx = state.schedules.findIndex(s => s.id === action.payload.id);
        if (idx >= 0) state.schedules[idx] = action.payload;
      })
      .addCase(updateSchedule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error al actualizar programación';
      })
      .addCase(deleteSchedule.fulfilled, (state, action) => {
        state.error = null;
        state.schedules = state.schedules.filter(s => s.id !== action.payload);
      })
      .addCase(deleteSchedule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error al eliminar programación';
      });
  },
});

export default scheduleSlice.reducer;
