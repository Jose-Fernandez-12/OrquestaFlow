import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';

import { FlowEditor } from './components/flow/FlowEditor';
import { DatabaseView } from './components/database/DatabaseView';
import { ScriptsView } from './components/scripts/ScriptsView';
import { ScheduleView } from './components/schedule/ScheduleView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<FlowEditor />} />
          <Route path="/scripts" element={<ScriptsView />} />
          <Route path="/bases" element={<DatabaseView />} />
          <Route path="/programacion" element={<ScheduleView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
