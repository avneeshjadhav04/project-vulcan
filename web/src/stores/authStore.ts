import { create } from 'zustand'

interface User {
  id: string
  email: string
  role: string
  is_active: boolean
  has_provider: boolean
  provider_count: number
  memory_enabled: boolean
  summarization_enabled: boolean
  cross_chat_memory_enabled: boolean
  tools_enabled: boolean
  max_agent_steps: number
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  fetchMe: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    }),
  fetchMe: async () => {
    try {
      const { api } = await import('../lib/api')
      const res = await api.get('/me')
      // Treat disabled accounts as logged-out. Individual pages or the login
      // screen can show a disabled-account message via the ?disabled=1 query
      // parameter when they see is_active === false in the user data.
      if (res.data?.is_active === false) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }
      set({
        user: res.data,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err: any) {
      // Any error here just means we are not authenticated. Let the router or
      // the current page decide whether to redirect, not the session probe.
      if (err?.response?.data?.error === 'Account disabled') {
        // The server rejected the session because the account was disabled.
        // The API interceptor redirects to the disabled-account login message;
        // clear local state here to avoid flashing authenticated UI.
        document.cookie = 'token=; Max-Age=0; Path=/; SameSite=Lax'
        document.cookie = 'csrf_token=; Max-Age=0; Path=/; SameSite=Lax'
      }
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
  logout: async () => {
    try {
      const { api } = await import('../lib/api')
      await api.post('/auth/logout')
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false })
      window.location.href = '/'
    }
  },
}))
