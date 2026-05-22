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
  CheckCircle2,
  Brain,
  Plus,
  X,
  Server,
  TestTube,
  Loader2,
  Link,
  Unlink,
  Wrench,
  Mail,
  ListTodo,
} from 'lucide-react'

interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  is_active: boolean
}

const BUILT_IN_PROVIDERS = [
  { id: 'nvidia', name: 'NVIDIA NIM', base_url: 'https://integrate.api.nvidia.com/v1' },
  { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1' },
  { id: 'groq', name: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
  { id: 'anthropic', name: 'Anthropic', base_url: 'https://api.anthropic.com/v1' },
  { id: 'ollama', name: 'Ollama', base_url: 'http://localhost:11434/v1' },
  { id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'together', name: 'Together AI', base_url: 'https://api.together.xyz/v1' },
  { id: 'custom', name: 'Custom Provider', base_url: '' },
]

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // Add provider form state
  const [selectedType, setSelectedType] = useState('nvidia')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [validationResult, setValidationResult] = useState<{valid: boolean; error?: string; provider_id?: string} | null>(null)
  const [validating, setValidating] = useState(false)
  const [integrations, setIntegrations] = useState<Array<{ provider: string; connected: boolean; scopes?: string; expires_at?: string }>>([])
  const [integrationsLoading, setIntegrationsLoading] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  useEffect(() => {
    loadProviders()
    loadIntegrations()
    const params = new URLSearchParams(window.location.search)
    const justConnected = params.get('status')
    if (justConnected === 'connected') {
      setSaved(true)
      window.history.replaceState({}, '', '/settings')
    }
  }, [])

  const loadProviders = async () => {
    setProvidersLoading(true)
    try {
      const res = await api.get('/providers')
      setProviders(res.data || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load providers')
    } finally {
      setProvidersLoading(false)
    }
  }

  const loadIntegrations = async () => {
    setIntegrationsLoading(true)
    try {
      const res = await api.get('/integrations')
      setIntegrations(res.data || [])
    } catch {
      // integrations not yet deployed
    } finally {
      setIntegrationsLoading(false)
    }
  }

  const handleConnect = async (provider: string) => {
    setError('')
    setConnectingProvider(provider)
    try {
      const res = await api.get(`/integrations/${provider}/auth-url`)
      window.location.href = res.data.url
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to connect ${provider}`)
      setConnectingProvider(null)
    }
  }

  const handleDisconnectIntegration = async (provider: string) => {
    if (!confirm(`Disconnect ${provider}? The AI will no longer be able to access your ${provider} data.`)) return
    setError('')
    try {
      await api.delete(`/integrations/${provider}`)
      await loadIntegrations()
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to disconnect')
    }
  }

  const handleAddProvider = async () => {
    setError('')
    setLoading(true)
    try {
      const def = BUILT_IN_PROVIDERS.find((p) => p.id === selectedType)
      const name = selectedType === 'custom' ? customName.trim() : (def?.name || selectedType)
      const baseUrl = selectedType === 'custom' ? customBaseUrl.trim() : (def?.base_url || '')

      if (!name || !baseUrl || !apiKey.trim()) {
        setError('Name, base URL, and API key are required')
        setLoading(false)
        return
      }

      await api.post('/providers', {
        name,
        provider_type: selectedType,
        base_url: baseUrl,
        api_key: apiKey.trim(),
      })
      setSaved(true)
      setShowAddModal(false)
      setApiKey('')
      setCustomName('')
      setCustomBaseUrl('')
      setSelectedType('nvidia')
      await loadProviders()
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to add provider')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveProvider = async (id: string) => {
    if (!confirm('Remove this provider? Chats using it will no longer work until you add it again.')) return
    setError('')
    try {
      await api.delete(`/providers/${id}`)
      await loadProviders()
      await fetchMe()
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to remove provider')
    }
  }

  const handleValidateProvider = async (id: string) => {
    setValidating(true)
    setValidationResult(null)
    setError('')
    try {
      const res = await api.post(`/providers/${id}/validate`)
      setValidationResult(res.data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to validate provider')
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
          </div>
        </div>

        {/* Provider Management */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Server className="h-4 w-4" />
                AI Providers
              </h2>
              <p className="mt-1 text-xs text-text-helper">
                Add one or more AI providers. Your API keys are encrypted at rest with AES-256-GCM.
              </p>
            </div>
            <button
              onClick={() => {
                setShowAddModal(true)
                setError('')
                setApiKey('')
              }}
              className="flex shrink-0 whitespace-nowrap items-center gap-1.5 bg-interactive px-3 py-1.5 text-xs text-white transition-colors hover:bg-interactive-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Provider
            </button>
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
                  Saved successfully.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {providersLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-interactive" />
            </div>
          ) : providers.length === 0 ? (
            <div className="border border-border-subtle bg-background px-4 py-6 text-center">
              <Server className="mx-auto mb-2 h-6 w-6 text-text-helper" />
              <p className="text-xs text-text-helper">No providers configured</p>
              <p className="mt-1 text-[10px] text-text-helper/70">Add a provider to start chatting</p>
            </div>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex h-6 w-6 items-center justify-center ${p.is_active ? 'bg-interactive/10' : 'bg-border-subtle'}`}>
                      <Key className={`h-3 w-3 ${p.is_active ? 'text-interactive' : 'text-text-helper'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                      <p className="text-[10px] font-mono text-text-helper truncate">{p.base_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleValidateProvider(p.id)}
                      disabled={validating}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary disabled:opacity-40"
                    >
                      {validating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <TestTube className="h-3 w-3" />
                      )}
                      Test
                    </button>
                    <button
                      onClick={() => handleRemoveProvider(p.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] text-support-error transition-colors hover:bg-support-error/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

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
                  Provider key is valid and working!
                </div>
              ) : (
                <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {validationResult.error || 'Provider validation failed'}
                </div>
              )}
            </motion.div>
          )}
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

        {/* Integrations */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Wrench className="h-4 w-4" />
                Integrations
              </h2>
              <p className="mt-1 text-xs text-text-helper">
                Connect external services so the AI can manage your calendar, email, and tasks.
              </p>
            </div>
          </div>

          {integrationsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-interactive" />
            </div>
          ) : (
            <div className="space-y-2">
              {integrations.map((int) => {
                const isGoogle = int.provider === 'google'
                const isTodoist = int.provider === 'todoist'
                const Icon = isGoogle ? Mail : isTodoist ? ListTodo : Link
                const label = isGoogle ? 'Google (Calendar + Gmail)' : isTodoist ? 'Todoist (Tasks)' : int.provider

                return (
                  <div key={int.provider} className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center ${int.connected ? 'bg-support-success/10' : 'bg-border-subtle'}`}>
                        <Icon className={`h-3 w-3 ${int.connected ? 'text-support-success' : 'text-text-helper'}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">{label}</p>
                        <p className="text-[11px] text-text-helper">
                          {int.connected ? (int.scopes ? `Connected` : 'Connected') : 'Not connected'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {int.connected ? (
                        <button
                          onClick={() => handleDisconnectIntegration(int.provider)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] text-support-error transition-colors hover:bg-support-error/10"
                        >
                          <Unlink className="h-3 w-3" />
                          Disconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConnect(int.provider)}
                          disabled={connectingProvider === int.provider}
                          className="flex items-center gap-1 bg-interactive px-2 py-1 text-[11px] text-white transition-colors hover:bg-interactive-hover disabled:opacity-40"
                        >
                          {connectingProvider === int.provider ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Link className="h-3 w-3" />
                          )}
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-2 space-y-1.5">
            <div className="flex items-start gap-2 text-[11px] text-text-helper">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
              <span>Your credentials are encrypted with AES-256-GCM and never stored in plain text</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-text-helper">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
              <span>You can revoke access at any time from either Vulcan or the provider's settings</span>
            </div>
          </div>
        </div>

        {/* Tools & Agent Configuration */}
        <div className="border border-border-subtle bg-layer p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Wrench className="h-4 w-4" />
                AI Tools & Agent
              </h2>
              <p className="mt-1 text-xs text-text-helper">
                Control how the AI uses tools: sandboxed terminal, file operations, web search, and integrations.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Wrench className={`h-4 w-4 ${user?.tools_enabled ? 'text-interactive' : 'text-text-helper'}`} />
                <div>
                  <p className="text-sm font-medium text-text-primary">Enable AI Tools</p>
                  <p className="text-[11px] text-text-helper">
                    {user?.tools_enabled
                      ? 'AI can execute terminal commands, manage files, search the web, and use connected integrations'
                      : 'AI responds with text only — no tool execution'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    await api.post('/me/tools', { tools_enabled: !user?.tools_enabled })
                    await fetchMe()
                  } catch {}
                }}
                className={`relative h-5 w-9 transition-colors ${
                  user?.tools_enabled ? 'bg-interactive' : 'bg-border-subtle'
                }`}
              >
                <motion.div
                  animate={{ x: user?.tools_enabled ? 16 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute top-1 h-3 w-3 bg-white"
                />
              </button>
            </div>
            <div className="border border-border-subtle bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Brain className="h-4 w-4 text-link-primary" />
                <div>
                  <p className="text-sm font-medium text-text-primary">Agent Steps</p>
                  <p className="text-[11px] text-text-helper">
                    Maximum tool-calling iterations per message. Higher values allow the AI to chain multiple tools together.
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-sm text-text-primary">{user?.max_agent_steps || 10}</span>
                <span className="text-[10px] text-text-helper">steps (configured via max_agent_steps)</span>
              </div>
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
              { label: 'Encryption at Rest', desc: 'API keys are encrypted with AES-256-GCM before storage.', status: 'Active', color: 'text-support-success' },
              { label: 'Session Authentication', desc: 'JWT tokens stored in HttpOnly cookies with SameSite=Strict.', status: 'Active', color: 'text-support-success' },
              { label: 'CSRF Protection', desc: 'All state-changing requests require a valid CSRF token.', status: 'Active', color: 'text-support-success' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 border border-border-subtle bg-background px-3 py-2.5">
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

      {/* Add Provider Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md border border-border-subtle bg-layer p-5 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">Add AI Provider</h3>
                <button onClick={() => setShowAddModal(false)} className="text-text-helper hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {error && (
                <div className="mb-3 flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                    Provider
                  </label>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                  >
                    {BUILT_IN_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {selectedType === 'custom' && (
                  <>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                        Name
                      </label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="My Custom Provider"
                        className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-placeholder focus:border-focus focus:ring-1 focus:ring-focus"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={customBaseUrl}
                        onChange={(e) => setCustomBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                        className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-placeholder focus:border-focus focus:ring-1 focus:ring-focus"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                    API Key
                  </label>
                  <div className="flex items-center gap-2 border border-border-subtle bg-background px-3 py-2 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
                    <Key className="h-4 w-4 text-text-helper shrink-0" />
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-... or nvapi-..."
                      className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder font-mono"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="p-1 text-text-helper transition-colors hover:text-text-primary"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleAddProvider}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 bg-interactive px-4 py-2 text-xs text-white transition-colors hover:bg-interactive-hover disabled:opacity-40"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Provider
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
