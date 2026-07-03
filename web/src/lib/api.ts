import axios from 'axios'

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : null
}

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 600000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/// Create a short-timeout axios instance for MCP connection health checks.
/// These requests should fail fast rather than hang the UI for minutes when a
/// spawned stdio child is slow or unresponsive.
export const apiShort = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const csrf = getCsrfToken()
  if (csrf && config.method && config.method !== 'get' && config.method !== 'head') {
    config.headers['X-CSRF-Token'] = csrf
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data
    if (
      error?.response?.status === 403 &&
      typeof data === 'object' &&
      data?.error === 'Account disabled'
    ) {
      // The server rejected the request because the account was disabled and
      // already sent Set-Cookie headers to clear the auth cookies. Clear them
      // client-side too as a safety net, then show the disabled message.
      document.cookie = 'token=; Max-Age=0; Path=/; SameSite=Lax'
      document.cookie = 'csrf_token=; Max-Age=0; Path=/; SameSite=Lax'
      window.location.href = '/login?disabled=1'
    }
    return Promise.reject(error)
  }
)

// NOTE: We do NOT globally redirect on 401 here.
// 401 handling is done in route guards and explicit auth checks.
// This prevents unauthenticated users from being redirected away from the landing page.

export async function fetchCsrfToken() {
  try {
    await api.get('/auth/csrf')
  } catch {
    // Silently ignore — CSRF is optional for read-only endpoints
  }
}
