import React, { Suspense, lazy } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AccessGate } from './components/layout/AccessGate';

const DashboardView = lazy(() =>
  import('./components/dashboard/DashboardView').then(m => ({ default: m.DashboardView }))
);
const FlowListView = lazy(() =>
  import('./components/flow/FlowListView').then(m => ({ default: m.FlowListView }))
);
const FlowEditor = lazy(() =>
  import('./components/flow/FlowEditor').then(m => ({ default: m.FlowEditor }))
);
const ScriptsView = lazy(() =>
  import('./components/scripts/ScriptsView').then(m => ({ default: m.ScriptsView }))
);
const DatabaseView = lazy(() =>
  import('./components/database/DatabaseView').then(m => ({ default: m.DatabaseView }))
);
const ScheduleView = lazy(() =>
  import('./components/schedule/ScheduleView').then(m => ({ default: m.ScheduleView }))
);
const ExecutionsView = lazy(() =>
  import('./components/executions/ExecutionsView').then(m => ({ default: m.ExecutionsView }))
);

function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted p-8">
      Cargando vista…
    </div>
  );
}

// Data router so the flow editor can block leaving with unsaved changes (useBlocker)
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: '/',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <DashboardView />
          </Suspense>
        ),
      },
      // Old address of the dashboard, kept for bookmarks
      { path: '/dashboard', element: <Navigate to="/" replace /> },
      {
        path: '/flujos',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <FlowListView />
          </Suspense>
        ),
      },
      {
        path: '/flujos/:id',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <FlowEditor />
          </Suspense>
        ),
      },
      {
        path: '/scripts',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <ScriptsView />
          </Suspense>
        ),
      },
      {
        path: '/bases',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <DatabaseView />
          </Suspense>
        ),
      },
      {
        path: '/programacion',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <ScheduleView />
          </Suspense>
        ),
      },
      {
        path: '/ejecuciones',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <ExecutionsView />
          </Suspense>
        ),
      },
    ],
  },
]);

function App() {
  return (
    <ErrorBoundary>
      <AccessGate>
        <RouterProvider router={router} />
      </AccessGate>
    </ErrorBoundary>
  );
}

export default App;
