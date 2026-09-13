import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';

import { FlowListView } from './components/flow/FlowListView';
import { FlowEditor } from './components/flow/FlowEditor';
import { DatabaseView } from './components/database/DatabaseView';
import { ScriptsView } from './components/scripts/ScriptsView';
import { ScheduleView } from './components/schedule/ScheduleView';

import { ErrorBoundary } from './components/ui/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<FlowListView />} />
            <Route path="/flujos" element={<FlowListView />} />
            <Route path="/flujos/:id" element={<FlowEditor />} />
            <Route path="/scripts" element={<ScriptsView />} />
            <Route path="/bases" element={<DatabaseView />} />
            <Route path="/programacion" element={<ScheduleView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
