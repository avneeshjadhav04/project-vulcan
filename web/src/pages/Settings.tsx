import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import ToolPermissionsPanel from '../components/ToolPermissionsPanel'
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
  Sun,
  Moon,
  Notebook,
  Settings2,
  MemoryStick,
  Puzzle,
} from 'lucide-react'

interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  is_active: boolean
}

interface IntegrationInfo {
  provider: string
  connected: boolean
  scopes?: string
  expires_at?: string
  is_configured: boolean
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

type SettingsTab = 'profile' | 'providers' | 'tools' | 'memory' | 'integrations'

const TAB_ITEMS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User className="h-4 w-4" /> },
  { id: 'providers', label: 'AI Providers', icon: <Server className="h-4 w-4" /> },
  { id: 'tools', label: 'AI Tools', icon: <Wrench className="h-4 w-4" /> },
  { id: 'memory', label: 'Memory', icon: <MemoryStick className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Puzzle className="h-4 w-4" /> },
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
  const [searchParams, setSearchParams] = useSearchParams()
  const validTabs: SettingsTab[] = ['profile', 'providers', 'tools', 'memory', 'integrations']
  const initialTab = validTabs.includes(searchParams.get('tab') as SettingsTab) ? (searchParams.get('tab') as SettingsTab) : 'profile'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  // Add provider form state
  const [selectedType, setSelectedType] = useState('nvidia')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [validationResult, setValidationResult] = useState<{valid: boolean; error?: string; provider_id?: string} | null>(null)
  const [validating, setValidating] = useState(false)
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([])
  const [integrationsLoading, setIntegrationsLoading] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configProvider, setConfigProvider] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [configSaving, setConfigSaving] = useState(false)

  // Scratchpad state
  const [scratchpad, setScratchpad] = useState('')
  const [scratchpadLoading, setScratchpadLoading] = useState(false)
  const [scratchpadSaving, setScratchpadSaving] = useState(false)

  // Provider validation cache
  const [providerValidations, setProviderValidations] = useState<Record<string, { valid: boolean; error?: string }>>({})

  // Agent steps
  const [agentSteps, setAgentSteps] = useState(user?.max_agent_steps || 10)
  const [agentStepsSaving, setAgentStepsSaving] = useState(false)

  // Theme
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  useEffect(() => {
    loadProviders()
    loadIntegrations()
    loadScratchpad()
    const params = new URLSearchParams(window.location.search)
    const justConnected = params.get('status')
    if (justConnected === 'connected') {
      setSaved(true)
      window.history.replaceState({}, '', '/settings')
    }
  }, [])

  useEffect(() => {
    if (user?.max_agent_steps) {
      setAgentSteps(user.max_agent_steps)
    }
  }, [user?.max_agent_steps])

  // Sync active tab to URL
  useEffect(() => {
    if (activeTab !== searchParams.get('tab')) {
      setSearchParams({ tab: activeTab }, { replace: true })
    }
  }, [activeTab])

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

  const handleSaveConfig = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Client ID and Secret are required')
      return
    }
    setError('')
    setConfigSaving(true)
    try {
      await api.put(`/integrations/${configProvider}/config`, {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      })
      await loadIntegrations()
      setShowConfigModal(false)
      setClientId('')
      setClientSecret('')
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save configuration')
    } finally {
      setConfigSaving(false)
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
      setProviderValidations((prev) => ({ ...prev, [id]: res.data }))
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to validate provider')
    } finally {
      setValidating(false)
    }
  }

  const loadScratchpad = async () => {
    setScratchpadLoading(true)
    try {
      const res = await api.get('/me/scratchpad')
      setScratchpad(res.data?.content || '')
    } catch {
      setScratchpad('')
    } finally {
      setScratchpadLoading(false)
    }
  }

  const saveScratchpad = async () => {
    setScratchpadSaving(true)
    try {
      await api.post('/me/scratchpad', { content: scratchpad })
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save scratchpad')
    } finally {
      setScratchpadSaving(false)
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

  const handleUpdateAgentSteps = async (steps: number) => {
    setAgentStepsSaving(true)
    try {
      await api.post('/me/agent-steps', { max_agent_steps: steps })
      setAgentSteps(steps)
      await fetchMe()
      setSaved(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update agent steps')
    } finally {
      setAgentStepsSaving(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tabs */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border-subtle bg-layer/30 p-3">
          <div className="space-y-1">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setError('') }}
                className={`flex w-full items-center gap-2 rounded-carbon px-3 py-2.5 text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-interactive/10 text-interactive shadow-inner'
                    : 'text-text-secondary hover:bg-layer/60 hover:text-text-primary'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl space-y-4">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {saved && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 border border-support-success/30 bg-support-success/10 px-3 py-2 text-xs text-support-success">
                    <Check className="h-4 w-4 shrink-0" />
                    Saved successfully.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
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

                {/* Appearance */}
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                        {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        Appearance
                      </h2>
                      <p className="mt-1 text-xs text-text-helper">
                        Choose your preferred theme.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      {theme === 'light' ? <Sun className="h-4 w-4 text-support-warning" /> : <Moon className="h-4 w-4 text-interactive" />}
                      <div>
                        <p className="text-sm font-medium text-text-primary">Theme</p>
                        <p className="text-[11px] text-text-helper capitalize">{theme}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {(['dark', 'light', 'system'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTheme(t)}
                          className={`px-3 py-1 text-[11px] font-medium uppercase transition-colors ${
                            theme === t
                              ? 'bg-interactive text-white'
                              : 'text-text-secondary hover:bg-layer-hover hover:text-text-primary'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* AI Providers Tab */}
            {activeTab === 'providers' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
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
                      {providers.map((p) => {
                        const pv = providerValidations[p.id]
                        return (
                          <div key={p.id} className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`flex h-6 w-6 items-center justify-center ${p.is_active ? 'bg-interactive/10' : 'bg-border-subtle'}`}>
                                <Key className={`h-3 w-3 ${p.is_active ? 'text-interactive' : 'text-text-helper'}`} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                                  {pv && (
                                    <span className={`inline-flex h-2 w-2 rounded-full ${pv.valid ? 'bg-support-success' : 'bg-support-error'}`} title={pv.valid ? 'Valid' : pv.error || 'Invalid'} />
                                  )}
                                </div>
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
                        )
                      })}
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
              </motion.div>
            )}

            {/* AI Tools Tab */}
            {activeTab === 'tools' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Agent Steps */}
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                      <Settings2 className="h-4 w-4" />
                      Agent Configuration
                    </h2>
                    <p className="mt-1 text-xs text-text-helper">
                      Control how many tool-calling iterations the AI can perform per message.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Brain className="h-4 w-4 text-link-primary" />
                        <div>
                          <p className="text-sm font-medium text-text-primary">Max Agent Steps</p>
                          <p className="text-[11px] text-text-helper">
                            Higher values allow the AI to chain multiple tools together.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="50"
                          value={agentSteps}
                          onChange={(e) => setAgentSteps(Number(e.target.value))}
                          onMouseUp={() => handleUpdateAgentSteps(agentSteps)}
                          onTouchEnd={() => handleUpdateAgentSteps(agentSteps)}
                          className="h-1 w-32 cursor-pointer appearance-none rounded bg-border-subtle accent-interactive"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={agentSteps}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(50, Number(e.target.value)))
                              setAgentSteps(val)
                            }}
                            onBlur={() => handleUpdateAgentSteps(agentSteps)}
                            className="w-14 border border-border-subtle bg-background px-2 py-1 text-center text-sm text-text-primary outline-none focus:border-focus"
                          />
                          {agentStepsSaving && <Loader2 className="h-3 w-3 animate-spin text-interactive" />}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tool Permissions */}
                <ToolPermissionsPanel />
              </motion.div>
            )}

            {/* Memory Tab */}
            {activeTab === 'memory' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Long-Term Memory */}
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

                {/* Scratchpad Memory */}
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                        <Notebook className="h-4 w-4" />
                        Scratchpad Memory
                      </h2>
                      <p className="mt-1 text-xs text-text-helper">
                        Persistent notes the AI can read and update. Edit directly or let the AI manage it through conversations.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <textarea
                      value={scratchpad}
                      onChange={(e) => setScratchpad(e.target.value)}
                      placeholder="Your scratchpad is empty..."
                      rows={4}
                      className="w-full resize-none border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-helper">
                        {scratchpadLoading ? 'Loading...' : `${scratchpad.length} characters`}
                      </span>
                      <button
                        onClick={saveScratchpad}
                        disabled={scratchpadSaving}
                        className="flex items-center gap-1 bg-interactive px-3 py-1.5 text-xs text-white transition-colors hover:bg-interactive-hover disabled:opacity-50"
                      >
                        {scratchpadSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save Scratchpad
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Integrations Tab */}
            {activeTab === 'integrations' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
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
                                  {int.connected ? 'Connected' : 'Not connected'}
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
                              ) : !int.is_configured ? (
                                <button
                                  onClick={() => {
                                    setConfigProvider(int.provider)
                                    setClientId('')
                                    setClientSecret('')
                                    setShowConfigModal(true)
                                  }}
                                  className="flex items-center gap-1 bg-interactive px-2 py-1 text-[11px] text-white transition-colors hover:bg-interactive-hover"
                                >
                                  <Key className="h-4 w-4" />
                                  Configure App
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
              </motion.div>
            )}
          </div>
        </main>
      </div>

      {/* Configure Integration Modal */}
      <AnimatePresence>
        {showConfigModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4"
            onClick={() => setShowConfigModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md border border-border-subtle bg-layer p-5 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary capitalize">
                  Configure {configProvider} App
                </h3>
                <button onClick={() => setShowConfigModal(false)} className="text-text-helper hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {error && (
                <div className="mb-3 flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <p className="text-[11px] text-text-helper">
                  To connect {configProvider}, you need to provide your own OAuth Client ID and Secret. 
                  These credentials will be encrypted using AES-256-GCM and stored securely in your database.
                </p>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-helper focus:border-interactive focus:outline-none"
                    placeholder="Enter your Client ID"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-helper focus:border-interactive focus:outline-none"
                    placeholder="Enter your Client Secret"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={configSaving || !clientId.trim() || !clientSecret.trim()}
                  className="flex items-center gap-2 bg-interactive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-interactive-hover disabled:opacity-50"
                >
                  {configSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Credentials
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
