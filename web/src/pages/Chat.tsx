import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import Sidebar from '../components/Sidebar'
import ChatInterface from '../components/ChatInterface'
import Terminal from '../components/Terminal'
import WorkspacePanel from '../components/chat/WorkspacePanel'
import ArtifactViewer from '../components/chat/ArtifactViewer'
import ThemeLogo from '../components/ThemeLogo'
import {
  Settings,
  Terminal as TerminalIcon,
  Folder as FolderIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { SelectedModel } from '../components/ProviderModelSelector'

interface ProviderModels {
  provider_id: string
  provider_name: string
  models: Array<{ id: string }>
}

const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 240

const MIN_WORKSPACE_WIDTH = 360
const MAX_WORKSPACE_WIDTH = 600
const DEFAULT_WORKSPACE_WIDTH = 400

const MIN_TERMINAL_HEIGHT = 300
const MAX_TERMINAL_HEIGHT = 800
const DEFAULT_TERMINAL_HEIGHT = 500

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>()
  const navigate = useNavigate()
  const [showTerminal, setShowTerminal] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth')
    return saved
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parseInt(saved, 10)))
      : DEFAULT_SIDEBAR_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem('terminalHeight')
    return saved ? Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, parseInt(saved, 10))) : DEFAULT_TERMINAL_HEIGHT
  })
  const [isResizingTerminal, setIsResizingTerminal] = useState(false)
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false)
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    const saved = localStorage.getItem('workspaceWidth')
    return saved ? Math.min(MAX_WORKSPACE_WIDTH, Math.max(MIN_WORKSPACE_WIDTH, parseInt(saved, 10))) : DEFAULT_WORKSPACE_WIDTH
  })
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const [selectedModel, setSelectedModel] = useState<SelectedModel>(() => {
    const saved = localStorage.getItem('selectedModel')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.providerId && parsed.modelId) {
          return {
            providerId: parsed.providerId,
            providerName: parsed.providerName,
            modelId: parsed.modelId,
          }
        }
      } catch {
        // ignore corrupt saved value
      }
    }
    return { providerId: '', modelId: '' }
  })

  // Persist selected model globally across refreshes and chats.
  useEffect(() => {
    if (selectedModel.providerId && selectedModel.modelId) {
      localStorage.setItem('selectedModel', JSON.stringify(selectedModel))
    }
  }, [selectedModel])
  const user = useAuthStore((s) => s.user)

  // Watch provider list and keep selected model valid.
  // Auto-select first available model when none was saved, and reset when
  // the current provider/model is removed.
  const { data: providersData } = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await api.get('/models')
      return (res.data?.providers || []) as ProviderModels[]
    },
  })

  useEffect(() => {
    if (!providersData) return

    const providers = providersData
    const firstAvailable = providers.find(
      (p) => p.models && p.models.length > 0 && p.models[0]?.id
    )

    // No providers left: reset to empty state (shows 'No provider').
    if (!firstAvailable) {
      if (selectedModel.providerId) {
        setSelectedModel({ providerId: '', modelId: '' })
      }
      return
    }

    // If a model is already selected, only change it when its provider/model
    // is no longer available.
    if (selectedModel.providerId) {
      const providerStillAvailable = providers.some(
        (p) => p.provider_id === selectedModel.providerId && p.models.some((m) => m.id === selectedModel.modelId)
      )
      if (providerStillAvailable) return
    }

    setSelectedModel({
      providerId: firstAvailable.provider_id,
      providerName: firstAvailable.provider_name,
      modelId: firstAvailable.models[0].id,
    })
  }, [providersData])

  const handleModelChange = useCallback(async (sel: SelectedModel) => {
    if (sel.providerId === selectedModel.providerId && sel.modelId === selectedModel.modelId) return
    setSelectedModel(sel)
    if (chatId) {
      try {
        await api.patch(`/chats/${chatId}`, { model_id: sel.modelId, provider_id: sel.providerId })
      } catch (e) {
        console.error('Failed to update chat model:', e)
      }
    }
  }, [chatId, selectedModel])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [chatId])

  // Keyboard shortcut: Ctrl+` to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        setShowTerminal((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

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
      localStorage.setItem('sidebarWidth', String(newWidth))
    },
    [isResizing]
  )

  const startResizeTerminal = useCallback(() => setIsResizingTerminal(true), [])
  const stopResizeTerminal = useCallback(() => setIsResizingTerminal(false), [])

  const resizeTerminal = useCallback(
    (e: MouseEvent) => {
      if (!isResizingTerminal || !mainRef.current) return
      const rect = mainRef.current.getBoundingClientRect()
      const newHeight = Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.min(MAX_TERMINAL_HEIGHT, rect.bottom - e.clientY)
      )
      setTerminalHeight(newHeight)
      setIsTerminalMaximized(false)
      localStorage.setItem('terminalHeight', String(newHeight))
    },
    [isResizingTerminal]
  )

  const startResizeWorkspace = useCallback(() => setIsResizingWorkspace(true), [])
  const stopResizeWorkspace = useCallback(() => setIsResizingWorkspace(false), [])

  const resizeWorkspace = useCallback(
    (e: MouseEvent) => {
      if (!isResizingWorkspace) return
      const newWidth = Math.max(
        MIN_WORKSPACE_WIDTH,
        Math.min(MAX_WORKSPACE_WIDTH, window.innerWidth - e.clientX)
      )
      setWorkspaceWidth(newWidth)
      localStorage.setItem('workspaceWidth', String(newWidth))
    },
    [isResizingWorkspace]
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

  useEffect(() => {
    if (isResizingTerminal) {
      document.addEventListener('mousemove', resizeTerminal)
      document.addEventListener('mouseup', stopResizeTerminal)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', resizeTerminal)
      document.removeEventListener('mouseup', stopResizeTerminal)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.removeEventListener('mousemove', resizeTerminal)
      document.removeEventListener('mouseup', stopResizeTerminal)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingTerminal, resizeTerminal, stopResizeTerminal])

  useEffect(() => {
    if (isResizingWorkspace) {
      document.addEventListener('mousemove', resizeWorkspace)
      document.addEventListener('mouseup', stopResizeWorkspace)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', resizeWorkspace)
      document.removeEventListener('mouseup', stopResizeWorkspace)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.removeEventListener('mousemove', resizeWorkspace)
      document.removeEventListener('mouseup', stopResizeWorkspace)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingWorkspace, resizeWorkspace, stopResizeWorkspace])

  return (
    <div className="relative flex h-screen bg-background">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-layer"
            style={{ width: sidebarWidth }}
          >
            {/* Logo */}
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={() => navigate('/chat')}
                className="flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-80"
              >
                <ThemeLogo className="h-10 w-10 drop-shadow-sm" alt="" />
                <div>
                  <span className="text-sm font-semibold text-text-primary">Project Vulcan</span>
                  <p className="text-[10px] text-text-secondary">Personal AI Assistant</p>
                </div>
              </button>
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
              <div className="mb-2 flex items-center gap-2 rounded-carbon border border-border-subtle bg-layer/50 px-3 py-2 shadow-sm transition-colors hover:bg-layer/80">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-vibrant-gradient text-on-interactive shadow-inner">
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
          className="absolute left-3 top-3 z-50 flex items-center gap-2 rounded-carbon border border-border-subtle bg-layer px-3 py-2 text-text-primary shadow-lg transition-all hover:bg-layer-hover hover:text-text-primary"
          title="Show sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="text-xs font-medium">Chats</span>
        </button>
      )}

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        <div ref={mainRef} className="flex flex-1 flex-col overflow-hidden">
          <ChatInterface
            chatId={chatId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            sidebarOpen={sidebarOpen}
          />

          {/* Terminal panel — always mounted so shell sessions survive hide/show. */}
          {/* Terminal resize handle */}
          <div
            onMouseDown={startResizeTerminal}
            className={`relative z-20 h-1 shrink-0 cursor-row-resize transition-colors ${
              isResizingTerminal ? 'bg-interactive' : 'bg-transparent hover:bg-border-strong'
            } ${showTerminal ? '' : 'hidden'}`}
          />
          <motion.div
            initial={false}
            animate={{
              height: showTerminal
                ? isTerminalMaximized
                  ? MAX_TERMINAL_HEIGHT
                  : terminalHeight
                : 0,
              opacity: showTerminal ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            className={`overflow-hidden border-t border-border-subtle ${showTerminal ? '' : 'pointer-events-none'}`}
            style={{ height: showTerminal ? (isTerminalMaximized ? MAX_TERMINAL_HEIGHT : terminalHeight) : 0 }}
            aria-hidden={!showTerminal}
          >
            <Terminal
              isMaximized={isTerminalMaximized}
              onToggleMaximize={() => {
                setIsTerminalMaximized(!isTerminalMaximized)
                if (!isTerminalMaximized) {
                  setTerminalHeight(MAX_TERMINAL_HEIGHT)
                } else {
                  setTerminalHeight(DEFAULT_TERMINAL_HEIGHT)
                }
              }}
            />
          </motion.div>
        </div>

        {/* Workspace resize handle */}
        {showWorkspace && !isMobile && (
          <div
            onMouseDown={startResizeWorkspace}
            className={`relative z-20 w-1 shrink-0 cursor-col-resize transition-colors ${
              isResizingWorkspace ? 'bg-interactive' : 'bg-transparent hover:bg-border-strong'
            }`}
          />
        )}

        <AnimatePresence>
          {showWorkspace && (
            <WorkspacePanel
              onClose={() => setShowWorkspace(false)}
              isMobile={isMobile}
              width={workspaceWidth}
            />
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
