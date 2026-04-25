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
} from 'lucide-react'

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>()
  const navigate = useNavigate()
  const [showTerminal, setShowTerminal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedModel, setSelectedModel] = useState('nvidia/llama-3.1-nemotron-70b')
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)

  // Scroll to top on chat change
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
            className="flex shrink-0 flex-col overflow-hidden border-r border-[#2a2a2a] bg-[#1a1a1a]"
          >
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f62fe]">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-bold tracking-tight text-white">Carbon AI</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <Sidebar activeChatId={activeChatId} selectedModel={selectedModel} />
            </div>

            <div className="border-t border-[#2a2a2a] p-4">
              <div className="mb-3">
                <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setShowTerminal(!showTerminal)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                >
                  <TerminalIcon className="h-4 w-4" />
                  {showTerminal ? 'Hide Terminal' : 'Open Terminal'}
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                {isAdmin && (
                  <button
                    onClick={() => navigate('/admin')}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-white"
                  >
                    <Shield className="h-4 w-4" />
                    Admin
                  </button>
                )}
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-[#da1e28] transition-colors hover:bg-[#da1e28]/10"
                >
                  <LogOut className="h-4 w-4" />
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
          className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-[#525252] shadow-lg transition-colors hover:text-white"
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="text-xs font-medium">Menu</span>
        </button>
      )}

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
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#2a2a2a]">
                <MessageSquare className="h-10 w-10 text-[#525252]" />
              </div>
              <h2 className="mb-3 text-2xl font-bold text-white">Start a Conversation</h2>
              <p className="max-w-sm text-sm text-[#525252]">
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
