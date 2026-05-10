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

/* Feature Item */
function FeatureItem({ icon: Icon, text, delay }: { icon: any; text: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-3 text-sm text-text-secondary"
    >
      <Icon className="h-4 w-4 shrink-0 text-interactive" />
      {text}
    </motion.div>
  )
}

/* Password Strength */
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
  const colors = ['#fa4d56', '#f1c21b', '#78a9ff', '#42be65', '#42be65']

  if (!password) return null

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-0.5 flex-1 transition-all duration-200"
            style={{
              backgroundColor: i <= strength ? colors[strength - 1] : '#393939',
            }}
          />
        ))}
      </div>
      <p className="text-[10px] text-text-helper">
        Strength: <span style={{ color: colors[strength - 1] }}>{labels[strength - 1]}</span>
      </p>
    </div>
  )
}

/* Input Field */
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

  const inputType = showToggle ? (show ? 'text' : 'password') : type

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-normal text-text-helper">{label}</label>
      <div className="relative flex items-center border border-border-subtle bg-layer transition-colors focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
        <Icon className="absolute left-3 h-4 w-4 text-text-disabled" />
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-3 pl-10 pr-10 text-sm text-text-primary outline-none placeholder:text-text-placeholder"
          placeholder={placeholder}
          required={required}
          minLength={minLength}
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 p-1 text-text-disabled transition-colors hover:text-text-primary"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
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
    <div className="flex min-h-screen bg-background">
      {/* Left Panel - Branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border-subtle bg-layer p-10 lg:flex lg:w-5/12">
        <div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-text-primary transition-opacity hover:opacity-80"
          >
            <Sparkles className="h-5 w-5 text-interactive" />
            <div>
              <span className="text-sm font-semibold tracking-tight">Project Vulcan</span>
              <p className="text-[10px] text-text-helper">Personal AI Assistant</p>
            </div>
          </button>
        </div>

        <div className="space-y-5">
          <h2 className="text-2xl font-light leading-tight text-text-primary">
            Your Personal
            <br />
            <span className="font-semibold text-interactive">AI Assistant</span>
          </h2>
          <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
            A secure, self-hosted AI platform. Chat with the latest models,
            execute terminal commands safely, and bring your own NVIDIA NIM key.
          </p>

          <div className="space-y-3 pt-2">
            {features.map((f, i) => (
              <FeatureItem key={f.text} icon={f.icon} text={f.text} delay={0.2 + i * 0.05} />
            ))}
          </div>
        </div>

        <p className="text-xs text-text-helper">Secure. Fast. Private.</p>
      </div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative w-full max-w-sm"
        >
          <div className="mb-5 lg:hidden">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to home
            </button>
          </div>

          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <Sparkles className="h-6 w-6 text-interactive" />
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Project Vulcan</h1>
              <p className="text-xs text-text-helper">Personal AI Assistant</p>
            </div>
          </div>

          <div className="border border-border-subtle bg-layer p-6 sm:p-8">
            <div className="mb-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={isSignup ? 'signup' : 'login'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <h2 className="text-lg font-semibold text-text-primary">
                    {isSignup ? 'Create account' : 'Welcome back'}
                  </h2>
                  <p className="mt-1 text-xs text-text-helper">
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
                  <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-4 py-3 text-xs text-support-error">
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
                    transition={{ duration: 0.2 }}
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
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-support-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Passwords match
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 bg-interactive py-3 text-sm font-normal text-white transition-colors hover:bg-interactive-hover disabled:opacity-50"
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

            <div className="mt-5 text-center">
              <p className="text-xs text-text-helper">
                {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignup(!isSignup)
                    setError('')
                    setConfirmPassword('')
                  }}
                  className="font-normal text-interactive transition-colors hover:text-link-hover"
                >
                  {isSignup ? 'Sign in' : 'Create one'}
                </button>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
