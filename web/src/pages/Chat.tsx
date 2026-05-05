import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  ChevronRight,
} from 'lucide-react'

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>()
  const navigate = useNavigate()
  const [showTerminal, setShowTerminal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedModel, setSelectedModel] = useState('meta/llama-3.1-8b-instruct')
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [chatId])

  const activeChatId = chatId || null

  return (
    <div className="flex h-screen bg-[#0f0f0f]">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-[#2a2a2a] bg-[#0f0f0f]"
          >
            {/* Logo */}
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <span className="text-sm font-bold tracking-tight text-white">Carbon AI</span>
                  <p className="text-[10px] text-[#525252]">Personal AI Assistant</p>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-4">
              <Sidebar activeChatId={activeChatId} selectedModel={selectedModel} />
            </div>

            {/* Footer */}
            <div className="border-t border-[#2a2a2a] p-4">
              {/* Model Selector */}
              <div className="mb-3">
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#525252]">
                  Model
                </label>
                <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
              </div>

              {/* User + Actions */}
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#0f62fe]/20 to-[#78a9ff]/10">
                  <span className="text-xs font-bold text-[#0f62fe]">
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{user?.email || 'User'}</p>
                  <p className="text-[10px] text-[#525252]">{user?.role || 'user'}</p>
                </div>
              </div>

              <div className="space-y-0.5">
                <SidebarButton
                  icon={<TerminalIcon className="h-4 w-4" />}
                  label={showTerminal ? 'Hide Terminal' : 'Open Terminal'}
                  onClick={() => setShowTerminal(!showTerminal)}
                  active={showTerminal}
                />
                <SidebarButton
                  icon={<Settings className="h-4 w-4" />}
                  label="Settings"
                  onClick={() => navigate('/settings')}
                />
                {isAdmin && (
                  <SidebarButton
                    icon={<Shield className="h-4 w-4" />}
                    label="Admin"
                    onClick={() => navigate('/admin')}
                  />
                )}
                <SidebarButton
                  icon={<LogOut className="h-4 w-4" />}
                  label="Sign out"
                  onClick={logout}
                  danger
                />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Collapsed sidebar toggle */}
      {!sidebarOpen && (
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => setSidebarOpen(true)}
          className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-[#525252] shadow-lg transition-colors hover:text-white"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </motion.button>
      )}

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {chatId ? (
          <ChatInterface chatId={chatId} selectedModel={selectedModel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#525252]">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-[#0f62fe]/20 to-[#78a9ff]/10 shadow-2xl shadow-[#0f62fe]/10">
                <MessageSquare className="h-12 w-12 text-[#0f62fe]" />
              </div>
              <h2 className="mb-3 text-3xl font-bold text-white">Start a Conversation</h2>
              <p className="mb-8 max-w-sm text-sm text-[#525252]">
                Select an existing chat from the sidebar or create a new one to begin chatting with AI.
              </p>
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#0f62fe]/20 transition-all hover:shadow-xl hover:shadow-[#0f62fe]/30"
              >
                Open Sidebar
                <ChevronRight className="h-4 w-4" />
              </button>
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
              className="overflow-hidden border-t border-[#2a2a2a]"
            >
              <Terminal />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

function SidebarButton({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs transition-all ${
        danger
          ? 'text-[#da1e28] hover:bg-[#da1e28]/10'
          : active
            ? 'bg-[#0f62fe]/10 text-[#0f62fe]'
            : 'text-[#525252] hover:bg-[#2a2a2a] hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
