import React, { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, LogOut, ShieldCheck } from 'lucide-react';
import { getApiUrl } from '../../lib/api';
import { copyToClipboard } from '../../lib/clipboard';
import { Button } from '../ui/button';

type AccessInfo =
  | { kind: 'loading' }
  | { kind: 'server'; token: string; source: 'env' | 'file'; file: string }
  | { kind: 'remote' }
  | { kind: 'unavailable' };

/** The access key other computers need; shown only on the computer that runs the server */
export function AccessSettings() {
  const [info, setInfo] = useState<AccessInfo>({ kind: 'loading' });
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl('/auth/token'))
      .then(async res => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.data?.token) setInfo({ kind: 'server', ...json.data });
        else setInfo(res.status === 403 ? { kind: 'remote' } : { kind: 'unavailable' });
      })
      .catch(() => { if (!cancelled) setInfo({ kind: 'unavailable' }); });
    return () => { cancelled = true; };
  }, []);

  const copy = async (token: string) => {
    const ok = await copyToClipboard(token);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setVisible(true);
    }
  };

  const logout = async () => {
    await fetch(getApiUrl('/auth/logout'), { method: 'POST' }).catch(() => undefined);
    window.location.reload();
  };

  if (info.kind === 'loading' || info.kind === 'unavailable') return null;

  return (
    <div className="p-3.5 bg-bg rounded-md border border-border space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-accent" />
        <label className="text-xs font-semibold text-fg">Acceso desde otros equipos</label>
      </div>

      {info.kind === 'remote' ? (
        <>
          <p className="text-[11px] text-muted">Este navegador entró con la clave de acceso.</p>
          <Button type="button" variant="outline" size="sm" className="h-8 min-h-0 gap-1.5 text-xs" onClick={logout}>
            <LogOut size={13} /> Cerrar sesión en este navegador
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-xs">
              {visible ? info.token : '•'.repeat(Math.min(info.token.length, 24))}
            </code>
            <Button type="button" variant="icon" size="icon" onClick={() => setVisible(v => !v)}
              aria-label={visible ? 'Ocultar clave' : 'Mostrar clave'} title={visible ? 'Ocultar clave' : 'Mostrar clave'}>
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </Button>
            <Button type="button" variant="icon" size="icon" onClick={() => copy(info.token)} aria-label="Copiar clave" title="Copiar clave">
              {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            Este equipo entra sin clave. Otro equipo de la red la pide una vez al abrir OrquestaFlow.
            {info.source === 'env'
              ? ' Está definida en ORQUESTA_ACCESS_TOKEN.'
              : ` Se guarda en ${info.file}; bórralo y reinicia el servidor para generar una nueva.`}
          </p>
        </>
      )}
    </div>
  );
}
