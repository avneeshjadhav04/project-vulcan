import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import {
  Sparkles,
  User,
  Lock,
  ArrowRight,
  AlertCircle,
  Loader2,
  ChevronLeft,
} from 'lucide-react'

export default function Login() {
  const [isSignup, setIsSignup] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fetchMe = useAuthStore((s) => s.fetchMe)

  const redirectTo = searchParams.get('redirect') || '/chat'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      if (isSignup) {
        await api.post('/auth/signup', { email, password })
        await api.post('/auth/login', { email, password })
      } else {
        await api.post('/auth/login', { email, password })
      }
      await fetchMe()
      navigate(redirectTo)
    } catch (err) {
      const data = (err as any).response?.data
      setError(data?.error || data?.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f0f0f] px-4">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-[#0f62fe]/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-[#78a9ff]/5 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-md"
      >
        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="mb-6 flex items-center gap-2 text-sm text-[#c6c6c6] transition-colors hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to home
        </button>

        <div className="relative overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-8 shadow-2xl shadow-black/50">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0f62fe]/5 via-transparent to-transparent" />

          <div className="relative">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0f62fe]">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">Carbon AI</h1>
                <p className="text-xs text-[#525252]">Personal AI Assistant</p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-4 overflow-hidden"
                >
                  <div className="flex items-center gap-2 rounded-lg border border-[#da1e28]/30 bg-[#da1e28]/10 px-4 py-3 text-sm text-[#da1e28]">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#525252]">
                  Email
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] py-3 pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-[#525252] focus:border-[#0f62fe] focus:ring-1 focus:ring-[#0f62fe]/50"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#525252]">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] py-3 pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-[#525252] focus:border-[#0f62fe] focus:ring-1 focus:ring-[#0f62fe]/50"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <AnimatePresence>
                {isSignup && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#525252]">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] py-3 pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-[#525252] focus:border-[#0f62fe] focus:ring-1 focus:ring-[#0f62fe]/50"
                        placeholder="••••••••"
                        required={isSignup}
                        minLength={6}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0f62fe] py-3 text-sm font-semibold text-white transition-all hover:bg-[#0353e9] hover:shadow-lg hover:shadow-[#0f62fe]/25 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {isSignup ? 'Create account' : 'Sign in'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-[#525252]">
              {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => {
                  setIsSignup(!isSignup)
                  setError('')
                  setConfirmPassword('')
                }}
                className="font-semibold text-[#0f62fe] transition-colors hover:text-[#78a9ff]"
              >
                {isSignup ? 'Sign in' : 'Create one'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
