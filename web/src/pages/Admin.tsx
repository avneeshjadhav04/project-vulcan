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
    <div className="flex min-h-screen flex-col bg-[#0f0f0f]">
      <header className="flex items-center gap-4 border-b border-[#2a2a2a] px-6 py-4">
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-2 text-sm text-[#c6c6c6] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-lg font-medium text-white">Admin Dashboard</h1>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-6">
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-white">
            <Users className="h-5 w-5 text-[#0f62fe]" />
            Users
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#2a2a2a] bg-[#0f0f0f]">
                <tr>
                  <th className="px-4 py-3 font-medium text-[#525252]">Email</th>
                  <th className="px-4 py-3 font-medium text-[#525252]">Role</th>
                  <th className="px-4 py-3 font-medium text-[#525252]">Created</th>
                  <th className="px-4 py-3 font-medium text-[#525252]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[#525252]">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                )}
                {!usersLoading && usersData?.map((u) => (
                  <tr key={u.id} className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#1a1a1a]/80">
                    <td className="px-4 py-3 text-white">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs uppercase text-[#0f62fe]">{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-[#525252]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(u.id)}
                        aria-label="Delete user"
                        className="text-[#da1e28] transition-colors hover:text-[#da1e28]/80"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!usersLoading && (!usersData || usersData.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[#525252]">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-white">
            <Activity className="h-5 w-5 text-[#0f62fe]" />
            Terminal Logs
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#2a2a2a] bg-[#0f0f0f]">
                <tr>
                  <th className="px-4 py-3 font-medium text-[#525252]">Command</th>
                  <th className="px-4 py-3 font-medium text-[#525252]">Status</th>
                  <th className="px-4 py-3 font-medium text-[#525252]">Started</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[#525252]">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                )}
                {!logsLoading && logsData?.map((log) => (
                  <tr key={log.id} className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#1a1a1a]/80">
                    <td className="px-4 py-3 font-mono text-white">{log.command}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-mono text-xs uppercase ${
                          log.status === 'success'
                            ? 'text-[#24a148]'
                            : log.status === 'error'
                            ? 'text-[#da1e28]'
                            : 'text-[#525252]'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#525252]">
                      {new Date(log.started_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!logsLoading && (!logsData || logsData.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[#525252]">
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
