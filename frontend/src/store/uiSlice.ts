import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface UiState {
  sidebarCollapsed: boolean;
  activeView: 'flujos' | 'scripts' | 'bases' | 'programacion';
  toastMessage: string | null;
  toastVisible: boolean;
  scheduleModalOpen: boolean;
  queryModalOpen: boolean;
  queryModalMode: 'create' | 'edit';
  queryModalName: string;
}

const initialState: UiState = {
  sidebarCollapsed: localStorage.getItem('orquesta-menu-collapsed') === '1',
  activeView: 'flujos',
  toastMessage: null,
  toastVisible: false,
  scheduleModalOpen: false,
  queryModalOpen: false,
  queryModalMode: 'edit',
  queryModalName: '',
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      localStorage.setItem('orquesta-menu-collapsed', state.sidebarCollapsed ? '1' : '0');
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
      localStorage.setItem('orquesta-menu-collapsed', action.payload ? '1' : '0');
    },
    setActiveView(state, action: PayloadAction<UiState['activeView']>) {
      state.activeView = action.payload;
    },
    showToast(state, action: PayloadAction<string>) {
      state.toastMessage = action.payload;
      state.toastVisible = true;
    },
    hideToast(state) {
      state.toastVisible = false;
    },
    openScheduleModal(state) {
      state.scheduleModalOpen = true;
    },
    closeScheduleModal(state) {
      state.scheduleModalOpen = false;
    },
    openQueryModal(state, action: PayloadAction<{ mode: 'create' | 'edit'; name?: string }>) {
      state.queryModalOpen = true;
      state.queryModalMode = action.payload.mode;
      state.queryModalName = action.payload.name || '';
    },
    closeQueryModal(state) {
      state.queryModalOpen = false;
    },
  },
});

export const {
  toggleSidebar,
  setSidebarCollapsed,
  setActiveView,
  showToast,
  hideToast,
  openScheduleModal,
  closeScheduleModal,
  openQueryModal,
  closeQueryModal,
} = uiSlice.actions;

export default uiSlice.reducer;
