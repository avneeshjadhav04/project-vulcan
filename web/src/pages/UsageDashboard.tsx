import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import {
  ArrowLeft,
  BarChart3,
  MessageSquare,
  Hash,
  Clock,
  TrendingUp,
} from 'lucide-react'

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

export default function UsageDashboard() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadUsage()
  }, [])

  const loadUsage = async () => {
    setLoading(true)
    try {
      const res = await api.get('/usage')
      setUsage(res.data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load usage data')
    } finally {
      setLoading(false)
    }
  }

  const maxMessages = Math.max(...(usage?.daily?.map((d) => d.messages) || [1]), 1)
  const maxTokens = Math.max(...(usage?.daily?.map((d) => d.tokens) || [1]), 1)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border-subtle bg-background px-5 py-3">
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-interactive" />
          <h1 className="text-sm font-semibold text-text-primary">Usage Dashboard</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-5 space-y-4">
        {error && (
          <div className="border border-support-error/30 bg-support-error/10 px-4 py-3 text-sm text-support-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin border-2 border-interactive border-t-transparent" />
          </div>
        ) : usage ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SummaryCard
                icon={<MessageSquare className="h-4 w-4 text-interactive" />}
                label="Total Messages"
                value={usage.total_messages.toLocaleString()}
              />
              <SummaryCard
                icon={<Hash className="h-4 w-4 text-support-success" />}
                label="Total Tokens"
                value={usage.total_tokens.toLocaleString()}
              />
              <SummaryCard
                icon={<TrendingUp className="h-4 w-4 text-support-warning" />}
                label="Daily Average"
                value={usage.daily.length > 0 ? Math.round(usage.total_messages / usage.daily.length) : 0}
              />
            </div>

            {/* Daily Breakdown */}
            <div className="border border-border-subtle bg-layer p-5">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-helper">
                <Clock className="h-4 w-4" />
                Daily Breakdown (Last 7 Days)
              </h2>

              {usage.daily.length === 0 ? (
                <div className="py-8 text-center text-sm text-text-helper">No usage data yet</div>
              ) : (
                <div className="space-y-4">
                  {usage.daily.map((day) => (
                    <div key={day.date} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">{new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        <span className="text-text-helper">{day.messages} msgs · {day.tokens.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-border-subtle rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(day.messages / maxMessages) * 100}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="h-full bg-interactive rounded-full"
                          />
                        </div>
                        <div className="w-24 h-2 bg-border-subtle rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(day.tokens / maxTokens) * 100}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="h-full bg-support-success rounded-full"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="border border-border-subtle bg-layer p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-text-primary">{value}</p>
    </div>
  )
}
