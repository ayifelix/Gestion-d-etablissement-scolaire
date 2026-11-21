const buildEnvironment = (import.meta as ImportMeta & {
  env?: { VITE_API_URL?: string; DEV?: boolean };
}).env;

export const API_BASE_URL = (
  buildEnvironment?.VITE_API_URL ??
  (buildEnvironment?.DEV ? "http://localhost:4000/api" : "/api")
).replace(/\/+$/, "");
export const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    throw new Error(data?.error ?? (response.status === 429
      ? "Trop de tentatives. Réessayez dans quelques minutes."
      : "Le serveur ne renvoie pas une réponse valide. Vérifiez l'API et PostgreSQL."));
  }
  return data as T;
}
