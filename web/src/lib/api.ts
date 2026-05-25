import axios from 'axios'

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : null
}

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 120000,
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
