import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[200px] p-6 flex flex-col items-center justify-center text-center bg-surface border border-red-500/20 rounded-md m-4">
          <div className="p-3 bg-red-500/10 text-red-500 rounded-full mb-3">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-sm font-semibold text-fg mb-1">Se produjo un error en la interfaz</h3>
          <p className="text-xs text-muted max-w-md mb-4 font-mono">
            {this.state.error?.message || 'Error inesperado al renderizar el componente.'}
          </p>
          <Button
            size="sm"
            onClick={this.handleReset}
            className="flex items-center gap-1.5"
          >
            <RotateCw size={13} />
            <span>Reintentar</span>
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
