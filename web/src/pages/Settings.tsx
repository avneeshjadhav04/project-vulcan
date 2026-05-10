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
  Brain,
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

  const handleToggleMemory = async () => {
    try {
      await api.post('/me/memory')
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle memory')
    }
  }

  const maskKey = (hasKey: boolean | undefined) => {
    if (!hasKey) return 'Not configured'
    return 'nvapi-••••••••••••••••••••••••••••••••'
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border-subtle bg-background px-5 py-3">
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <img src="/VulcanLogo.png" alt="" className="h-14 w-14" />
          <h1 className="text-sm font-semibold text-text-primary">Settings</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-5 space-y-4">
        {/* Profile Card */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center bg-interactive text-sm font-semibold text-white">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">{user?.email || 'User'}</h2>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 bg-interactive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-interactive">
                  <Shield className="h-3 w-3" />
                  {user?.role || 'user'}
                </span>
                <span className="inline-flex items-center gap-1 bg-support-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-support-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Account Details */}
        <div className="border border-border-subtle bg-layer p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
            <User className="h-4 w-4" />
            Account Information
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Fingerprint className="h-4 w-4 text-interactive" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">Email</p>
                  <p className="text-sm text-text-primary">{user?.email}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Lock className="h-4 w-4 text-link-primary" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">Role</p>
                  <p className="text-sm font-mono text-text-primary">{user?.role || 'user'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Key className={`h-4 w-4 ${user?.has_nim_key ? 'text-support-success' : 'text-text-helper'}`} />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">NIM API Key</p>
                  <p className="text-sm font-mono text-text-secondary">{maskKey(user?.has_nim_key)}</p>
                </div>
              </div>
              {user?.has_nim_key && (
                <button
                  onClick={handleRemoveKey}
                  className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-support-error transition-colors hover:bg-support-error/10"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* API Key Configuration */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Key className="h-4 w-4" />
                AI Provider Key
              </h2>
              <p className="mt-1 text-xs text-text-helper">
                Your NVIDIA NIM API key is encrypted at rest and only decrypted in-memory during requests.
              </p>
            </div>
            <a
              href="https://build.nvidia.com/explore/discover"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-interactive transition-colors hover:text-link-hover"
            >
              <ExternalLink className="h-3 w-3" />
              Get Key
            </a>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3 overflow-hidden"
              >
                <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {saved && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3 overflow-hidden"
              >
                <div className="flex items-center gap-2 border border-support-success/30 bg-support-success/10 px-3 py-2 text-xs text-support-success">
                  <Check className="h-4 w-4 shrink-0" />
                  API key saved successfully.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <div className="flex items-center gap-2 border border-border-subtle bg-background px-3 py-2.5 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
              <Key className="h-4 w-4 text-text-helper shrink-0" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder font-mono"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1 text-text-helper transition-colors hover:text-text-primary"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              {apiKey && (
                <button
                  onClick={handleCopyKey}
                  className="p-1 text-text-helper transition-colors hover:text-text-primary"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-4 w-4 text-support-success" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-text-helper">
              Your key never leaves this device unencrypted.
            </p>
            <div className="flex items-center gap-2">
              {user?.has_nim_key && (
                <button
                  onClick={handleValidate}
                  disabled={validating}
                  className="flex items-center gap-2 border border-border-subtle bg-background px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary disabled:opacity-40"
                >
                  {validating ? (
                    <div className="h-3.5 w-3.5 animate-spin border-2 border-border-subtle border-t-text-primary" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Test Key
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={loading || !apiKey.trim()}
                className="flex items-center gap-2 bg-interactive px-4 py-2 text-xs text-white transition-colors hover:bg-interactive-hover disabled:opacity-40"
              >
                {loading ? (
                  <div className="h-3.5 w-3.5 animate-spin border-2 border-white/30 border-t-white" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save Key
              </button>
            </div>
          </div>

          <AnimatePresence>
            {validationResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 overflow-hidden"
              >
                {validationResult.valid ? (
                  <div className="flex items-center gap-2 border border-support-success/30 bg-support-success/10 px-3 py-2 text-xs text-support-success">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    API key is valid and working!
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {validationResult.error || `API key validation failed (status ${validationResult.status})`}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Memory Toggle */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Brain className="h-4 w-4" />
                Long-Term Memory
              </h2>
              <p className="mt-1 text-xs text-text-helper">
                Automatically summarize older conversations so the AI remembers context across long chats.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Brain className={`h-4 w-4 ${user?.memory_enabled ? 'text-interactive' : 'text-text-helper'}`} />
              <div>
                <p className="text-sm font-medium text-text-primary">Conversation Summarization</p>
                <p className="text-[11px] text-text-helper">
                  {user?.memory_enabled
                    ? 'Enabled — AI will summarize older messages to maintain context'
                    : 'Disabled — AI sees all messages (may hit token limits)'}
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleMemory}
              className={`relative h-5 w-9 transition-colors ${
                user?.memory_enabled ? 'bg-interactive' : 'bg-border-subtle'
              }`}
            >
              <motion.div
                animate={{ x: user?.memory_enabled ? 16 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="absolute top-1 h-3 w-3 bg-white"
              />
            </button>
          </div>

          <div className="mt-2 space-y-1.5">
            <div className="flex items-start gap-2 text-[11px] text-text-helper">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
              <span>Triggers when a chat exceeds 26 messages</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-text-helper">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
              <span>Keeps the last 6 messages verbatim for recent context</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-text-helper">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
              <span>Summaries are stored per-chat and updated automatically</span>
            </div>
          </div>
        </div>

        {/* Security Info */}
        <div className="border border-border-subtle bg-layer p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
            <Shield className="h-4 w-4" />
            Security
          </h2>
          <div className="space-y-2">
            {[
              {
                label: 'Encryption at Rest',
                desc: 'API keys are encrypted with AES-256-GCM before storage.',
                status: 'Active',
                color: 'text-support-success',
              },
              {
                label: 'Session Authentication',
                desc: 'JWT tokens stored in HttpOnly cookies with SameSite=Strict.',
                status: 'Active',
                color: 'text-support-success',
              },
              {
                label: 'CSRF Protection',
                desc: 'All state-changing requests require a valid CSRF token.',
                status: 'Active',
                color: 'text-support-success',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 border border-border-subtle bg-background px-3 py-2.5"
              >
                <div className="mt-0.5 h-1.5 w-1.5 bg-support-success shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text-primary">{item.label}</p>
                    <span className={`text-[10px] font-semibold uppercase ${item.color}`}>{item.status}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-helper">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
