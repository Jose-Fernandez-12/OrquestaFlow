import { useCallback, useEffect, useState } from 'react';
import { API_URL, readApiResponse } from '../../lib/api';

export interface EnvironmentRecord {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  variables: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export const ENVIRONMENTS_CHANGED_EVENT = 'orquesta:environments-changed';

function notifyEnvironmentsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ENVIRONMENTS_CHANGED_EVENT));
  }
}

export function shortEnvironmentCode(slug: string | null | undefined): string {
  const s = (slug || '').trim().toLowerCase();
  if (s === 'dev' || s === 'development') return 'DEV';
  if (s === 'staging' || s === 'stg') return 'STG';
  if (s === 'prod' || s === 'production') return 'PROD';
  return s ? s.toUpperCase().slice(0, 6) : 'DEV';
}

export async function fetchEnvironments(): Promise<EnvironmentRecord[]> {
  const res = await fetch(`${API_URL}/environments`);
  const payload = await readApiResponse<{ data: EnvironmentRecord[] }>(res, 'Error al cargar entornos');
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function createEnvironment(body: {
  name: string;
  slug?: string;
  variables: Record<string, string>;
}): Promise<EnvironmentRecord> {
  const res = await fetch(`${API_URL}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await readApiResponse<{ data: EnvironmentRecord }>(res, 'Error al crear entorno');
  notifyEnvironmentsChanged();
  return payload.data;
}

export async function updateEnvironment(
  id: string,
  body: { name?: string; slug?: string; variables?: Record<string, string> }
): Promise<EnvironmentRecord> {
  const res = await fetch(`${API_URL}/environments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await readApiResponse<{ data: EnvironmentRecord }>(res, 'Error al actualizar entorno');
  notifyEnvironmentsChanged();
  return payload.data;
}

export async function activateEnvironment(id: string): Promise<EnvironmentRecord> {
  const res = await fetch(`${API_URL}/environments/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const payload = await readApiResponse<{ data: EnvironmentRecord }>(res, 'Error al activar entorno');
  notifyEnvironmentsChanged();
  return payload.data;
}

export async function deleteEnvironment(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/environments/${id}`, { method: 'DELETE' });
  await readApiResponse(res, 'Error al eliminar entorno');
  notifyEnvironmentsChanged();
}

export function useEnvironments() {
  const [environments, setEnvironments] = useState<EnvironmentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return fetchEnvironments().then(
      list => {
        setEnvironments(list);
        setError(null);
        return list;
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar los entornos';
        setError(msg);
        return null;
      }
    );
  }, []);

  useEffect(() => {
    void reload();
    if (typeof window === 'undefined') return;
    const onChange = () => {
      void reload();
    };
    window.addEventListener(ENVIRONMENTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ENVIRONMENTS_CHANGED_EVENT, onChange);
  }, [reload]);

  return { environments, error, reload };
}
