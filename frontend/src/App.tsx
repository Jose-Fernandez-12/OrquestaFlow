import React from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';

import { FlowListView } from './components/flow/FlowListView';
import { FlowEditor } from './components/flow/FlowEditor';
import { DashboardView } from './components/dashboard/DashboardView';
import { DatabaseView } from './components/database/DatabaseView';
import { ScriptsView } from './components/scripts/ScriptsView';
import { ScheduleView } from './components/schedule/ScheduleView';

import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Data router so the flow editor can block leaving with unsaved changes (useBlocker)
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardView /> },
      // Old address of the dashboard, kept for bookmarks
      { path: '/dashboard', element: <Navigate to="/" replace /> },
      { path: '/flujos', element: <FlowListView /> },
      { path: '/flujos/:id', element: <FlowEditor /> },
      { path: '/scripts', element: <ScriptsView /> },
      { path: '/bases', element: <DatabaseView /> },
      { path: '/programacion', element: <ScheduleView /> },
    ],
  },
]);

function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export default App;
