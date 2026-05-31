import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useThemeStore } from './stores/themeStore'
import { fetchCsrfToken } from './lib/api'
import { router } from './router'

import { ErrorToastProvider } from './components/ui/ErrorToast'

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const initTheme = useThemeStore((s) => s.initTheme)

  useEffect(() => {
    fetchCsrfToken()
    fetchMe()
    initTheme()
  }, [fetchMe, initTheme])

  return (
    <ErrorToastProvider>
      <RouterProvider router={router} />
    </ErrorToastProvider>
  )
}
