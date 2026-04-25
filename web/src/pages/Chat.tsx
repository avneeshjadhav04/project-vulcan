import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import Sidebar from '../components/Sidebar'
import ChatInterface from '../components/ChatInterface'
import Terminal from '../components/Terminal'
import ModelSelector from '../components/ModelSelector'
import {
  Settings,
  Shield,
  LogOut,
  Terminal as TerminalIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react'

export default function Chat() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedModel, setSelectedModel] = useState('nvidia/llama-3.1-nemotron-70b')
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-background">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface/80"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-accent">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold tracking-tight text-text-primary">Carbon AI</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <Sidebar activeChatId={activeChatId} onSelect={setActiveChatId} selectedModel={selectedModel} />
            </div>

            <div className="border-t border-border p-3">
              <div className="mb-3">
                <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => setShowTerminal(!showTerminal)}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  <TerminalIcon className="h-3.5 w-3.5" />
                  {showTerminal ? 'Hide Terminal' : 'Open Terminal'}
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
                {isAdmin && (
                  <button
                    onClick={() => navigate('/admin')}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Admin
                  </button>
                )}
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-error transition-colors hover:bg-error/10"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-4 top-4 z-10 rounded border border-border bg-surface/90 p-2 text-text-secondary shadow-lg backdrop-blur transition-colors hover:text-text-primary"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <main className="flex flex-1 flex-col overflow-hidden">
        {activeChatId ? (
          <ChatInterface chatId={activeChatId} selectedModel={selectedModel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-text-secondary">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <MessageSquare className="h-8 w-8 text-accent/60" />
              </div>
              <h2 className="mb-2 text-xl font-semibold text-text-primary">Start a Conversation</h2>
              <p className="max-w-sm text-sm text-text-secondary">
                Select an existing chat from the sidebar or create a new one to begin.
              </p>
            </motion.div>
          </div>
        )}

        <AnimatePresence>
          {showTerminal && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 320, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden border-t border-border"
            >
              <Terminal />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
