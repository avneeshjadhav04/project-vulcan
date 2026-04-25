import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { fetchCsrfToken } from './lib/api'
import { router } from './router'

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  useEffect(() => {
    fetchCsrfToken()
    fetchMe()
  }, [fetchMe])
  return <RouterProvider router={router} />
}
