import { config } from '../config';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * INTEGRATION POINT — the logged-in HR user's session token (e.g. a JWT from
 * your auth flow). This is NOT where LLM / AI provider keys go: those must
 * stay on the backend, which calls the AI provider on the frontend's behalf.
 * @returns {string | null}
 */
function getAuthToken() {
  return null;
}

/**
 * Thin fetch wrapper used by every service. Throws ApiError on non-2xx.
 * @param {string} path  e.g. '/cvs'
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 */
export async function request(path, { method = 'GET', body, signal } = {}) {
  const token = getAuthToken();
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let details = null;
    try {
      details = await res.json();
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(details?.message || `Request failed (${res.status})`, res.status, details);
  }

  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
};
