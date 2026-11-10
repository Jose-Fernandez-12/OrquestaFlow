import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { AUTH_REQUIRED_EVENT, getApiUrl } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type GateState =
  | { phase: 'checking' }
  | { phase: 'open' }
  | { phase: 'locked'; code: string | null };

/**
 * On the computer that runs OrquestaFlow the app opens directly. On any other computer of the network
 * it first asks for the access key (Configuración → General on the server computer).
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'checking' });
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(getApiUrl('/auth/status'))
      .then(res => res.json())
      .then(json => setState(json?.data?.authenticated ? { phase: 'open' } : { phase: 'locked', code: json?.data?.code ?? null }))
      // Server unreachable: the app shows its own connection errors
      .catch(() => setState({ phase: 'open' }));

    const onAuthRequired = () => setState({ phase: 'locked', code: 'auth_required' });
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) {
      setError('Escribe la clave de acceso.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        return;
      }
      setToken('');
      // Data loaded while locked came back empty: start the app again with access
      window.location.reload();
    } catch {
      setError('No se pudo contactar con el servidor.');
    } finally {
      setSending(false);
    }
  };

  if (state.phase === 'open') return <>{children}</>;

  if (state.phase === 'checking') {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-bg text-muted">
        <Loader2 size={20} className="animate-spin" aria-label="Comprobando acceso" />
      </div>
    );
  }

  const blockedByName = state.code === 'host_not_allowed' || state.code === 'origin_not_allowed';

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-md shadow-raised p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-accent-light text-accent flex items-center justify-center shrink-0">
            {blockedByName ? <ShieldAlert size={20} /> : <KeyRound size={20} />}
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Acceso a OrquestaFlow</h1>
            <p className="text-xs text-muted">
              {blockedByName ? 'Este nombre de servidor no está permitido.' : 'Estás entrando desde otro equipo de la red.'}
            </p>
          </div>
        </div>

        {blockedByName ? (
          <p className="text-sm text-muted">
            Abre OrquestaFlow con la dirección IP o el nombre del equipo servidor, o añade este nombre a
            <code className="mx-1 font-mono text-xs">ORQUESTA_ALLOWED_HOSTS</code>en <code className="font-mono text-xs">backend/.env</code>.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="access-token" className="text-xs font-medium">Clave de acceso</label>
              <Input
                id="access-token"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={token}
                onChange={(e) => { setToken(e.target.value); setError(null); }}
                className="font-mono"
              />
              <p className="text-[11px] text-muted">
                Está en Configuración → General, en el equipo donde corre OrquestaFlow. Este navegador la recordará.
              </p>
            </div>
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            <Button type="submit" variant="primary" size="sm" className="w-full gap-2" disabled={sending}>
              {sending && <Loader2 size={14} className="animate-spin" />}
              Entrar
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
