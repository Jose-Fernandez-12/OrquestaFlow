import { configureStore } from '@reduxjs/toolkit';
import flowReducer from './flowSlice';
import queryReducer from './querySlice';
import connectionReducer from './connectionSlice';
import scriptReducer from './scriptSlice';
import scheduleReducer from './scheduleSlice';
import uiReducer from './uiSlice';

export const store = configureStore({
  reducer: {
    flows: flowReducer,
    queries: queryReducer,
    connections: connectionReducer,
    scripts: scriptReducer,
    schedules: scheduleReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
