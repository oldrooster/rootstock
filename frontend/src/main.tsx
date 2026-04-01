import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getToken, clearAuth } from './lib/api'

// Intercept all fetch calls to attach the auth token and handle 401 responses.
// This runs before any component renders, so every API call is covered without
// needing to modify individual pages.
const _originalFetch = window.fetch.bind(window)
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getToken()
  if (token) {
    const headers = new Headers((init as RequestInit | undefined)?.headers)
    headers.set('Authorization', `Bearer ${token}`)
    init = { ...(init ?? {}), headers }
  }
  const response = await _originalFetch(input, init)
  if (response.status === 401 && !window.location.pathname.startsWith('/login')) {
    clearAuth()
    window.location.href = '/login'
  }
  return response
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
