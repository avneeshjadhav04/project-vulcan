import { create } from 'zustand'

type Theme = 'dark' | 'light' | 'system'

interface ThemeState {
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
  initTheme: () => void
}

function getSystemTheme(): 'dark' | 'light' {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
  }
  return resolved
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: (theme) => {
    const resolved = applyTheme(theme)
    set({ theme, resolvedTheme: resolved })
    try {
      localStorage.setItem('vulcan-theme', theme)
    } catch {}
  },
  initTheme: () => {
    let stored: Theme = 'dark'
    try {
      stored = (localStorage.getItem('vulcan-theme') as Theme) || 'dark'
    } catch {}
    const resolved = applyTheme(stored)
    set({ theme: stored, resolvedTheme: resolved })

    // Listen for system theme changes when in system mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const current = useThemeStore.getState().theme
      if (current === 'system') {
        const r = applyTheme('system')
        set({ resolvedTheme: r })
      }
    }
    mediaQuery.addEventListener('change', handler)
  },
}))
