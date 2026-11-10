import React from 'react';
import { useAppDispatch } from '../../../../store/hooks';
import { openSettingsModal } from '../../../../store/uiSlice';
import { describeCredential, useCredentials, type CredentialType } from '../../../settings/credentialsApi';

interface CredentialPickerProps {
  value: string;
  onChange: (credentialId: string) => void;
  /** Only credentials of these types can be chosen (a database needs user and password) */
  types?: CredentialType[];
  id?: string;
}

/** Chooses one of the credentials saved in Configuración → Credenciales; the secret stays on the server */
export function CredentialPicker({ value, onChange, types, id = 'credential-picker' }: CredentialPickerProps) {
  const dispatch = useAppDispatch();
  const { credentials, error, reload } = useCredentials();
  const options = (credentials ?? []).filter(c => !types || types.includes(c.type));
  const selected = credentials?.find(c => c.id === value);
  const missing = !!value && credentials !== null && !selected;

  return (
    <div className="space-y-2 bg-bg/50 p-3 rounded border border-border">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-accent">Credencial</label>
        <button type="button" onClick={() => dispatch(openSettingsModal())} className="text-[11px] text-accent hover:underline">
          Gestionar credenciales
        </button>
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { void reload(); }}
        className="flex w-full min-h-[36px] rounded-sm border border-border bg-surface px-[9px] py-[6px] text-xs focus-visible:outline-none focus-visible:border-accent"
      >
        <option value="">{credentials === null ? 'Cargando…' : options.length === 0 ? 'No hay credenciales guardadas' : 'Elige una credencial…'}</option>
        {missing && <option value={value}>Credencial eliminada</option>}
        {options.map(c => <option key={c.id} value={c.id}>{c.name} — {describeCredential(c)}</option>)}
      </select>
      {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
      {missing && <p className="text-[11px] text-danger" role="alert">Esta credencial ya no existe. Elige otra.</p>}
      {!missing && (
        <p className="text-[10px] text-muted">
          {selected
            ? 'El secreto se usa en el servidor: no se guarda aquí ni se muestra al depurar.'
            : 'Se crean en Configuración → Credenciales y se guardan cifradas.'}
        </p>
      )}
    </div>
  );
}
