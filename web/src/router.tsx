import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Chat from './pages/Chat'
import Settings from './pages/Settings'

import CommandPalette from './components/CommandPalette'
import GlobalSearch from './components/GlobalSearch'

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-interactive border-t-transparent" />
      </div>
    )
  }
  return isAuthenticated ? (
    <>
      <Outlet />
      <CommandPalette />
      <GlobalSearch />
    </>
  ) : (
    <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Landing />,
  },
  {
    path: '/login',
    element: <Login />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/chat',
        element: <Chat />,
      },
      {
        path: '/chat/:chatId',
        element: <Chat />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])
