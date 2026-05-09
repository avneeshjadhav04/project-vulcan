import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import Sidebar from '../components/Sidebar'
import ChatInterface from '../components/ChatInterface'
import Terminal from '../components/Terminal'
import {
  Settings,
  Shield,
  LogOut,
  Terminal as TerminalIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react'

const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 300

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>()
  const navigate = useNavigate()
  const [showTerminal, setShowTerminal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [selectedModel, setSelectedModel] = useState('meta/llama-3.1-8b-instruct')
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [chatId])

  const activeChatId = chatId || null

  // Resize handlers
  const startResize = useCallback(() => setIsResizing(true), [])
  const stopResize = useCallback(() => setIsResizing(false), [])

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX))
      setSidebarWidth(newWidth)
    },
    [isResizing]
  )

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', resize)
      document.addEventListener('mouseup', stopResize)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', resize)
      document.removeEventListener('mouseup', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.removeEventListener('mousemove', resize)
      document.removeEventListener('mouseup', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, resize, stopResize])

  return (
    <div className="flex h-screen bg-[#0f0f0f]">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-[#2a2a2a] bg-[#0f0f0f]"
            style={{ width: sidebarWidth }}
          >
            {/* Logo */}
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <span className="text-sm font-bold tracking-tight text-white">Project Vulcan</span>
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

      {/* Resize handle */}
      {sidebarOpen && (
        <div
          onMouseDown={startResize}
          className={`relative z-20 w-1 shrink-0 cursor-col-resize transition-colors ${
            isResizing ? 'bg-[#0f62fe]' : 'bg-transparent hover:bg-[#0f62fe]/30'
          }`}
          style={{ marginLeft: -1 }}
        />
      )}

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
        <ChatInterface
          chatId={chatId}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />

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
