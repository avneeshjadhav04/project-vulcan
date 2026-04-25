import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import Sidebar from '../components/Sidebar'
import ChatInterface from '../components/ChatInterface'
import Terminal from '../components/Terminal'
import ModelSelector from '../components/ModelSelector'
import { Settings, Shield, LogOut, Terminal as TerminalIcon, MessageSquare } from 'lucide-react'

export default function Chat() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [selectedModel, setSelectedModel] = useState('nvidia/llama-3.1-nemotron-70b')
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-64 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          <MessageSquare className="h-6 w-6 text-accent" />
          <span className="text-lg font-semibold tracking-tight text-text-primary">Carbon AI</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <Sidebar activeChatId={activeChatId} onSelect={setActiveChatId} selectedModel={selectedModel} />
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-3">
            <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <TerminalIcon className="h-4 w-4" />
              {showTerminal ? 'Hide Terminal' : 'Open Terminal'}
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                <Shield className="h-4 w-4" />
                Admin
              </button>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-error transition-colors hover:bg-surface-hover"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {activeChatId ? (
          <ChatInterface chatId={activeChatId} selectedModel={selectedModel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-text-secondary">
            <MessageSquare className="mb-4 h-16 w-16 opacity-20" />
            <p className="text-lg font-medium">Select or start a new chat</p>
          </div>
        )}

        {showTerminal && (
          <div className="h-80 border-t border-border">
            <Terminal />
          </div>
        )}
      </main>
    </div>
  )
}
