import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ArrowLeft, Activity, Loader2 } from 'lucide-react'

interface TerminalLog {
  id: string
  user_id: string | null
  command: string
  status: string
  started_at: string
  ended_at: string | null
}

export default function Admin() {
  const navigate = useNavigate()

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: async () => {
      const res = await api.get('/admin/terminal-logs')
      return res.data as TerminalLog[]
    },
  })

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-4 border-b border-border-subtle bg-background px-5 py-3">
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-sm font-semibold text-text-primary">System Logs</h1>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-5">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Activity className="h-4 w-4 text-interactive" />
            Terminal Sessions
          </h2>
          <div className="overflow-x-auto border border-border-subtle bg-layer">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-subtle bg-background">
                <tr>
                  <th className="px-3 py-2.5 text-xs font-semibold text-text-helper">Command</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-text-helper">Status</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-text-helper">Started</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-text-helper">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </td>
                  </tr>
                )}
                {!logsLoading && logsData?.map((log) => (
                  <tr key={log.id} className="border-b border-border-subtle last:border-0 hover:bg-layer-hover">
                    <td className="px-3 py-2.5 font-mono text-text-primary">{log.command}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`font-mono text-[11px] uppercase ${
                          log.status === 'success'
                            ? 'text-support-success'
                            : log.status === 'error'
                            ? 'text-support-error'
                            : 'text-text-helper'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-text-helper">
                      {new Date(log.started_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!logsLoading && (!logsData || logsData.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-text-helper">
                      No terminal sessions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
