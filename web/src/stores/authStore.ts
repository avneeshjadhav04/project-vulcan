import { create } from 'zustand'

interface User {
  id: string
  email: string
  role: string
  has_nim_key: boolean
  memory_enabled: boolean
  tools_enabled: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isAdmin: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  fetchMe: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isLoading: true,
  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin',
      isLoading: false,
    }),
  fetchMe: async () => {
    try {
      const { api } = await import('../lib/api')
      const res = await api.get('/me')
      set({
        user: res.data,
        isAuthenticated: true,
        isAdmin: res.data.role === 'admin',
        isLoading: false,
      })
    } catch {
      set({ user: null, isAuthenticated: false, isAdmin: false, isLoading: false })
    }
  },
  logout: async () => {
    try {
      const { api } = await import('../lib/api')
      await api.post('/auth/logout')
    } finally {
      set({ user: null, isAuthenticated: false, isAdmin: false, isLoading: false })
      window.location.href = '/'
    }
  },
}))
