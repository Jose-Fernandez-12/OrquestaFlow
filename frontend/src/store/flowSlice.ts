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

export const createFlow = createAsyncThunk('flows/create', async (flowData: { name: string; description?: string; definition?: string }) => {
  const res = await fetch(`${API_URL}/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flowData),
  });
  const data = await res.json();
  return data.data as Flow;
});

export const saveFlow = createAsyncThunk('flows/save', async (flow: { id: string; definition?: string; name?: string; description?: string }) => {
  const res = await fetch(`${API_URL}/flows/${flow.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition: flow.definition, name: flow.name, description: flow.description, status: 'saved' }),
  });
  const data = await res.json();
  return data.data as Flow;
});

export const executeFlow = createAsyncThunk('flows/execute', async (id: string) => {
  const res = await fetch(`${API_URL}/flows/${id}/execute`, { method: 'POST' });
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
    resetNodeStates(state) {
      state.executingNodeIds = [];
      state.completedNodeIds = [];
      state.errorNodeIds = [];
      state.nodeResults = {};
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
      });
  },
});

export const {
  setCurrentFlow,
  selectNode,
  setNodeExecuting,
  setNodeCompleted,
  setNodeError,
  resetNodeStates,
  toggleCanvasExpanded,
  toggleNodeLibraryExpanded,
} = flowSlice.actions;

export default flowSlice.reducer;
