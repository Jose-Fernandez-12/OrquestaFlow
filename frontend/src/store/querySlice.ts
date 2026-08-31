import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface Query {
  id: string;
  name: string;
  sql_text: string;
  params: string; // JSON array
  connection_ids: string; // JSON array
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
  error: string | null;
}

const initialState: QueryState = {
  queries: [],
  currentQuery: null,
  results: null,
  loading: false,
  executing: false,
  error: null,
};

export const fetchQueries = createAsyncThunk('queries/fetchAll', async () => {
  const res = await fetch(`${API_URL}/queries`);
  const data = await res.json();
  return data.data as Query[];
});

export const createQuery = createAsyncThunk('queries/create', async (body: { name: string; sql_text: string; connection_ids?: string[] }) => {
  const res = await fetch(`${API_URL}/queries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.data as Query;
});

export const updateQuery = createAsyncThunk('queries/update', async ({ id, ...body }: { id: string; name?: string; sql_text?: string; connection_ids?: string[] }) => {
  const res = await fetch(`${API_URL}/queries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.data as Query;
});

export const executeQuery = createAsyncThunk('queries/execute', async ({ id, connection_ids, params }: { id: string; connection_ids: string[]; params?: Record<string, string> }) => {
  const res = await fetch(`${API_URL}/queries/${id}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection_ids, params }),
  });
  const data = await res.json();
  return data.data as QueryResult;
});

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
      .addCase(executeQuery.pending, (state) => { state.executing = true; })
      .addCase(executeQuery.fulfilled, (state, action) => {
        state.executing = false;
        state.results = action.payload;
      })
      .addCase(executeQuery.rejected, (state) => {
        state.executing = false;
      });
  },
});

export const { setCurrentQuery, clearResults } = querySlice.actions;
export default querySlice.reducer;
