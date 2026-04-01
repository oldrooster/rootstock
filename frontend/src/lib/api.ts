const TOKEN_KEY = 'rootstock_token'
const USERNAME_KEY = 'rootstock_username'

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
