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
      if (res.data?.is_active === false) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        window.location.href = '/login?disabled=1'
        return
      }
      set({
        user: res.data,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err: any) {
      if (err?.response?.status === 403) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        window.location.href = '/login?disabled=1'
        return
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
