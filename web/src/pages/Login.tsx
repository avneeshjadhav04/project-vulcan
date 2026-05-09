import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import {
  Sparkles,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
  ChevronLeft,
  Shield,
  MessageSquare,
  Terminal,
  CheckCircle2,
  Cpu,
} from 'lucide-react'

/* ─── Animated Background Particles ─── */
function ParticleField() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * 5,
  }))

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-[#0f62fe]/20"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
          }}
          animate={{
            y: [0, -30, 0],
            x: [0, 15, 0],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

/* ─── Feature Card ─── */
function FeatureItem({ icon: Icon, text, delay }: { icon: any; text: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="flex items-center gap-3 text-sm text-[#c6c6c6]"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0f62fe]/10">
        <Icon className="h-4 w-4 text-[#0f62fe]" />
      </div>
      {text}
    </motion.div>
  )
}

/* ─── Password Strength Meter ─── */
function PasswordStrength({ password }: { password: string }) {
  const getStrength = (pwd: string): number => {
    let score = 0
    if (pwd.length >= 6) score++
    if (pwd.length >= 10) score++
    if (/[A-Z]/.test(pwd)) score++
    if (/[0-9]/.test(pwd)) score++
    if (/[^A-Za-z0-9]/.test(pwd)) score++
    return score
  }

  const strength = getStrength(password)
  const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong']
  const colors = ['#da1e28', '#f1c21b', '#78a9ff', '#24a148', '#24a148']

  if (!password) return null

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor: i <= strength ? colors[strength - 1] : '#2a2a2a',
            }}
          />
        ))}
      </div>
      <p className="text-[10px] text-[#525252]">
        Strength: <span style={{ color: colors[strength - 1] }}>{labels[strength - 1]}</span>
      </p>
    </div>
  )
}

/* ─── Input Field ─── */
function FormInput({
  icon: Icon,
  type,
  value,
  onChange,
  placeholder,
  label,
  required,
  minLength,
  showToggle,
}: {
  icon: any
  type: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
  required?: boolean
  minLength?: number
  showToggle?: boolean
}) {
  const [show, setShow] = useState(false)
  const [focused, setFocused] = useState(false)

  const inputType = showToggle ? (show ? 'text' : 'password') : type

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-[#525252]">
        {label}
      </label>
      <motion.div
        animate={{
          borderColor: focused ? 'rgba(15, 98, 254, 0.5)' : 'rgba(42, 42, 42, 1)',
          boxShadow: focused ? '0 0 0 3px rgba(15, 98, 254, 0.1)' : '0 0 0 0px rgba(15, 98, 254, 0)',
        }}
        className="relative flex items-center overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] transition-colors"
      >
        <Icon className="absolute left-3.5 h-4 w-4 text-[#525252]" />
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full bg-transparent py-3 pl-10 pr-10 text-sm text-white outline-none placeholder:text-[#525252]"
          placeholder={placeholder}
          required={required}
          minLength={minLength}
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 rounded p-1 text-[#525252] transition-colors hover:text-white"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </motion.div>
    </div>
  )
}

export default function Login() {
  const [searchParams] = useSearchParams()
  const [isSignup, setIsSignup] = useState(searchParams.get('signup') === '1')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const fetchMe = useAuthStore((s) => s.fetchMe)

  const redirectTo = searchParams.get('redirect') || '/chat'

  useEffect(() => {
    setError('')
  }, [isSignup])

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

  const features = [
    { icon: MessageSquare, text: 'Real-time AI chat with NVIDIA NIM models' },
    { icon: Terminal, text: 'Sandboxed terminal execution' },
    { icon: Shield, text: 'AES-256 encrypted API keys' },
    { icon: Cpu, text: 'Multiple model selection' },
  ]

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#0a0a0a]">
      <ParticleField />

      {/* Left Panel - Branding */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0f0f0f] via-[#0f0f0f] to-[#0f62fe]/5 p-12 lg:flex lg:w-1/2 xl:w-5/12"
      >
        <div className="pointer-events-none absolute -top-20 -left-20 h-96 w-96 rounded-full bg-[#0f62fe]/10 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-[#78a9ff]/5 blur-[100px]" />

        <div className="relative z-10">
          <button
            onClick={() => navigate('/')}
            className="group flex items-center gap-3 text-white transition-opacity hover:opacity-80"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight">Project Vulcan</span>
              <p className="text-[10px] text-[#525252]">Personal AI Assistant</p>
            </div>
          </button>
        </div>

        <div className="relative z-10 space-y-6">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-3xl font-bold leading-tight text-white"
          >
            Your Personal
            <br />
            <span className="bg-gradient-to-r from-[#0f62fe] via-[#78a9ff] to-[#33b1ff] bg-clip-text text-transparent">
              AI Assistant
            </span>
          </motion.h2>
          <p className="max-w-sm text-sm leading-relaxed text-[#c6c6c6]">
            A sleek, secure, and sandboxed AI platform. Chat with the latest models,
            execute terminal commands safely, and bring your own NVIDIA NIM key.
          </p>

          <div className="space-y-4 pt-4">
            {features.map((f, i) => (
              <FeatureItem key={f.text} icon={f.icon} text={f.text} delay={0.3 + i * 0.1} />
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xs text-[#525252]">
            Secure. Fast. Private.
          </p>
        </div>
      </motion.div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative w-full max-w-sm"
        >
          <div className="mb-6 lg:hidden">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-sm text-[#c6c6c6] transition-colors hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to home
            </button>
          </div>

          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Project Vulcan</h1>
              <p className="text-xs text-[#525252]">Personal AI Assistant</p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-2xl shadow-black/50 sm:p-8">
            <div className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full bg-[#0f62fe]/5 blur-[60px]" />

            <div className="relative">
              <div className="mb-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isSignup ? 'signup' : 'login'}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h2 className="text-xl font-bold text-white">
                      {isSignup ? 'Create account' : 'Welcome back'}
                    </h2>
                    <p className="mt-1 text-sm text-[#525252]">
                      {isSignup
                        ? 'Get started with your AI assistant'
                        : 'Sign in to continue to Project Vulcan'}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>

              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden"
                  >
                    <div className="flex items-center gap-2 rounded-xl border border-[#da1e28]/30 bg-[#da1e28]/10 px-4 py-3 text-sm text-[#da1e28]">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-4">
                <FormInput
                  icon={Mail}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  label="Email"
                  required
                />

                <div>
                  <FormInput
                    icon={Lock}
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••••"
                    label="Password"
                    required
                    minLength={6}
                    showToggle
                  />
                  {isSignup && <PasswordStrength password={password} />}
                </div>

                <AnimatePresence>
                  {isSignup && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <FormInput
                        icon={Lock}
                        type="password"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        placeholder="••••••••"
                        label="Confirm Password"
                        required={isSignup}
                        minLength={6}
                        showToggle
                      />
                      {confirmPassword && password === confirmPassword && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-1.5 flex items-center gap-1 text-[10px] text-[#24a148]"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Passwords match
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0f62fe] to-[#0353e9] py-3 text-sm font-semibold text-white shadow-lg shadow-[#0f62fe]/20 transition-all hover:shadow-xl hover:shadow-[#0f62fe]/30 disabled:opacity-50 disabled:shadow-none"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {isSignup ? 'Create account' : 'Sign in'}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </motion.button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-sm text-[#525252]">
                  {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignup(!isSignup)
                      setError('')
                      setConfirmPassword('')
                    }}
                    className="font-semibold text-[#0f62fe] transition-colors hover:text-[#78a9ff]"
                  >
                    {isSignup ? 'Sign in' : 'Create one'}
                  </button>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
