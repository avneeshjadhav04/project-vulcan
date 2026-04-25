import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { Terminal, User, Lock, ArrowRight } from 'lucide-react'

export default function Login() {
  const [isSignup, setIsSignup] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isSignup) {
        await api.post('/auth/signup', { email, password })
        const loginRes = await api.post('/auth/login', { email, password })
        setUser({
          id: '',
          email,
          role: loginRes.data.role,
          has_nim_key: false,
        })
      } else {
        const res = await api.post('/auth/login', { email, password })
        setUser({
          id: '',
          email,
          role: res.data.role,
          has_nim_key: false,
        })
      }
      navigate('/')
    } catch (err) {
      setError((err as any).response?.data?.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md border border-border bg-surface p-8 shadow-2xl">
        <div className="mb-8 flex items-center gap-3">
          <Terminal className="h-8 w-8 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Carbon AI</h1>
        </div>

        <h2 className="mb-6 text-lg font-medium text-text-primary">
          {isSignup ? 'Create account' : 'Sign in'}
        </h2>

        {error && (
          <div className="mb-4 border-l-2 border-error bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-secondary">
              Email
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-secondary">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 border border-transparent bg-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin border-2 border-white border-t-transparent" />
            ) : (
              <>
                {isSignup ? 'Create account' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-text-secondary">
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsSignup(!isSignup)}
            className="font-medium text-accent hover:text-accent-hover"
          >
            {isSignup ? 'Sign in' : 'Create one'}
          </button>
        </div>
      </div>
    </div>
  )
}
