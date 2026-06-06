import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import Sidebar from '../components/Sidebar'
import ChatInterface from '../components/ChatInterface'
import Terminal from '../components/Terminal'
import WorkspacePanel from '../components/chat/WorkspacePanel'
import ArtifactViewer from '../components/chat/ArtifactViewer'
import {
  Settings,
  LogOut,
  Terminal as TerminalIcon,
  Folder as FolderIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { SelectedModel } from '../components/ProviderModelSelector'

const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 280

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>()
  const navigate = useNavigate()
  const [showTerminal, setShowTerminal] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [selectedModel, setSelectedModel] = useState<SelectedModel>({
    providerId: '',
    modelId: 'meta/llama-3.1-8b-instruct',
  })
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)

  // Auto-select first available model when providers load
  useEffect(() => {
    if (selectedModel.providerId) return
    api.get('/models')
      .then((res) => {
        const providers = res.data?.providers || []
        for (const p of providers) {
          if (p.models && Array.isArray(p.models) && p.models.length > 0 && p.models[0]?.id) {
            setSelectedModel({ providerId: p.provider_id, modelId: p.models[0].id })
            break
          }
        }
      })
      .catch(() => {})
  }, [selectedModel.providerId])

  const handleModelChange = useCallback(async (sel: SelectedModel) => {
    setSelectedModel(sel)
    if (chatId) {
      try {
        await api.patch(`/chats/${chatId}`, { model_id: sel.modelId, provider_id: sel.providerId })
      } catch (e) {
        console.error('Failed to update chat model:', e)
      }
    }
  }, [chatId])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [chatId])

  // Mobile detection and auto-collapse sidebar
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (mobile && sidebarOpen) {
        setSidebarOpen(false)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [sidebarOpen])

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
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-white/5 bg-layer/30 backdrop-blur-md"
            style={{ width: sidebarWidth }}
          >
            {/* Logo */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <img src="/VulcanLogo.png" alt="" className="h-10 w-10 drop-shadow-sm" />
                <div>
                  <span className="text-sm font-semibold text-text-primary">Project Vulcan</span>
                  <p className="text-[10px] text-text-secondary">Personal AI Assistant</p>
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
            <div className="border-t border-white/5 p-3">
              <div className="mb-2 flex items-center gap-2 rounded-carbon border border-white/5 bg-layer/50 px-3 py-2 shadow-sm transition-colors hover:bg-layer/80">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-vibrant-gradient text-white shadow-inner">
                  <span className="text-[11px] font-bold">
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
                  icon={<FolderIcon className="h-4 w-4" />}
                  label={showWorkspace ? 'Hide Workspace' : 'Workspace Files'}
                  onClick={() => setShowWorkspace(!showWorkspace)}
                  active={showWorkspace}
                />
                <SidebarButton
                  icon={<Settings className="h-4 w-4" />}
                  label="Settings"
                  onClick={() => navigate('/settings')}
                />

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
          className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-carbon border border-white/10 bg-layer/60 px-3 py-2 text-text-secondary backdrop-blur-md transition-all hover:bg-layer/80 hover:text-text-primary shadow-sm"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatInterface
            chatId={chatId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
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
        </div>

        <AnimatePresence>
          {showWorkspace && (
            <WorkspacePanel onClose={() => setShowWorkspace(false)} isMobile={isMobile} />
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        <ArtifactViewer />
      </AnimatePresence>
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
      className={`flex w-full items-center gap-3 rounded-carbon px-3 py-2.5 text-xs font-medium transition-all ${
        danger
          ? 'text-support-error hover:bg-support-error/10'
          : active
            ? 'bg-interactive/10 text-interactive shadow-inner'
            : 'text-text-secondary hover:bg-layer/60 hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
