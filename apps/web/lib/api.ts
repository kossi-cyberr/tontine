import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveTokens,
  type TokenPair,
} from './session';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3051';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function refreshTokens(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    return null;
  }

  const tokens = (await response.json()) as TokenPair;
  saveTokens(tokens);
  return tokens.access_token;
}

/** Appel API authentifié, avec une tentative de renouvellement du jeton. */
export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = init.body instanceof FormData;
  if (!isFormData && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}/v1${path}`, { ...init, headers });

  if (response.status === 401 && retry && !path.startsWith('/auth/refresh')) {
    const newToken = await refreshTokens();
    if (newToken) {
      return apiFetch<T>(path, init, false);
    }
  }

  const body = await parse<Record<string, unknown>>(response);

  if (!response.ok) {
    const error = (body ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(
      response.status,
      error.code ?? `HTTP_${response.status}`,
      error.message ?? 'Une erreur est survenue.',
      error.details,
    );
  }

  return body as T;
}

/** Téléchargement authentifié (reçus PDF) avec renouvellement du jeton. */
export async function apiDownload(path: string, retry = true): Promise<Blob> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}/v1${path}`, { headers });

  if (response.status === 401 && retry) {
    const newToken = await refreshTokens();
    if (newToken) return apiDownload(path, false);
  }

  if (!response.ok) {
    const text = await response.text();
    let body: { code?: string; message?: string; details?: unknown } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      body = {};
    }
    throw new ApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? 'Téléchargement impossible.',
      body.details,
    );
  }

  return response.blob();
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  platform_role: 'user' | 'super_admin';
  kyc: 'none' | 'submitted' | 'verified' | 'rejected';
  two_fa_enabled: boolean;
  status: string;
}

export interface PayoutAccount {
  id: string;
  type: 'mtn_momo' | 'orange_money' | 'bank';
  account_number: string;
  holder_name: string;
  is_default: boolean;
  active_from: string;
  active: boolean;
}
