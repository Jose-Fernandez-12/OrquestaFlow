import React, { useState } from 'react';
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  CREDENTIAL_TYPE_LABEL, createCredential, deleteCredential, describeCredential, updateCredential, useCredentials,
  type Credential, type CredentialForm, type CredentialType,
} from './credentialsApi';

const EMPTY: CredentialForm = { name: '', type: 'bearer', username: '', header_name: 'X-API-Key', secret: '', notes: '' };

const SECRET_LABEL: Record<CredentialType, string> = { bearer: 'Token', basic: 'Contraseña', api_key: 'Clave' };

const selectClass = 'flex w-full min-h-[36px] rounded-sm border border-border bg-surface px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:border-accent';

function usageText(c: Credential): string {
  const parts = [
    c.used_by.connections.length > 0 ? `${c.used_by.connections.length} ${c.used_by.connections.length === 1 ? 'conexión' : 'conexiones'}` : '',
    c.used_by.flows.length > 0 ? `${c.used_by.flows.length} ${c.used_by.flows.length === 1 ? 'flujo' : 'flujos'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `En uso: ${parts.join(' y ')}` : 'Sin usar';
}

/** Secrets saved once, encrypted, and picked by name in HTTP nodes and SQL Server connections */
export function CredentialsSettings() {
  const { credentials, error: loadError, reload } = useCredentials();
  const [editing, setEditing] = useState<{ id: string | null; form: CredentialForm } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (credential?: Credential) => {
    setError(null);
    setEditing(credential
      ? { id: credential.id, form: { name: credential.name, type: credential.type, username: credential.username ?? '', header_name: credential.header_name ?? 'X-API-Key', secret: '', notes: credential.notes ?? '' } }
      : { id: null, form: EMPTY });
  };

  const set = (patch: Partial<CredentialForm>) => {
    setError(null);
    setEditing(current => current && { ...current, form: { ...current.form, ...patch } });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id) await updateCredential(editing.id, editing.form);
      else await createCredential(editing.form);
      setEditing(null);
      await reload();
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar la credencial');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (credential: Credential) => {
    if (!window.confirm(`¿Eliminar la credencial «${credential.name}»? No se puede deshacer.`)) return;
    try {
      await deleteCredential(credential.id);
      setError(null);
      await reload();
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar la credencial');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-muted leading-relaxed">
          Guarda aquí tokens, claves y contraseñas una sola vez. Se guardan cifrados y no se vuelven a mostrar.
          Elígelos por nombre en la pestaña <b>Autenticación</b> de un nodo HTTP o en una conexión SQL Server, o escribe
          <code className="mx-1 font-mono">cred:nombre</code>en los campos de secreto de los nodos de IA, OAuth2 y Webhook.
        </p>
        {!editing && (
          <Button type="button" variant="default" size="sm" className="h-8 min-h-0 gap-1.5 text-xs shrink-0" onClick={() => open()}>
            <Plus size={13} /> Nueva
          </Button>
        )}
      </div>

      {(error || loadError) && !editing && <p className="text-xs text-danger" role="alert">{error || loadError}</p>}

      {editing && (
        <form onSubmit={save} className="p-3.5 bg-bg rounded-md border border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="cred-name" className="text-xs font-semibold">Nombre</label>
              <Input id="cred-name" value={editing.form.name} onChange={(e) => set({ name: e.target.value })} placeholder="api-ventas" className="h-8 text-xs font-mono" autoFocus />
            </div>
            <div className="space-y-1">
              <label htmlFor="cred-type" className="text-xs font-semibold">Tipo</label>
              <select id="cred-type" value={editing.form.type} onChange={(e) => set({ type: e.target.value as CredentialType })} className={selectClass}>
                {(Object.keys(CREDENTIAL_TYPE_LABEL) as CredentialType[]).map(type => (
                  <option key={type} value={type}>{CREDENTIAL_TYPE_LABEL[type]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {editing.form.type === 'basic' && (
              <div className="space-y-1">
                <label htmlFor="cred-user" className="text-xs font-semibold">Usuario</label>
                <Input id="cred-user" value={editing.form.username} onChange={(e) => set({ username: e.target.value })} className="h-8 text-xs font-mono" autoComplete="off" />
              </div>
            )}
            {editing.form.type === 'api_key' && (
              <div className="space-y-1">
                <label htmlFor="cred-header" className="text-xs font-semibold">Cabecera</label>
                <Input id="cred-header" value={editing.form.header_name} onChange={(e) => set({ header_name: e.target.value })} placeholder="X-API-Key" className="h-8 text-xs font-mono" />
              </div>
            )}
            <div className={editing.form.type === 'bearer' ? 'col-span-2 space-y-1' : 'space-y-1'}>
              <label htmlFor="cred-secret" className="text-xs font-semibold">{SECRET_LABEL[editing.form.type]}</label>
              <Input
                id="cred-secret"
                type="password"
                value={editing.form.secret}
                onChange={(e) => set({ secret: e.target.value })}
                placeholder={editing.id ? 'Guardado · vacío para mantenerlo' : ''}
                className="h-8 text-xs font-mono"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="cred-notes" className="text-xs font-semibold">Nota <span className="font-normal text-muted">(opcional)</span></label>
            <Input id="cred-notes" value={editing.form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Para qué sirve o cuándo caduca" className="h-8 text-xs" />
          </div>

          {error && <p className="text-xs text-danger" role="alert">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="default" size="sm" className="h-8 min-h-0 text-xs" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" variant="primary" size="sm" className="h-8 min-h-0 text-xs gap-1.5" disabled={saving}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {editing.id ? 'Guardar cambios' : 'Guardar credencial'}
            </Button>
          </div>
        </form>
      )}

      {credentials === null && !loadError && <p className="text-xs text-muted">Cargando…</p>}

      {credentials?.length === 0 && !editing && (
        <div className="p-6 text-center border border-dashed border-border rounded-md space-y-2">
          <KeyRound size={18} className="mx-auto text-muted" />
          <p className="text-sm font-medium">Guarda tu primera credencial</p>
          <p className="text-xs text-muted">Así el token de una API no queda escrito dentro de cada nodo que la usa.</p>
        </div>
      )}

      {credentials && credentials.length > 0 && (
        <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {credentials.map(credential => (
            <li key={credential.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface">
              <KeyRound size={14} className="text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold font-mono truncate">{credential.name}</div>
                <div className="text-[11px] text-muted truncate" title={[...credential.used_by.connections, ...credential.used_by.flows].join(', ') || undefined}>
                  {describeCredential(credential)} · {usageText(credential)}{credential.notes ? ` · ${credential.notes}` : ''}
                </div>
              </div>
              <Button type="button" variant="icon" size="icon" onClick={() => open(credential)} aria-label={`Editar ${credential.name}`} title="Editar">
                <Pencil size={14} />
              </Button>
              <Button type="button" variant="icon" size="icon" onClick={() => remove(credential)} aria-label={`Eliminar ${credential.name}`} title="Eliminar">
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
