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
const DEFAULT_SIDEBAR_WIDTH = 280

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
    <div className="flex h-screen bg-background">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-background"
            style={{ width: sidebarWidth }}
          >
            {/* Logo */}
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-interactive" />
                <div>
                  <span className="text-xs font-semibold text-text-primary">Project Vulcan</span>
                  <p className="text-[10px] text-text-helper">Personal AI Assistant</p>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 text-text-disabled transition-colors hover:text-text-primary"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-3">
              <Sidebar activeChatId={activeChatId} selectedModel={selectedModel} />
            </div>

            {/* Footer */}
            <div className="border-t border-border-subtle p-3">
              <div className="mb-2 flex items-center gap-2 border border-border-subtle bg-layer px-3 py-2">
                <div className="flex h-6 w-6 items-center justify-center bg-layer-active">
                  <span className="text-[10px] font-semibold text-interactive">
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-text-primary">{user?.email || 'User'}</p>
                  <p className="text-[10px] text-text-helper">{user?.role || 'user'}</p>
                </div>
              </div>

              <div className="space-y-px">
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
          className={`relative z-20 w-px shrink-0 cursor-col-resize transition-colors ${
            isResizing ? 'bg-interactive' : 'bg-transparent hover:bg-border-strong'
          }`}
        />
      )}

      {/* Collapsed sidebar toggle */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-3 top-3 z-10 flex items-center gap-2 border border-border-subtle bg-layer px-3 py-2 text-text-disabled transition-colors hover:text-text-primary"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
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
              animate={{ height: 300, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-border-subtle"
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
      className={`flex w-full items-center gap-3 px-3 py-2 text-xs transition-colors ${
        danger
          ? 'text-support-error hover:bg-support-error/10'
          : active
            ? 'bg-interactive/10 text-interactive'
            : 'text-text-disabled hover:bg-layer-hover hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
