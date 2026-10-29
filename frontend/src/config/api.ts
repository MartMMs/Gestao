import { readEnv } from './env';

export function getApiUrl(): string {
  const envUrl = readEnv().VITE_API_URL;
  if (envUrl) return envUrl;

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3333/api`;
}

export function getSocketUrl(): string {
  const envUrl = readEnv().VITE_SOCKET_URL;
  if (envUrl) return envUrl;

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3333`;
}
