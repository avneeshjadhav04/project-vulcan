import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import {
  AlertCircle,
  Check,
  Shield,
  Wrench,
} from 'lucide-react'

interface ToolPermission {
  tool_name: string
  permission_level: 'auto' | 'ask' | 'deny'
}

const ALL_TOOLS = [
  'execute_terminal_command',
  'create_file',
  'read_file',
  'modify_file',
  'search_web',
  'browser_fetch',
  'fetch_webpage',
  'update_scratchpad',
  'read_scratchpad',
  'calendar_list_events',
  'calendar_create_event',
  'calendar_delete_event',
  'email_send',
  'email_list',
  'email_read',
  'tasks_list',
  'tasks_create',
  'tasks_update',
  'tasks_complete',
  'execute_python',
]

export default function ToolPermissionsPanel() {
  const [permissions, setPermissions] = useState<ToolPermission[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadPermissions()
  }, [])

  const loadPermissions = async () => {
    setLoading(true)
    try {
      const res = await api.get('/settings/tool-permissions')
      setPermissions(res.data || [])
    } catch {
      setPermissions([])
    } finally {
      setLoading(false)
    }
  }

  const getLevel = (toolName: string) => {
    const found = permissions.find((p) => p.tool_name === toolName)
    return found?.permission_level || 'auto'
  }

  const handleChange = async (toolName: string, level: 'auto' | 'ask' | 'deny') => {
    setSaving(toolName)
    setError('')
    try {
      await api.put(`/settings/tool-permissions/${toolName}`, { permission_level: level })
      setPermissions((prev) => {
        const next = prev.filter((p) => p.tool_name !== toolName)
        next.push({ tool_name: toolName, permission_level: level })
        return next
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update permission')
    } finally {
      setSaving(null)
    }
  }

  const levelBadge = (level: string) => {
    switch (level) {
      case 'auto':
        return <span className="inline-flex items-center gap-1 bg-support-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-support-success">Auto</span>
      case 'ask':
        return <span className="inline-flex items-center gap-1 bg-support-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-support-warning">Ask</span>
      case 'deny':
        return <span className="inline-flex items-center gap-1 bg-support-error/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-support-error">Deny</span>
      default:
        return null
    }
  }

  return (
    <div className="border border-border-subtle bg-layer p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
            <Shield className="h-4 w-4" />
            Tool Permissions
          </h2>
          <p className="mt-1 text-xs text-text-helper">
            Control how the AI can use each tool. Auto = execute immediately, Ask = require approval, Deny = block entirely.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-xs text-support-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {saved && (
        <div className="mb-3 flex items-center gap-2 border border-support-success/30 bg-support-success/10 px-3 py-2 text-xs text-support-success">
          <Check className="h-4 w-4 shrink-0" />
          Permissions updated.
        </div>
      )}

      {loading ? (
        <div className="py-4 text-center text-xs text-text-helper">Loading...</div>
      ) : (
        <div className="space-y-1">
          {ALL_TOOLS.map((tool) => {
            const current = getLevel(tool)
            return (
              <div
                key={tool}
                className="flex items-center justify-between border border-border-subtle bg-background px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Wrench className="h-3.5 w-3.5 text-text-helper shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {tool.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[10px] text-text-helper font-mono">{tool}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {levelBadge(current)}
                  <select
                    value={current}
                    onChange={(e) => handleChange(tool, e.target.value as 'auto' | 'ask' | 'deny')}
                    disabled={saving === tool}
                    className="border border-border-subtle bg-background px-2 py-1 text-xs text-text-primary outline-none focus:border-focus"
                  >
                    <option value="auto">Auto</option>
                    <option value="ask">Ask</option>
                    <option value="deny">Deny</option>
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
