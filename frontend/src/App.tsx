import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';

import { FlowEditor } from './components/flow/FlowEditor';
const ScriptsView = () => <div className="p-8"><h2>Scripts (En construccion)</h2></div>;
const DatabaseView = () => <div className="p-8"><h2>Bases de datos (En construccion)</h2></div>;
const ScheduleView = () => <div className="p-8"><h2>Programacion (En construccion)</h2></div>;

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
