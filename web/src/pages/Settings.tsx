import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { ArrowLeft, Key, Save, Check, Shield } from 'lucide-react'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setLoading(true)
    try {
      await api.post('/me/key', { api_key: apiKey })
      setSaved(true)
      setApiKey('')
      setTimeout(() => setSaved(false), 3000)
    } catch {
      alert('Failed to save API key')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-4 border-b border-border px-6 py-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-lg font-medium text-text-primary">Settings</h1>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <div className="mb-8 border border-border bg-surface p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-text-primary">
            <Shield className="h-5 w-5 text-accent" />
            Account
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border pb-3">
              <span className="text-text-secondary">Email</span>
              <span className="text-text-primary">{user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Role</span>
              <span className="font-mono text-xs uppercase text-accent">{user?.role}</span>
            </div>
          </div>
        </div>

        <div className="border border-border bg-surface p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-text-primary">
            <Key className="h-5 w-5 text-accent" />
            AI Provider Key
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Bring your own NVIDIA NIM API key. It is encrypted at rest and only decrypted in-memory during requests.
          </p>

          <div className="flex gap-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="nvapi-..."
              className="flex-1 border border-border bg-background px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
            />
            <button
              onClick={handleSave}
              disabled={loading || !apiKey.trim()}
              className="flex items-center gap-2 border border-transparent bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saved ? (
                <>
                  <Check className="h-4 w-4" /> Saved
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
