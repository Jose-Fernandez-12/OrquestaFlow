import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { hideToast } from '../../store/uiSlice';
import { AlertCircle, X } from 'lucide-react';
import { useEffect } from 'react';

export function AppLayout() {
  const dispatch = useAppDispatch();
  const { toastVisible, toastMessage } = useAppSelector((state: any) => state.ui);

  useEffect(() => {
    if (toastVisible) {
      const timer = setTimeout(() => {
        dispatch(hideToast());
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastVisible, dispatch]);

  return (
    <div className="flex h-screen w-full bg-bg overflow-hidden relative">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Outlet />
      </main>

      {/* Global Toast Notification */}
      {toastVisible && (
        <div className="fixed bottom-4 right-4 z-50 flex items-start gap-3 bg-surface p-4 rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.1)] animate-in slide-in-from-bottom-5 max-w-md border-l-4 border-l-danger border border-border">
          <AlertCircle className="shrink-0 mt-0.5 text-danger" size={18} />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold mb-1 text-fg">Atención</h4>
            <p className="text-xs text-muted break-words">{toastMessage}</p>
          </div>
          <button 
            onClick={() => dispatch(hideToast())}
            className="shrink-0 text-muted hover:text-fg ml-2"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
