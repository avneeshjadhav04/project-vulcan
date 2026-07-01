import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import ToolPermissionsPanel from '../components/ToolPermissionsPanel'
import ThemeLogo from '../components/ThemeLogo'
import { PasswordInput } from '../components/PasswordInput'
import { PasswordStrength } from '../components/PasswordStrength'
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
  Wrench,
  Sun,
  Moon,
  Notebook,
  Settings2,
  MemoryStick,
  Puzzle,
  BarChart3,
  LogOut,
  MessageSquare,
  Hash,
  Clock,
  TrendingUp,
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

interface UsageDay {
  date: string
  messages: number
  tokens: number
}

interface UsageData {
  total_messages: number
  total_tokens: number
  daily: UsageDay[]
}

interface AdminUser {
  id: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

type SettingsTab = 'profile' | 'providers' | 'tools' | 'memory' | 'integrations' | 'usage' | 'signout'

const TAB_ITEMS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Account', icon: <User className="h-4 w-4" /> },
  { id: 'providers', label: 'AI Providers', icon: <Server className="h-4 w-4" /> },
  { id: 'tools', label: 'AI Tools', icon: <Wrench className="h-4 w-4" /> },
  { id: 'memory', label: 'Memory', icon: <MemoryStick className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Puzzle className="h-4 w-4" /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'signout', label: 'Sign Out', icon: <LogOut className="h-4 w-4" /> },
]

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const logout = useAuthStore((s) => s.logout)
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const validTabs: SettingsTab[] = ['profile', 'providers', 'tools', 'memory', 'integrations', 'signout']
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

  // Admin user management
  const [showUserModal, setShowUserModal] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserConfirmPassword, setNewUserConfirmPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user')
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ userId: string; action: 'role' | 'active' | 'delete' } | null>(null)

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(null), 3000)
    return () => clearTimeout(id)
  }, [confirming])

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  useEffect(() => {
    loadProviders()
    loadScratchpad()
    if (isAdmin) {
      loadUsers()
    }
  }, [isAdmin])

  useEffect(() => {
    if (user?.max_agent_steps) {
      setAgentSteps(user.max_agent_steps)
    }
  }, [user?.max_agent_steps])

  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsage()
    }
  }, [activeTab])

  // Sync active tab to URL
  useEffect(() => {
    if (activeTab !== searchParams.get('tab')) {
      setSearchParams({ tab: activeTab }, { replace: true })
    }
  }, [activeTab])

  const loadUsage = async () => {
    setUsageLoading(true)
    setUsageError('')
    try {
      const res = await api.get('/usage')
      setUsage(res.data || null)
    } catch (err: any) {
      setUsageError(err.response?.data?.error || 'Failed to load usage data')
    } finally {
      setUsageLoading(false)
    }
  }

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

  const loadUsers = async () => {
    setUsersLoading(true)
    try {
      const res = await api.get('/admin/users')
      setUsers(res.data || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load users')
    } finally {
      setUsersLoading(false)
    }
  }

  const handleCreateUser = async () => {
    if (!newUserEmail.trim() || !newUserPassword) {
      setError('Email and password are required')
      return
    }
    if (newUserPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (newUserPassword !== newUserConfirmPassword) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setUserActionLoading('create')
    try {
      await api.post('/admin/users', {
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole,
      })
      setSaved(true)
      setShowUserModal(false)
      setNewUserEmail('')
      setNewUserPassword('')
      setNewUserConfirmPassword('')
      setNewUserRole('user')
      await loadUsers()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create user')
    } finally {
      setUserActionLoading(null)
    }
  }

  const executeToggleUserActive = async (u: AdminUser) => {
    setUserActionLoading(`active-${u.id}`)
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active })
      await loadUsers()
      if (u.id === user?.id && u.is_active) {
        await logout()
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update user')
    } finally {
      setUserActionLoading(null)
      setConfirming(null)
    }
  }

  const executeToggleUserRole = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin'
    setUserActionLoading(`role-${u.id}`)
    try {
      await api.patch(`/admin/users/${u.id}`, { role: newRole })
      await loadUsers()
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update role')
    } finally {
      setUserActionLoading(null)
      setConfirming(null)
    }
  }

  const executeDeleteUser = async (u: AdminUser) => {
    setUserActionLoading(`delete-${u.id}`)
    try {
      await api.delete(`/admin/users/${u.id}`)
      await loadUsers()
      if (u.id === user?.id) {
        await logout()
      } else {
        setSaved(true)
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete user')
    } finally {
      setUserActionLoading(null)
      setConfirming(null)
    }
  }

  const requestConfirm = (userId: string, action: 'role' | 'active' | 'delete') => {
    setConfirming({ userId, action })
  }

  const handleToggleUserActive = (u: AdminUser) => {
    if (confirming?.userId === u.id && confirming?.action === 'active') {
      executeToggleUserActive(u)
    } else {
      requestConfirm(u.id, 'active')
    }
  }

  const handleToggleUserRole = (u: AdminUser) => {
    if (confirming?.userId === u.id && confirming?.action === 'role') {
      executeToggleUserRole(u)
    } else {
      requestConfirm(u.id, 'role')
    }
  }

  const handleDeleteUser = (u: AdminUser) => {
    if (confirming?.userId === u.id && confirming?.action === 'delete') {
      executeDeleteUser(u)
    } else {
      requestConfirm(u.id, 'delete')
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

  const handleToggleSummarization = async () => {
    try {
      await api.post('/me/summarization')
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle summarization')
    }
  }

  const handleToggleCrossChatMemory = async () => {
    try {
      await api.post('/me/cross-chat-memory')
      await fetchMe()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle cross-chat memory')
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
          <ThemeLogo className="h-14 w-14" alt="" />
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
                onClick={() => {
                  setActiveTab(tab.id)
                  setError('')
                }}
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
                    <div className="flex h-10 w-10 items-center justify-center bg-interactive text-sm font-semibold text-on-interactive">
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
                              ? 'bg-interactive text-on-interactive'
                              : 'text-text-secondary hover:bg-layer-hover hover:text-text-primary'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Admin: Account Management */}
                {isAdmin && (
                  <div className="border border-border-subtle bg-layer p-5">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                          <Shield className="h-4 w-4" />
                          Account Management
                        </h2>
                        <p className="mt-1 text-xs text-text-helper">
                          Create, enable, disable, and delete user accounts.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setShowUserModal(true)
                          setError('')
                        }}
                        className="flex shrink-0 items-center gap-1.5 bg-interactive px-3 py-1.5 text-xs text-on-interactive transition-colors hover:bg-interactive-hover"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create Account
                      </button>
                    </div>

                    {usersLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-interactive" />
                      </div>
                    ) : users.length === 0 ? (
                      <div className="border border-border-subtle bg-background px-4 py-6 text-center">
                        <User className="mx-auto mb-2 h-6 w-6 text-text-helper" />
                        <p className="text-xs text-text-helper">No users found</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {users.map((u) => (
                          <div
                            key={u.id}
                            className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-text-primary truncate">{u.email}</p>
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                    u.role === 'admin'
                                      ? 'bg-interactive/10 text-interactive'
                                      : 'bg-text-helper/10 text-text-helper'
                                  }`}
                                >
                                  {u.role}
                                </span>
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                    u.is_active
                                      ? 'bg-support-success/10 text-support-success'
                                      : 'bg-support-error/10 text-support-error'
                                  }`}
                                >
                                  {u.is_active ? 'Active' : 'Disabled'}
                                </span>
                              </div>
                              <p className="text-[10px] text-text-helper">
                                Created {new Date(u.created_at).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => handleToggleUserRole(u)}
                                disabled={userActionLoading === `role-${u.id}`}
                                className={`px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                                  confirming?.userId === u.id && confirming?.action === 'role'
                                    ? 'bg-interactive/10 text-interactive hover:bg-interactive/20'
                                    : 'text-text-secondary hover:bg-layer-hover hover:text-text-primary'
                                }`}
                              >
                                {userActionLoading === `role-${u.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : confirming?.userId === u.id && confirming?.action === 'role' ? (
                                  'Confirm?'
                                ) : u.role === 'admin' ? (
                                  'Make User'
                                ) : (
                                  'Make Admin'
                                )}
                              </button>
                              <button
                                onClick={() => handleToggleUserActive(u)}
                                disabled={userActionLoading === `active-${u.id}`}
                                className={`px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                                  confirming?.userId === u.id && confirming?.action === 'active'
                                    ? 'bg-interactive/10 text-interactive hover:bg-interactive/20'
                                    : 'text-text-secondary hover:bg-layer-hover hover:text-text-primary'
                                }`}
                              >
                                {userActionLoading === `active-${u.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : confirming?.userId === u.id && confirming?.action === 'active' ? (
                                  'Confirm?'
                                ) : u.is_active ? (
                                  'Disable'
                                ) : (
                                  'Enable'
                                )}
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u)}
                                disabled={userActionLoading === `delete-${u.id}`}
                                className={`flex items-center gap-1 px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                                  confirming?.userId === u.id && confirming?.action === 'delete'
                                    ? 'bg-support-error/10 text-support-error hover:bg-support-error/20'
                                    : 'text-support-error hover:bg-support-error/10'
                                }`}
                              >
                                {userActionLoading === `delete-${u.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : confirming?.userId === u.id && confirming?.action === 'delete' ? (
                                  'Confirm?'
                                ) : (
                                  <>
                                    <Trash2 className="h-3 w-3" />
                                    Delete
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                      className="flex shrink-0 whitespace-nowrap items-center gap-1.5 bg-interactive px-3 py-1.5 text-xs text-on-interactive transition-colors hover:bg-interactive-hover"
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
                {/* Conversation Summarization */}
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                        <Brain className="h-4 w-4" />
                        Conversation Summarization
                      </h2>
                      <p className="mt-1 text-xs text-text-helper">
                        Automatically summarize older conversations so the AI remembers context across long chats.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Brain className={`h-4 w-4 ${user?.summarization_enabled ? 'text-interactive' : 'text-text-helper'}`} />
                      <div>
                        <p className="text-sm font-medium text-text-primary">Auto-Summarize</p>
                        <p className="text-[11px] text-text-helper">
                          {user?.summarization_enabled
                            ? 'Enabled — AI will summarize older messages to maintain context'
                            : 'Disabled — AI sees all messages (may hit token limits)'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleToggleSummarization}
                      className={`relative h-5 w-9 transition-colors ${
                        user?.summarization_enabled ? 'bg-interactive' : 'bg-border-subtle'
                      }`}
                    >
                      <motion.div
                        animate={{ x: user?.summarization_enabled ? 16 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute top-1 h-3 w-3 bg-white"
                      />
                    </button>
                  </div>
                </div>

                {/* Cross-Chat Memory */}
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                        <Brain className="h-4 w-4" />
                        Cross-Chat Memory
                      </h2>
                      <p className="mt-1 text-xs text-text-helper">
                        Allow the AI to remember facts across all your conversations. Disabled by default for privacy.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Brain className={`h-4 w-4 ${user?.cross_chat_memory_enabled ? 'text-interactive' : 'text-text-helper'}`} />
                      <div>
                        <p className="text-sm font-medium text-text-primary">Cross-Chat Context</p>
                        <p className="text-[11px] text-text-helper">
                          {user?.cross_chat_memory_enabled
                            ? 'Enabled — AI remembers facts across all chats'
                            : 'Disabled — Each chat is completely isolated'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleToggleCrossChatMemory}
                      className={`relative h-5 w-9 transition-colors ${
                        user?.cross_chat_memory_enabled ? 'bg-interactive' : 'bg-border-subtle'
                      }`}
                    >
                      <motion.div
                        animate={{ x: user?.cross_chat_memory_enabled ? 16 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute top-1 h-3 w-3 bg-white"
                      />
                    </button>
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
                        className="flex items-center gap-1 bg-interactive px-3 py-1.5 text-xs text-on-interactive transition-colors hover:bg-interactive-hover disabled:opacity-50"
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
                        Third-party services will be connected through MCP servers.
                      </p>
                    </div>
                  </div>

                  <div className="border border-border-subtle bg-background px-4 py-6 text-center">
                    <Puzzle className="mx-auto mb-2 h-6 w-6 text-text-helper" />
                    <p className="text-xs text-text-helper">MCP-based integrations are coming soon.</p>
                    <p className="mt-1 text-[10px] text-text-helper/70">
                      Third-party service integrations will be managed here.
                    </p>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-start gap-2 text-[11px] text-text-helper">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-support-success" />
                      <span>Third-party integrations will be managed here once MCP support is enabled.</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Usage Tab */}
            {activeTab === 'usage' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                      <BarChart3 className="h-4 w-4" />
                      Usage Dashboard
                    </h2>
                    <p className="mt-1 text-xs text-text-helper">
                      Track your message and token usage over the last 7 days.
                    </p>
                  </div>

                  {usageError ? (
                    <div className="border border-support-error/30 bg-support-error/10 px-4 py-3 text-sm text-support-error">
                      {usageError}
                    </div>
                  ) : usageLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-interactive" />
                    </div>
                  ) : usage ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <UsageSummaryCard
                          icon={<MessageSquare className="h-4 w-4 text-interactive" />}
                          label="Total Messages"
                          value={usage.total_messages.toLocaleString()}
                        />
                        <UsageSummaryCard
                          icon={<Hash className="h-4 w-4 text-support-success" />}
                          label="Total Tokens"
                          value={usage.total_tokens.toLocaleString()}
                        />
                        <UsageSummaryCard
                          icon={<TrendingUp className="h-4 w-4 text-support-warning" />}
                          label="Daily Average"
                          value={
                            usage.daily.length > 0
                              ? Math.round(usage.total_messages / usage.daily.length)
                              : 0
                          }
                        />
                      </div>

                      <div className="border border-border-subtle bg-background p-5">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                          <Clock className="h-4 w-4" />
                          Daily Breakdown (Last 7 Days)
                        </h3>

                        {usage.daily.length === 0 ? (
                          <div className="py-8 text-center text-sm text-text-helper">No usage data yet</div>
                        ) : (
                          <DailyUsageBars daily={usage.daily} />
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            )}

            {/* Sign Out Tab */}
            {activeTab === 'signout' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="border border-border-subtle bg-layer p-5">
                  <div className="mb-4">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </h2>
                    <p className="mt-1 text-xs text-text-helper">
                      Log out of your Project Vulcan account.
                    </p>
                  </div>
                  <div className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <LogOut className="h-4 w-4 text-support-error" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">Sign Out</p>
                        <p className="text-[11px] text-text-helper">You will be redirected to the login page.</p>
                      </div>
                    </div>
                    <button
                      onClick={logout}
                      className="flex items-center gap-1 bg-support-error px-3 py-1.5 text-xs text-on-support-error transition-colors hover:bg-support-error/80"
                    >
                      <LogOut className="h-3 w-3" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </main>
      </div>

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
                    className="flex w-full items-center justify-center gap-2 bg-interactive px-4 py-2 text-xs text-on-interactive transition-colors hover:bg-interactive-hover disabled:opacity-40"
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

      {/* Create User Modal */}
      <AnimatePresence>
        {showUserModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4"
            onClick={() => setShowUserModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md border border-border-subtle bg-layer p-5 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">Create Account</h3>
                <button onClick={() => setShowUserModal(false)} className="text-text-helper hover:text-text-primary">
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
                    Email
                  </label>
                  <input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-placeholder focus:border-focus focus:ring-1 focus:ring-focus"
                  />
                </div>
                <div>
                  <PasswordInput
                    value={newUserPassword}
                    onChange={(v) => setNewUserPassword(v)}
                    label="Password"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  <PasswordStrength password={newUserPassword} />
                </div>
                <div>
                  <PasswordInput
                    value={newUserConfirmPassword}
                    onChange={(v) => setNewUserConfirmPassword(v)}
                    label="Confirm Password"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  {newUserConfirmPassword && newUserPassword === newUserConfirmPassword && (
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-support-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Passwords match
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                    Role
                  </label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as 'user' | 'admin')}
                    className="w-full border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleCreateUser}
                    disabled={userActionLoading === 'create'}
                    className="flex w-full items-center justify-center gap-2 bg-interactive px-4 py-2 text-xs text-on-interactive transition-colors hover:bg-interactive-hover disabled:opacity-40"
                  >
                    {userActionLoading === 'create' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Create Account
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

function UsageSummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <div className="border border-border-subtle bg-background p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-text-primary">{value}</p>
    </div>
  )
}

function DailyUsageBars({ daily }: { daily: UsageDay[] }) {
  const maxMessages = Math.max(...daily.map((d) => d.messages), 1)
  const maxTokens = Math.max(...daily.map((d) => d.tokens), 1)

  return (
    <div className="space-y-4">
      {daily.map((day) => (
        <div key={day.date} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {new Date(day.date).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="text-text-helper">
              {day.messages} msgs · {day.tokens.toLocaleString()} tokens
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 overflow-hidden rounded-full bg-border-subtle">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(day.messages / maxMessages) * 100}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="h-2 rounded-full bg-interactive"
              />
            </div>
            <div className="w-24 overflow-hidden rounded-full bg-border-subtle">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(day.tokens / maxTokens) * 100}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="h-2 rounded-full bg-support-success"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
