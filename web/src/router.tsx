import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Login from './pages/Login'
import Chat from './pages/Chat'
import Settings from './pages/Settings'
import Admin from './pages/Admin'

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin border-2 border-accent border-t-transparent" />
      </div>
    )
  }
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}

function AdminRoute() {
  const { isAdmin, isLoading } = useAuthStore()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin border-2 border-accent border-t-transparent" />
      </div>
    )
  }
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <Chat />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
    ],
  },
  {
    element: <AdminRoute />,
    children: [
      {
        path: '/admin',
        element: <Admin />,
      },
    ],
  },
])
