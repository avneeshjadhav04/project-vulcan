import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import {
  AlertCircle,
  Check,
  Shield,
  Wrench,
  FileText,
  Terminal,
  Globe,
  Calendar,
  Mail,
  ListTodo,
  BookOpen,
  Code,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface ToolPermission {
  tool_name: string
  permission_level: 'auto' | 'ask' | 'deny'
}

interface ToolCategory {
  name: string
  icon: React.ReactNode
  tools: string[]
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'File Operations',
    icon: <FileText className="h-4 w-4" />,
    tools: ['create_file', 'read_file', 'modify_file'],
  },
  {
    name: 'Terminal',
    icon: <Terminal className="h-4 w-4" />,
    tools: ['execute_terminal_command'],
  },
  {
    name: 'Web',
    icon: <Globe className="h-4 w-4" />,
    tools: ['search_web', 'browser_fetch', 'fetch_webpage'],
  },
  {
    name: 'Calendar',
    icon: <Calendar className="h-4 w-4" />,
    tools: ['calendar_list_events', 'calendar_create_event', 'calendar_delete_event'],
  },
  {
    name: 'Email',
    icon: <Mail className="h-4 w-4" />,
    tools: ['email_send', 'email_list', 'email_read'],
  },
  {
    name: 'Tasks',
    icon: <ListTodo className="h-4 w-4" />,
    tools: ['tasks_list', 'tasks_create', 'tasks_update', 'tasks_complete'],
  },
  {
    name: 'Scratchpad',
    icon: <BookOpen className="h-4 w-4" />,
    tools: ['update_scratchpad', 'read_scratchpad'],
  },
  {
    name: 'Code',
    icon: <Code className="h-4 w-4" />,
    tools: ['execute_python'],
  },
]

export default function ToolPermissionsPanel() {
  const [permissions, setPermissions] = useState<ToolPermission[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(
    Object.fromEntries(TOOL_CATEGORIES.map((c) => [c.name, true]))
  )

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

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const setCategoryLevel = async (category: ToolCategory, level: 'auto' | 'ask' | 'deny') => {
    setError('')
    const promises = category.tools.map((tool) =>
      api.put(`/settings/tool-permissions/${tool}`, { permission_level: level })
    )
    try {
      await Promise.all(promises)
      setPermissions((prev) => {
        const next = prev.filter((p) => !category.tools.includes(p.tool_name))
        category.tools.forEach((tool) => {
          next.push({ tool_name: tool, permission_level: level })
        })
        return next
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update permissions')
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
        <div className="space-y-2">
          {TOOL_CATEGORIES.map((category) => {
            const isExpanded = expandedCategories[category.name]
            const allTools = category.tools
            const levels = allTools.map((t) => getLevel(t))
            const allSame = levels.every((l) => l === levels[0])
            const categoryLevel = allSame ? levels[0] : 'mixed'

            return (
              <div key={category.name} className="border border-border-subtle bg-background">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.name)}
                  className="flex w-full items-center justify-between px-3 py-2.5 transition-colors hover:bg-layer-hover"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-text-helper">{category.icon}</div>
                    <span className="text-sm font-medium text-text-primary">{category.name}</span>
                    <span className="text-[10px] text-text-helper">{allTools.length} tool{allTools.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {categoryLevel !== 'mixed' && levelBadge(categoryLevel)}
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-text-helper" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-text-helper" />
                    )}
                  </div>
                </button>

                {/* Category Bulk Actions */}
                {isExpanded && (
                  <div className="flex items-center gap-1 border-t border-border-subtle px-3 py-1.5 bg-layer/30">
                    <span className="text-[10px] text-text-helper mr-1">Set all:</span>
                    {(['auto', 'ask', 'deny'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setCategoryLevel(category, level)}
                        className={`px-2 py-0.5 text-[10px] font-medium uppercase transition-colors ${
                          categoryLevel === level
                            ? level === 'auto'
                              ? 'bg-support-success/20 text-support-success'
                              : level === 'ask'
                                ? 'bg-support-warning/20 text-support-warning'
                                : 'bg-support-error/20 text-support-error'
                            : 'text-text-helper hover:text-text-primary hover:bg-layer-hover'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                )}

                {/* Tools List */}
                {isExpanded && (
                  <div className="border-t border-border-subtle">
                    {allTools.map((tool) => {
                      const current = getLevel(tool)
                      return (
                        <div
                          key={tool}
                          className="flex items-center justify-between px-3 py-2 border-b border-border-subtle last:border-b-0"
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
          })}
        </div>
      )}
    </div>
  )
}
