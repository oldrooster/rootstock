const TOKEN_KEY = 'rootstock_token'
const USERNAME_KEY = 'rootstock_username'

// ---------------------------------------------------------------------------
// Typed fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Wrapper around fetch() that:
 *  - Injects the Bearer auth token automatically
 *  - Throws a descriptive Error on non-2xx responses (body detail included)
 *  - Returns the parsed JSON (or undefined for 204/empty responses)
 *
 * Usage:
 *   const data = await apiFetch<MyType>('/api/containers/')
 *   await apiFetch('/api/containers/foo', { method: 'DELETE' })
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (init.body && typeof init.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(path, { ...init, headers })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body?.detail ?? body?.message ?? JSON.stringify(body)
    } catch {
      // ignore parse error
    }
    throw new Error(detail)
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY)
}

export function setAuth(token: string, username: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USERNAME_KEY, username)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

/**
 * Build a WebSocket URL for the given path, appending the auth token as a
 * query parameter so the server middleware can validate it.
 *
 * Handles existing query strings correctly, e.g.:
 *   getWsUrl('/api/backups/run?volumes=foo') → 'ws://host/api/backups/run?volumes=foo&token=...'
 *   getWsUrl('/api/terminal/node')           → 'ws://host/api/terminal/node?token=...'
 */
export function getWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getToken()
  if (!token) {
    return `${protocol}//${window.location.host}${path}`
  }
  // Strip trailing bare '?' to avoid '?&token=...'
  const cleanPath = path.endsWith('?') ? path.slice(0, -1) : path
  const sep = cleanPath.includes('?') ? '&' : '?'
  return `${protocol}//${window.location.host}${cleanPath}${sep}token=${encodeURIComponent(token)}`
}
