import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import {
  Plus,
  Trash2,
  Edit2,
  Power,
  PowerOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Globe,
  KeyRound,
  ChevronDown,
  ChevronUp,
  Wrench,
  Save,
  X,
} from 'lucide-react'

interface McpServer {
  id: string
  name: string
  enabled: boolean
  auto_start: boolean
  transport: 'stdio' | 'sse'
  command?: string
  args?: string
  url?: string
  env_keys: string[]
  header_keys: string[]
  default_permission_level: 'auto' | 'ask' | 'deny'
}

interface ConnectionStatus {
  connected: boolean
  tools: number
  last_error?: string
}

interface FormData {
  name: string
  enabled: boolean
  auto_start: boolean
  transport: 'stdio' | 'sse'
  command: string
  args: string
  url: string
  env: Record<string, string>
  headers: Record<string, string>
  default_permission_level: 'auto' | 'ask' | 'deny'
}

const EMPTY_FORM: FormData = {
  name: '',
  enabled: true,
  auto_start: true,
  transport: 'stdio',
  command: '',
  args: '[]',
  url: '',
  env: {},
  headers: {},
  default_permission_level: 'ask',
}

export default function McpServersPanel() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [showEnvJson, setShowEnvJson] = useState(false)
  const [showHeadersJson, setShowHeadersJson] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})

  const loadServers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/mcp/servers')
      setServers(res.data || [])
      const initialExpanded: Record<string, boolean> = {}
      for (const s of res.data || []) {
        initialExpanded[s.id] = false
      }
      setExpandedServers(initialExpanded)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load MCP servers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  const fetchStatuses = useCallback(async () => {
    const next: Record<string, ConnectionStatus> = {}
    for (const server of servers) {
      try {
        const res = await api.post(`/mcp/servers/${server.id}/test`)
        next[server.id] = { connected: true, tools: 0, ...res.data }
      } catch (err: any) {
        next[server.id] = {
          connected: false,
          tools: 0,
          last_error: err.response?.data || err.message,
        }
      }
    }
    setStatuses(next)
  }, [servers])

  useEffect(() => {
    if (servers.length === 0) return
    fetchStatuses()
    // Poll less aggressively once servers are connected. Disconnected/unknown
    // servers poll every 10s for fast recovery; connected servers poll every
    // 60s as a liveness check so healthy stdio children aren't harassed.
    let interval: ReturnType<typeof setInterval> | null = null
    const schedule = () => {
      if (interval) clearInterval(interval)
      const anyDisconnected = servers.some((s) => {
        const st = statuses[s.id]
        return !st || !st.connected
      })
      interval = setInterval(fetchStatuses, anyDisconnected ? 10000 : 60000)
    }
    const initialTimeout = setTimeout(schedule, 10000)
    return () => {
      clearTimeout(initialTimeout)
      if (interval) clearInterval(interval)
    }
  }, [servers, fetchStatuses, statuses])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowEnvJson(false)
    setShowHeadersJson(false)
    setIsModalOpen(true)
  }

  const openEdit = (server: McpServer) => {
    setEditingId(server.id)
    setForm({
      ...EMPTY_FORM,
      name: server.name,
      enabled: server.enabled,
      auto_start: server.auto_start,
      transport: server.transport,
      command: server.command || '',
      args: server.args || '[]',
      url: server.url || '',
      default_permission_level: server.default_permission_level,
      env: {},
      headers: {},
    })
    setShowEnvJson(false)
    setShowHeadersJson(false)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const validateForm = (): string | null => {
    if (!form.name.trim()) return 'Name is required'
    if (form.transport === 'stdio' && !form.command.trim()) {
      return 'Command is required for stdio transport'
    }
    if (form.transport === 'sse' && !form.url.trim()) {
      return 'URL is required for SSE transport'
    }
    try {
      JSON.parse(form.args)
    } catch {
      return 'Args must be valid JSON array'
    }
    if (showEnvJson) {
      try {
        JSON.parse(JSON.stringify(form.env))
      } catch {
        return 'Env vars JSON is invalid'
      }
    }
    if (showHeadersJson) {
      try {
        JSON.parse(JSON.stringify(form.headers))
      } catch {
        return 'Headers JSON is invalid'
      }
    }
    return null
  }

  const handleSave = async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    const payload = {
      ...form,
      name: form.name.trim(),
      command: form.transport === 'stdio' ? form.command.trim() : undefined,
      url: form.transport === 'sse' ? form.url.trim() : undefined,
      args: form.transport === 'stdio' ? form.args : undefined,
      env: Object.keys(form.env).length > 0 ? form.env : undefined,
      headers: Object.keys(form.headers).length > 0 ? form.headers : undefined,
    }
    try {
      if (editingId) {
        await api.put(`/mcp/servers/${editingId}`, payload)
      } else {
        await api.post('/mcp/servers', payload)
      }
      closeModal()
      await loadServers()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save MCP server')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this MCP server configuration?')) return
    try {
      await api.delete(`/mcp/servers/${id}`)
      await loadServers()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete server')
    }
  }

  const handleConnect = async (id: string) => {
    try {
      await api.post(`/mcp/servers/${id}/connect`)
      await fetchStatuses()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to connect server')
    }
  }

  const handleDisconnect = async (id: string) => {
    try {
      await api.post(`/mcp/servers/${id}/disconnect`)
      await fetchStatuses()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to disconnect server')
    }
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      await api.post(`/mcp/servers/${id}/test`)
      await fetchStatuses()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Server test failed')
    } finally {
      setTestingId(null)
    }
  }

  const updateEnvKey = (oldKey: string, newKey: string) => {
    setForm((prev) => {
      const next = { ...prev.env }
      const value = next[oldKey]
      delete next[oldKey]
      if (newKey.trim()) next[newKey.trim()] = value
      return { ...prev, env: next }
    })
  }

  const updateEnvValue = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      env: { ...prev.env, [key]: value },
    }))
  }

  const addEnvRow = () => {
    setForm((prev) => ({
      ...prev,
      env: { ...prev.env, '': '' },
    }))
  }

  const removeEnvRow = (key: string) => {
    setForm((prev) => {
      const next = { ...prev.env }
      delete next[key]
      return { ...prev, env: next }
    })
  }

  const updateHeaderKey = (oldKey: string, newKey: string) => {
    setForm((prev) => {
      const next = { ...prev.headers }
      const value = next[oldKey]
      delete next[oldKey]
      if (newKey.trim()) next[newKey.trim()] = value
      return { ...prev, headers: next }
    })
  }

  const updateHeaderValue = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      headers: { ...prev.headers, [key]: value },
    }))
  }

  const addHeaderRow = () => {
    setForm((prev) => ({
      ...prev,
      headers: { ...prev.headers, '': '' },
    }))
  }

  const removeHeaderRow = (key: string) => {
    setForm((prev) => {
      const next = { ...prev.headers }
      delete next[key]
      return { ...prev, headers: next }
    })
  }

  const toggleExpanded = (id: string) => {
    setExpandedServers((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-4">
      <div className="border border-border-subtle bg-layer p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
              <Wrench className="h-4 w-4" />
              MCP Servers
            </h2>
            <p className="mt-1 text-xs text-text-helper">
              Add any Model Context Protocol server to extend Vulcan with third-party tools.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-layer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Server
          </button>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-carbon border border-support-error/30 bg-support-error/10 px-3 py-2 text-[11px] text-support-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {servers.length === 0 && !loading && (
          <div className="border border-border-subtle bg-background px-4 py-6 text-center">
            <Terminal className="mx-auto mb-2 h-6 w-6 text-text-helper" />
            <p className="text-xs text-text-helper">No MCP servers configured yet.</p>
            <p className="mt-1 text-[10px] text-text-helper/70">
              Add a server to expose its tools to the AI.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {servers.map((server) => {
            const status = statuses[server.id]
            return (
              <div
                key={server.id}
                className="overflow-hidden border border-border-subtle bg-background"
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    {server.transport === 'stdio' ? (
                      <Terminal className="h-3.5 w-3.5 text-text-helper" />
                    ) : (
                      <Globe className="h-3.5 w-3.5 text-text-helper" />
                    )}
                    <span className="text-xs font-medium text-text-primary">{server.name}</span>
                    <span className="rounded-carbon bg-layer px-1.5 py-0.5 text-[10px] text-text-helper">
                      {server.transport}
                    </span>
                    {status?.connected ? (
                      <span className="flex items-center gap-1 text-[10px] text-support-success">
                        <CheckCircle2 className="h-3 w-3" /> connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-support-error">
                        <AlertCircle className="h-3 w-3" /> disconnected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTest(server.id)}
                      disabled={testingId === server.id}
                      className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer hover:text-text-primary disabled:opacity-50"
                      title="Test connection"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${testingId === server.id ? 'animate-spin' : ''}`}
                      />
                    </button>
                    {status?.connected ? (
                      <button
                        onClick={() => handleDisconnect(server.id)}
                        className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer hover:text-support-error"
                        title="Disconnect"
                      >
                        <PowerOff className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(server.id)}
                        className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer hover:text-support-success"
                        title="Connect"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(server)}
                      className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer hover:text-text-primary"
                      title="Edit"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(server.id)}
                      className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer hover:text-support-error"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggleExpanded(server.id)}
                      className="rounded-carbon p-1.5 text-text-helper transition-colors hover:bg-layer"
                      title="Details"
                    >
                      {expandedServers[server.id] ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {expandedServers[server.id] && (
                  <div className="border-t border-border-subtle bg-layer px-3 py-2 text-[11px] text-text-secondary">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-text-helper">Transport:</span> {server.transport}
                      </div>
                      <div>
                        <span className="text-text-helper">Enabled:</span>{' '}
                        {server.enabled ? 'yes' : 'no'}
                      </div>
                      <div>
                        <span className="text-text-helper">Auto-start:</span>{' '}
                        {server.auto_start ? 'yes' : 'no'}
                      </div>
                      <div>
                        <span className="text-text-helper">Default permission:</span>{' '}
                        {server.default_permission_level}
                      </div>
                      {server.transport === 'stdio' && (
                        <>
                          <div className="col-span-2">
                            <span className="text-text-helper">Command:</span>{' '}
                            {server.command}
                          </div>
                          <div className="col-span-2">
                            <span className="text-text-helper">Args:</span>{' '}
                            {server.args || '[]'}
                          </div>
                        </>
                      )}
                      {server.transport === 'sse' && (
                        <div className="col-span-2">
                          <span className="text-text-helper">URL:</span> {server.url}
                        </div>
                      )}
                      <div className="col-span-2">
                        <span className="text-text-helper">Env keys:</span>{' '}
                        {server.env_keys.length > 0
                          ? server.env_keys.join(', ')
                          : 'none'}
                      </div>
                      <div className="col-span-2">
                        <span className="text-text-helper">Header keys:</span>{' '}
                        {server.header_keys.length > 0
                          ? server.header_keys.join(', ')
                          : 'none'}
                      </div>
                    </div>
                    {status?.last_error && (
                      <div className="mt-2 rounded-carbon border border-support-error/30 bg-support-error/10 px-2 py-1 text-[10px] text-support-error">
                        {status.last_error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto border border-border-subtle bg-layer p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                {editingId ? 'Edit MCP Server' : 'Add MCP Server'}
              </h3>
              <button
                onClick={closeModal}
                className="rounded-carbon p-1 text-text-helper hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-[11px]">
              <div>
                <label className="mb-1 block text-text-helper">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-text-primary outline-none focus:border-text-helper"
                  placeholder="My Calendar"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-text-helper">Transport</label>
                  <select
                    value={form.transport}
                    onChange={(e) =>
                      setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })
                    }
                    className="w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-text-primary outline-none focus:border-text-helper"
                  >
                    <option value="stdio">stdio (local process)</option>
                    <option value="sse">sse (remote endpoint)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-text-helper">Default permission</label>
                  <select
                    value={form.default_permission_level}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        default_permission_level: e.target.value as 'auto' | 'ask' | 'deny',
                      })
                    }
                    className="w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-text-primary outline-none focus:border-text-helper"
                  >
                    <option value="ask">ask</option>
                    <option value="auto">auto</option>
                    <option value="deny">deny</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.auto_start}
                    onChange={(e) => setForm({ ...form, auto_start: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  Auto-start
                </label>
              </div>

              {form.transport === 'stdio' ? (
                <>
                  <div>
                    <label className="mb-1 block text-text-helper">Command</label>
                    <input
                      type="text"
                      value={form.command}
                      onChange={(e) => setForm({ ...form, command: e.target.value })}
                      className="w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-text-primary outline-none focus:border-text-helper"
                      placeholder="npx -y @modelcontextprotocol/server-filesystem"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-text-helper">Args (JSON array)</label>
                    <textarea
                      value={form.args}
                      onChange={(e) => setForm({ ...form, args: e.target.value })}
                      className="h-20 w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-text-helper"
                      placeholder='["/workspace"]'
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-1 block text-text-helper">URL</label>
                  <input
                    type="text"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 text-text-primary outline-none focus:border-text-helper"
                    placeholder="http://localhost:3001/sse"
                  />
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-1 text-text-helper">
                    <KeyRound className="h-3 w-3" /> Environment variables
                  </label>
                  <button
                    onClick={() => setShowEnvJson((v) => !v)}
                    className="text-[10px] text-text-helper underline hover:text-text-primary"
                  >
                    {showEnvJson ? 'Edit as table' : 'Edit as JSON'}
                  </button>
                </div>
                {showEnvJson ? (
                  <textarea
                    value={JSON.stringify(form.env, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value)
                        setForm({ ...form, env: parsed })
                      } catch {
                        // ignore invalid intermediate JSON
                      }
                    }}
                    className="h-24 w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-text-helper"
                  />
                ) : (
                  <div className="space-y-1">
                    {Object.entries(form.env).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={key}
                          onChange={(e) => updateEnvKey(key, e.target.value)}
                          placeholder="KEY"
                          className="flex-1 rounded-carbon border border-border-subtle bg-background px-2 py-1 text-[10px] text-text-primary outline-none focus:border-text-helper"
                        />
                        <input
                          type="password"
                          value={value}
                          onChange={(e) => updateEnvValue(key, e.target.value)}
                          placeholder="value"
                          className="flex-1 rounded-carbon border border-border-subtle bg-background px-2 py-1 text-[10px] text-text-primary outline-none focus:border-text-helper"
                        />
                        <button
                          onClick={() => removeEnvRow(key)}
                          className="rounded-carbon p-1 text-text-helper hover:text-support-error"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addEnvRow}
                      className="inline-flex items-center gap-1 text-[10px] text-text-helper hover:text-text-primary"
                    >
                      <Plus className="h-3 w-3" /> Add env var
                    </button>
                  </div>
                )}
              </div>

              {form.transport === 'sse' && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-text-helper">HTTP headers</label>
                    <button
                      onClick={() => setShowHeadersJson((v) => !v)}
                      className="text-[10px] text-text-helper underline hover:text-text-primary"
                    >
                      {showHeadersJson ? 'Edit as table' : 'Edit as JSON'}
                    </button>
                  </div>
                  {showHeadersJson ? (
                    <textarea
                      value={JSON.stringify(form.headers, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value)
                          setForm({ ...form, headers: parsed })
                        } catch {
                          // ignore invalid intermediate JSON
                        }
                      }}
                      className="h-24 w-full rounded-carbon border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-text-helper"
                    />
                  ) : (
                    <div className="space-y-1">
                      {Object.entries(form.headers).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={key}
                            onChange={(e) => updateHeaderKey(key, e.target.value)}
                            placeholder="Header"
                            className="flex-1 rounded-carbon border border-border-subtle bg-background px-2 py-1 text-[10px] text-text-primary outline-none focus:border-text-helper"
                          />
                          <input
                            type="password"
                            value={value}
                            onChange={(e) => updateHeaderValue(key, e.target.value)}
                            placeholder="value"
                            className="flex-1 rounded-carbon border border-border-subtle bg-background px-2 py-1 text-[10px] text-text-primary outline-none focus:border-text-helper"
                          />
                          <button
                            onClick={() => removeHeaderRow(key)}
                            className="rounded-carbon p-1 text-text-helper hover:text-support-error"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={addHeaderRow}
                        className="inline-flex items-center gap-1 text-[10px] text-text-helper hover:text-text-primary"
                      >
                        <Plus className="h-3 w-3" /> Add header
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-carbon border border-border-subtle bg-background px-3 py-1.5 text-[11px] text-text-primary hover:bg-layer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1 rounded-carbon bg-text-primary px-3 py-1.5 text-[11px] font-medium text-background hover:bg-text-primary/90"
              >
                <Save className="h-3.5 w-3.5" />
                {editingId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
