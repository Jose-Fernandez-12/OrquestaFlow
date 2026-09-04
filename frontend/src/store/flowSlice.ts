import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';

const API_URL = 'http://localhost:3001/api';

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  definition: string; // JSON string of { nodes, edges }
  status: string;
  is_locked?: number;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  last_run_record_count: number | null;
  created_at: string;
  updated_at: string;
}

interface FlowState {
  flows: Flow[];
  currentFlow: Flow | null;
  selectedNodeId: string | null;
  executingNodeIds: string[];
  completedNodeIds: string[];
  errorNodeIds: string[];
  nodeResults: Record<string, any>;
  nodeProgress: Record<string, { current: number; total: number }>;
  canvasExpanded: boolean;
  nodeLibraryExpanded: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: FlowState = {
  flows: [],
  currentFlow: null,
  selectedNodeId: null,
  executingNodeIds: [],
  completedNodeIds: [],
  errorNodeIds: [],
  nodeResults: {},
  nodeProgress: {},
  canvasExpanded: false,
  nodeLibraryExpanded: true,
  loading: false,
  error: null,
};

export const fetchFlows = createAsyncThunk('flows/fetchAll', async () => {
  const res = await fetch(`${API_URL}/flows`);
  const data = await res.json();
  return data.data as Flow[];
});

export const fetchFlow = createAsyncThunk('flows/fetchOne', async (id: string) => {
  const res = await fetch(`${API_URL}/flows/${id}`);
  const data = await res.json();
  return data.data as Flow;
});

export const createFlow = createAsyncThunk('flows/create', async (flowData: { name: string; description?: string; definition?: string; is_locked?: number }) => {
  const res = await fetch(`${API_URL}/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flowData),
  });
  const data = await res.json();
  return data.data as Flow;
});

export const saveFlow = createAsyncThunk('flows/save', async (flow: { id: string; definition?: string; name?: string; description?: string; status?: string; is_locked?: number }) => {
  const body: Record<string, any> = { status: flow.status || 'saved' };
  if (flow.definition !== undefined) body.definition = flow.definition;
  if (flow.name !== undefined) body.name = flow.name;
  if (flow.description !== undefined) body.description = flow.description;
  if (flow.is_locked !== undefined) body.is_locked = flow.is_locked;

  const res = await fetch(`${API_URL}/flows/${flow.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.data as Flow;
});

export const deleteFlow = createAsyncThunk('flows/delete', async (id: string) => {
  await fetch(`${API_URL}/flows/${id}`, {
    method: 'DELETE',
  });
  return id;
});

export const duplicateFlow = createAsyncThunk('flows/duplicate', async (flow: Flow) => {
  const res = await fetch(`${API_URL}/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${flow.name} (copia)`,
      description: flow.description || '',
      definition: flow.definition,
      is_locked: 0
    }),
  });
  const data = await res.json();
  return data.data as Flow;
});

export const executeFlow = createAsyncThunk('flows/execute', async (id: string) => {
  const res = await fetch(`${API_URL}/flows/${id}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();
  return data.data;
});

export const stopFlow = createAsyncThunk('flows/stop', async (id: string) => {
  const res = await fetch(`${API_URL}/flows/${id}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();
  return data.data;
});

const flowSlice = createSlice({
  name: 'flows',
  initialState,
  reducers: {
    setCurrentFlow(state, action: PayloadAction<Flow>) {
      state.currentFlow = action.payload;
    },
    selectNode(state, action: PayloadAction<string | null>) {
      state.selectedNodeId = action.payload;
    },
    setNodeExecuting(state, action: PayloadAction<string>) {
      if (!state.executingNodeIds.includes(action.payload)) {
        state.executingNodeIds.push(action.payload);
      }
    },
    setNodeCompleted(state, action: PayloadAction<{ nodeId: string; result?: any }>) {
      const { nodeId, result } = action.payload;
      state.executingNodeIds = state.executingNodeIds.filter(id => id !== nodeId);
      if (!state.completedNodeIds.includes(nodeId)) {
        state.completedNodeIds.push(nodeId);
      }
      if (result !== undefined) {
        state.nodeResults[nodeId] = result;
      }
    },
    setNodeError(state, action: PayloadAction<{ nodeId: string; error?: any }>) {
      const { nodeId, error } = action.payload;
      state.executingNodeIds = state.executingNodeIds.filter(id => id !== nodeId);
      if (!state.errorNodeIds.includes(nodeId)) {
        state.errorNodeIds.push(nodeId);
      }
      if (error !== undefined) {
        state.nodeResults[nodeId] = error;
      }
    },
    setNodeProgress(state, action: PayloadAction<{ nodeId: string; current: number; total: number }>) {
      const { nodeId, current, total } = action.payload;
      state.nodeProgress[nodeId] = { current, total };
    },
    resetNodeStates(state) {
      state.executingNodeIds = [];
      state.completedNodeIds = [];
      state.errorNodeIds = [];
      state.nodeResults = {};
      state.nodeProgress = {};
    },
    toggleCanvasExpanded(state) {
      state.canvasExpanded = !state.canvasExpanded;
    },
    toggleNodeLibraryExpanded(state) {
      state.nodeLibraryExpanded = !state.nodeLibraryExpanded;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFlows.pending, (state) => { state.loading = true; })
      .addCase(fetchFlows.fulfilled, (state, action) => {
        state.loading = false;
        state.flows = action.payload;
        if (!state.currentFlow && action.payload.length > 0) {
          state.currentFlow = action.payload[0];
        }
      })
      .addCase(fetchFlows.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Error loading flows';
      })
      .addCase(fetchFlow.fulfilled, (state, action) => {
        state.currentFlow = action.payload;
      })
      .addCase(createFlow.fulfilled, (state, action) => {
        state.flows.unshift(action.payload);
        state.currentFlow = action.payload;
      })
      .addCase(saveFlow.fulfilled, (state, action) => {
        state.currentFlow = action.payload;
        const idx = state.flows.findIndex(f => f.id === action.payload.id);
        if (idx >= 0) state.flows[idx] = action.payload;
      })
      .addCase(executeFlow.fulfilled, (state) => {
        state.executingNodeIds = [];
      })
      .addCase(stopFlow.fulfilled, (state) => {
        state.executingNodeIds = [];
      })
      .addCase(deleteFlow.fulfilled, (state, action) => {
        state.flows = state.flows.filter(f => f.id !== action.payload);
        if (state.currentFlow?.id === action.payload) {
          state.currentFlow = state.flows[0] || null;
        }
      })
      .addCase(duplicateFlow.fulfilled, (state, action) => {
        state.flows.unshift(action.payload);
      });
  },
});

export const {
  setCurrentFlow,
  selectNode,
  setNodeExecuting,
  setNodeCompleted,
  setNodeError,
  setNodeProgress,
  resetNodeStates,
  toggleCanvasExpanded,
  toggleNodeLibraryExpanded,
} = flowSlice.actions;

export default flowSlice.reducer;
