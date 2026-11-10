import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';

const defaultHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
const RAW_URL = import.meta.env.VITE_API_URL || `http://${defaultHost}:3001`;
const BASE_URL = RAW_URL.replace(/\/+$/, '');

export const API_BASE_URL = BASE_URL;
export const API_URL = `${BASE_URL}/api`;
export const SOCKET_URL = BASE_URL;

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${cleanPath}`;
}

export function getFileUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${cleanPath}`;
}

/** Fired when the API answers 401: this browser needs the access key (see AccessGate) */
export const AUTH_REQUIRED_EVENT = 'orquesta:auth-required';

/**
 * The API runs on another port, so the browser only sends the access cookie of another computer
 * when a request asks for it. Every call to the API goes through window.fetch, so the option is
 * added there once instead of in each of the many fetch calls.
 */
export function installApiAccess(): void {
  if (typeof window === 'undefined' || (window.fetch as any).__orquesta) return;
  const original = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE_URL)) return original(input, init);
    const response = await original(input, { ...init, credentials: 'include' });
    if (response.status === 401 && !url.includes('/api/auth/')) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    return response;
  };
  (wrapped as any).__orquesta = true;
  window.fetch = wrapped as typeof window.fetch;
}

/** Socket for live progress, sending the access cookie like the API calls */
export function createSocket(options: Partial<ManagerOptions & SocketOptions> = {}) {
  return io(SOCKET_URL, { withCredentials: true, ...options });
}
