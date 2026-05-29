import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { fetchCsrfToken } from './lib/api'
import { router } from './router'

import { ErrorToastProvider } from './components/ui/ErrorToast'

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  useEffect(() => {
    fetchCsrfToken()
    fetchMe()
  }, [fetchMe])
  return (
    <ErrorToastProvider>
      <RouterProvider router={router} />
    </ErrorToastProvider>
  )
}
