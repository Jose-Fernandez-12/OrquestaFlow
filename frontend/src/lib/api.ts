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
