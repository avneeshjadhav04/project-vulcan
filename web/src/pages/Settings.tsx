import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import {
  ArrowLeft,
  Key,
  Save,
  Check,
  Shield,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  User,
  Fingerprint,
  Lock,
  Sparkles,
  ExternalLink,
  Copy,
  CheckCircle2,
} from 'lucide-react'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [validationResult, setValidationResult] = useState<{valid: boolean; error?: string; status?: number} | null>(null)
  const [validating, setValidating] = useState(false)
  const navigate = useNavigate()

  // Auto-hide saved state
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setError('')
    setSaved(false)
    setLoading(true)
    try {
      await api.post('/me/key', { api_key: apiKey })
      setSaved(true)
      setApiKey('')
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to save API key')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleRemoveKey = async () => {
    if (!confirm('Remove your NVIDIA NIM API key? You will need to add it again to use AI features.')) return
    setError('')
    setLoading(true)
    try {
      await api.post('/me/key', { api_key: '' })
      await fetchMe()
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to remove API key')
    } finally {
      setLoading(false)
    }
  }

  const handleValidate = async () => {
    setValidating(true)
    setValidationResult(null)
    setError('')
    try {
      const res = await api.get('/me/key/validate')
      setValidationResult(res.data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to validate API key')
    } finally {
      setValidating(false)
    }
  }

  const maskKey = (hasKey: boolean | undefined) => {
    if (!hasKey) return 'Not configured'
    return 'nvapi-••••••••••••••••••••••••••••••••'
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f0f]">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-[#2a2a2a] bg-[#0f0f0f]/90 px-6 py-4 backdrop-blur-xl">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/chat')}
          className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm text-[#c6c6c6] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </motion.button>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">Settings</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-6 space-y-6">
        {/* Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] shadow-lg"
        >
          <div className="relative">
            <div className="h-24 bg-gradient-to-r from-[#0f62fe]/30 to-[#8a3ffc]/20" />
            <div className="absolute -bottom-8 left-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-xl shadow-[#0f62fe]/20 text-xl font-bold text-white">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
            </div>
          </div>

          <div className="pt-10 pb-6 px-6">
            <h2 className="text-base font-bold text-white">{user?.email || 'User'}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#0f62fe]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#0f62fe]">
                <Shield className="h-3 w-3" />
                {user?.role || 'user'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#24a148]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#24a148]">
                <CheckCircle2 className="h-3 w-3" />
                Active
              </span>
            </div>
          </div>
        </motion.div>

        {/* Account Details */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-lg"
        >
          <h2 className="mb-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#525252]">
            <User className="h-4 w-4" />
            Account Information
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-[#0f0f0f] border border-[#2a2a2a] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f62fe]/10">
                  <Fingerprint className="h-4 w-4 text-[#0f62fe]" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Email</p>
                  <p className="text-sm text-white">{user?.email}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#0f0f0f] border border-[#2a2a2a] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#8a3ffc]/10">
                  <Lock className="h-4 w-4 text-[#8a3ffc]" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Role</p>
                  <p className="text-sm font-mono text-white">{user?.role || 'user'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#0f0f0f] border border-[#2a2a2a] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${user?.has_nim_key ? 'bg-[#24a148]/10' : 'bg-[#525252]/10'}`}>
                  <Key className={`h-4 w-4 ${user?.has_nim_key ? 'text-[#24a148]' : 'text-[#525252]'}`} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">NIM API Key</p>
                  <p className="text-sm font-mono text-[#c6c6c6]">{maskKey(user?.has_nim_key)}</p>
                </div>
              </div>
              {user?.has_nim_key && (
                <button
                  onClick={handleRemoveKey}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-[#da1e28] transition-all hover:bg-[#da1e28]/10"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* API Key Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-lg"
        >
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#525252]">
                <Key className="h-4 w-4" />
                AI Provider Key
              </h2>
              <p className="mt-1 text-xs text-[#525252]">
                Your NVIDIA NIM API key is encrypted at rest and only decrypted in-memory during requests.
              </p>
            </div>
            <a
              href="https://build.nvidia.com/explore/discover"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] text-[#0f62fe] transition-all hover:bg-[#0f62fe]/10"
            >
              <ExternalLink className="h-3 w-3" />
              Get Key
            </a>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 8, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="flex items-center gap-2 rounded-xl border border-[#da1e28]/30 bg-[#da1e28]/10 px-4 py-3 text-xs text-[#da1e28]">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {saved && (
              <motion.div
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 8, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="flex items-center gap-2 rounded-xl border border-[#24a148]/30 bg-[#24a148]/10 px-4 py-3 text-xs text-[#24a148]">
                  <Check className="h-4 w-4 shrink-0" />
                  API key saved successfully.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] px-4 py-3 focus-within:border-[#0f62fe]/50 focus-within:ring-1 focus-within:ring-[#0f62fe]/20 transition-all">
              <Key className="h-4 w-4 text-[#525252] shrink-0" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#525252] font-mono"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="rounded-lg p-1.5 text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              {apiKey && (
                <button
                  onClick={handleCopyKey}
                  className="rounded-lg p-1.5 text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-4 w-4 text-[#24a148]" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-[11px] text-[#525252]">
              Your key never leaves this device unencrypted.
            </p>
            <div className="flex items-center gap-2">
              {user?.has_nim_key && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleValidate}
                  disabled={validating}
                  className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] px-4 py-2.5 text-sm font-medium text-[#c6c6c6] transition-all hover:bg-[#2a2a2a] hover:text-white disabled:opacity-40"
                >
                  {validating ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Test Key
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSave}
                disabled={loading || !apiKey.trim()}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#0f62fe]/20 transition-all hover:shadow-xl hover:shadow-[#0f62fe]/30 disabled:opacity-40 disabled:shadow-none"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Key
              </motion.button>
            </div>
          </div>

          <AnimatePresence>
            {validationResult && (
              <motion.div
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 8, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                {validationResult.valid ? (
                  <div className="flex items-center gap-2 rounded-xl border border-[#24a148]/30 bg-[#24a148]/10 px-4 py-3 text-xs text-[#24a148]">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    API key is valid and working!
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-[#da1e28]/30 bg-[#da1e28]/10 px-4 py-3 text-xs text-[#da1e28]">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {validationResult.error || `API key validation failed (status ${validationResult.status})`}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Security Info */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-lg"
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#525252]">
            <Shield className="h-4 w-4" />
            Security
          </h2>
          <div className="space-y-3">
            {[
              {
                label: 'Encryption at Rest',
                desc: 'API keys are encrypted with AES-256-GCM before storage.',
                status: 'Active',
                color: 'text-[#24a148]',
              },
              {
                label: 'Session Authentication',
                desc: 'JWT tokens stored in HttpOnly cookies with SameSite=Strict.',
                status: 'Active',
                color: 'text-[#24a148]',
              },
              {
                label: 'CSRF Protection',
                desc: 'All state-changing requests require a valid CSRF token.',
                status: 'Active',
                color: 'text-[#24a148]',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl bg-[#0f0f0f] border border-[#2a2a2a] px-4 py-3"
              >
                <div className="mt-0.5 h-2 w-2 rounded-full bg-[#24a148] shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <span className={`text-[10px] font-semibold uppercase ${item.color}`}>{item.status}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#525252]">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
