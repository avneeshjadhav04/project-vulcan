import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ArrowLeft, Trash2, Users, Activity, Loader2 } from 'lucide-react'

interface SafeUser {
  id: string
  email: string
  role: string
  created_at: string
}

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

  const { data: usersData, refetch: refetchUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get('/admin/users')
      return res.data.users as SafeUser[]
    },
  })

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: async () => {
      const res = await api.get('/admin/terminal-logs')
      return res.data as TerminalLog[]
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await api.delete(`/admin/users/${id}`)
      refetchUsers()
    } catch {
      alert('Failed to delete user')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-4 border-b border-border px-6 py-4">
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-lg font-medium text-text-primary">Admin Dashboard</h1>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-6">
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-text-primary">
            <Users className="h-5 w-5 text-accent" />
            Users
          </h2>
          <div className="overflow-x-auto border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-background">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Email</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Role</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Created</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                )}
                {!usersLoading && usersData?.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3 text-text-primary">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs uppercase text-accent">{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(u.id)}
                        aria-label="Delete user"
                        className="text-error transition-colors hover:text-error/80"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!usersLoading && (!usersData || usersData.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-text-primary">
            <Activity className="h-5 w-5 text-accent" />
            Terminal Logs
          </h2>
          <div className="overflow-x-auto border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-background">
                <tr>
                  <th className="px-4 py-3 font-medium text-text-secondary">Command</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3 font-medium text-text-secondary">Started</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-secondary">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                )}
                {!logsLoading && logsData?.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3 font-mono text-text-primary">{log.command}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-mono text-xs uppercase ${
                          log.status === 'success'
                            ? 'text-success'
                            : log.status === 'error'
                            ? 'text-error'
                            : 'text-text-secondary'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(log.started_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!logsLoading && (!logsData || logsData.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-secondary">
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
