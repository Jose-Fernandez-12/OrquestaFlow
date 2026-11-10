import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../scripts/pythonEnvApi';

export type CredentialType = 'bearer' | 'basic' | 'api_key';

/** A stored credential as the API lists it: never its secret */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  username: string | null;
  header_name: string | null;
  notes: string | null;
  has_secret: boolean;
  updated_at: string;
  used_by: { connections: string[]; flows: string[] };
}

export interface CredentialForm {
  name: string;
  type: CredentialType;
  username: string;
  header_name: string;
  secret: string;
  notes: string;
}

export const CREDENTIAL_TYPE_LABEL: Record<CredentialType, string> = {
  bearer: 'Token (Bearer)',
  basic: 'Usuario y contraseña',
  api_key: 'Clave en una cabecera',
};

/** What a credential sends, in a few words, for pickers and lists */
export function describeCredential(c: Credential): string {
  if (c.type === 'basic') return `${CREDENTIAL_TYPE_LABEL.basic} · ${c.username ?? ''}`;
  if (c.type === 'api_key') return `Clave en la cabecera ${c.header_name ?? ''}`;
  return CREDENTIAL_TYPE_LABEL.bearer;
}

export const fetchCredentials = () => apiRequest<Credential[]>('/credentials');
export const createCredential = (form: CredentialForm) => apiRequest<Credential>('/credentials', 'POST', form);
export const updateCredential = (id: string, form: CredentialForm) => apiRequest<Credential>(`/credentials/${id}`, 'PUT', form);
export const deleteCredential = (id: string) => apiRequest(`/credentials/${id}`, 'DELETE');

/** The stored credentials, for a picker. `reload` after one is created elsewhere */
export function useCredentials() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return fetchCredentials().then(
      list => { setCredentials(list); setError(null); },
      (err: any) => setError(err?.message || 'No se pudieron cargar las credenciales'),
    );
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { credentials, error, reload };
}
