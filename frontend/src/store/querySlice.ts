import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { API_URL } from '../lib/api';

export interface Query {
  id: string;
  name: string;
  group_name?: string | null;
  region?: string | null;
  sql_text: string;
  params: string; // JSON array
  connection_ids: string; // JSON array
  display_columns?: string; // JSON array
  last_run_at: string | null;
  last_row_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

interface QueryState {
  queries: Query[];
  currentQuery: Query | null;
  results: QueryResult | null;
  loading: boolean;
  executing: boolean;
  activeExecutionLogId: string | null;
  error: string | null;
}

const initialState: QueryState = {
  queries: [],
  currentQuery: null,
  results: null,
  loading: false,
  executing: false,
  activeExecutionLogId: null,
  error: null,
};

export const fetchQueries = createAsyncThunk('queries/fetchAll', async () => {
  const res = await fetch(`${API_URL}/queries`);
  const data = await res.json();
  return data.data as Query[];
});

export const createQuery = createAsyncThunk(
  'queries/create',
  async (body: { name: string; group_name?: string | null; region?: string | null; sql_text: string; connection_ids?: string[]; display_columns?: string[] }) => {
    const res = await fetch(`${API_URL}/queries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.data as Query;
  }
);

export const updateQuery = createAsyncThunk(
  'queries/update',
  async ({ id, ...body }: { id: string; name?: string; group_name?: string | null; region?: string | null; sql_text?: string; connection_ids?: string[]; display_columns?: string[] }) => {
    const res = await fetch(`${API_URL}/queries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.data as Query;
  }
);

export const deleteQuery = createAsyncThunk('queries/delete', async (id: string) => {
  const res = await fetch(`${API_URL}/queries/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Error deleting query');
  return id;
});

export const executeQuery = createAsyncThunk(
  'queries/execute',
  async ({ id, connection_ids, params, logId }: { id: string; connection_ids: string[]; params?: Record<string, string>; logId?: string }) => {
    const res = await fetch(`${API_URL}/queries/${id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_ids, params, logId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Error executing query');
    }
    return data.data as QueryResult;
  }
);

export const cancelQuery = createAsyncThunk(
  'queries/cancel',
  async ({ id, logId }: { id: string; logId?: string }) => {
    const res = await fetch(`${API_URL}/queries/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId }),
    });
    const data = await res.json();
    return data.data;
  }
);

const querySlice = createSlice({
  name: 'queries',
  initialState,
  reducers: {
    setCurrentQuery(state, action) {
      state.currentQuery = action.payload;
      state.results = null;
    },
    clearResults(state) {
      state.results = null;
    },
    setActiveExecutionLogId(state, action) {
      state.activeExecutionLogId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchQueries.pending, (state) => { state.loading = true; })
      .addCase(fetchQueries.fulfilled, (state, action) => {
        state.loading = false;
        state.queries = action.payload;
      })
      .addCase(fetchQueries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error';
      })
      .addCase(createQuery.fulfilled, (state, action) => {
        state.queries.unshift(action.payload);
        state.currentQuery = action.payload;
      })
      .addCase(updateQuery.fulfilled, (state, action) => {
        const idx = state.queries.findIndex(q => q.id === action.payload.id);
        if (idx >= 0) state.queries[idx] = action.payload;
        if (state.currentQuery?.id === action.payload.id) state.currentQuery = action.payload;
      })
      .addCase(deleteQuery.fulfilled, (state, action) => {
        state.queries = state.queries.filter(q => q.id !== action.payload);
        if (state.currentQuery?.id === action.payload) {
          state.currentQuery = null;
        }
      })
      .addCase(executeQuery.pending, (state, action) => {
        state.executing = true;
        state.activeExecutionLogId = action.meta.arg.logId || null;
      })
      .addCase(executeQuery.fulfilled, (state, action) => {
        state.executing = false;
        state.activeExecutionLogId = null;
        state.results = action.payload;
      })
      .addCase(executeQuery.rejected, (state) => {
        state.executing = false;
        state.activeExecutionLogId = null;
      })
      .addCase(cancelQuery.fulfilled, (state) => {
        state.executing = false;
        state.activeExecutionLogId = null;
      });
  },
});

export const { setCurrentQuery, clearResults, setActiveExecutionLogId } = querySlice.actions;
export default querySlice.reducer;
