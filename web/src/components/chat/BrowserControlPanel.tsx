import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Wifi,
  WifiOff,
  Loader2,
  MousePointerClick,
  Square,
  Plus,
} from 'lucide-react'
import { BrowserClient } from '../../lib/browserClient'
import { api } from '../../lib/api'

let RFBConstructor: any = null

async function loadRFB(): Promise<any> {
  if (RFBConstructor) return RFBConstructor
  const mod = await import('@novnc/novnc')
  RFBConstructor = mod.default
  return RFBConstructor
}

interface BrowserSessionInfo {
  session_id: string
  chat_id?: string | null
  vnc_port: number
  current_url: string
  title: string
  ai_active: boolean
}

interface SessionState {
  connected: boolean
  connecting: boolean
  aiActive: boolean
  aiAction: string
  currentUrl: string
  title: string
  sessionClosed: boolean
  stopping: boolean
  chatId?: string | null
}

function defaultSessionState(): SessionState {
  return {
    connected: false,
    connecting: false,
    aiActive: false,
    aiAction: '',
    currentUrl: '',
    title: '',
    sessionClosed: false,
    stopping: false,
  }
}

export default function BrowserControlPanel({
  onClose,
  width,
}: {
  onClose: () => void
  width: number
  chatId?: string
}) {
  const queryClient = useQueryClient()
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({})
  const [creating, setCreating] = useState(false)
  const [vncConnected, setVncConnected] = useState(false)
  const [vncConnecting, setVncConnecting] = useState(false)

  const vncContainerRef = useRef<HTMLDivElement | null>(null)
  const rfbRef = useRef<any | null>(null)
  const browserClientRefs = useRef<Record<string, BrowserClient | null>>({})
  const mountedRef = useRef(true)
  const vncConnectedRef = useRef(false)

  const { data: sessions } = useQuery<BrowserSessionInfo[]>({
    queryKey: ['browser-sessions'],
    queryFn: async () => {
      const res = await api.get('/browser/sessions')
      return res.data || []
    },
    refetchInterval: 2000,
  })

  const sessionList = sessions || []
  const hasSessions = sessionList.length > 0

  const updateSessionState = useCallback((sessionId: string, updates: Partial<SessionState>) => {
    if (!mountedRef.current) return
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || defaultSessionState()), ...updates },
    }))
  }, [])

  const invalidateSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['browser-sessions'] })
  }, [queryClient])

  // Start the browser (Chrome + first tab).
  const handleOpenBrowser = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      await api.post('/browser/session', {})
      invalidateSessions()
    } catch (e) {
      console.error('Failed to start browser:', e)
    } finally {
      setCreating(false)
    }
  }, [creating, invalidateSessions])

  // Connect noVNC to the shared VNC stream via the first session's ID.
  // The VNC port is shared (always 5901), so any session ID works.
  const connectVnc = useCallback(async (sessionId: string) => {
    if (rfbRef.current || vncConnectedRef.current) return
    const container = vncContainerRef.current
    if (!container) return

    setVncConnecting(true)

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/api/browser/vnc/${sessionId}`

    try {
      const RFB = await loadRFB()
      if (!mountedRef.current) return

      const rfb = new RFB(container, wsUrl, {
        shared: true,
        credentials: { password: '' },
      })

      rfb.addEventListener('connect', () => {
        if (!mountedRef.current) return
        vncConnectedRef.current = true
        setVncConnected(true)
        setVncConnecting(false)

        // Send initial resize so Chrome's window matches the container
        // immediately on connect (ResizeObserver only fires on changes).
        const container = vncContainerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            Object.values(browserClientRefs.current).forEach((c) => {
              c?.resize(Math.round(rect.width), Math.round(rect.height))
            })
          }
        }
      })

      rfb.addEventListener('disconnect', () => {
        if (!mountedRef.current) return
        vncConnectedRef.current = false
        setVncConnected(false)
        rfbRef.current = null
      })

      rfbRef.current = rfb
    } catch (e) {
      console.error('noVNC connection failed:', e)
      setVncConnecting(false)
    }
  }, [])

  const disconnectVnc = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.disconnect()
      rfbRef.current = null
    }
    vncConnectedRef.current = false
    setVncConnected(false)
  }, [])

  // Initialize BrowserClient for each session + connect VNC once.
  useEffect(() => {
    mountedRef.current = true
    const activeSessionIds = new Set(sessionList.map((s) => s.session_id))

    // Connect BrowserClient for new sessions
    for (const session of sessionList) {
      const sid = session.session_id
      if (browserClientRefs.current[sid] || !sid) continue

      updateSessionState(sid, {
        connecting: true,
        aiActive: session.ai_active,
        currentUrl: session.current_url,
        title: session.title,
        chatId: session.chat_id ?? null,
      })

      const client = new BrowserClient({
        sessionId: sid,
        onStatusChange: () => {},
        onAiActive: (active, action) => {
          updateSessionState(sid, { aiActive: active, aiAction: action, stopping: false })
        },
        onUrlChanged: (url) => {
          updateSessionState(sid, { currentUrl: url })
        },
        onTitleChanged: (title) => {
          updateSessionState(sid, { title })
        },
        onSessionReady: () => {},
        onChatAssociated: (chatId) => {
          updateSessionState(sid, { chatId: chatId || null })
        },
        onSessionClosed: () => {
          updateSessionState(sid, { sessionClosed: true })
        },
      })

      browserClientRefs.current[sid] = client
      client.connect()
    }

    // Connect VNC once Chrome is running (use first available session).
    if (sessionList.length > 0 && !rfbRef.current && !vncConnectedRef.current) {
      connectVnc(sessionList[0].session_id)
    }

    // Cleanup sessions that disappeared from the API
    for (const sid of Object.keys(browserClientRefs.current)) {
      if (!activeSessionIds.has(sid)) {
        browserClientRefs.current[sid]?.disconnect()
        delete browserClientRefs.current[sid]
        setSessionStates((prev) => {
          const { [sid]: _, ...rest } = prev
          return rest
        })
      }
    }

    // Disconnect VNC when all sessions are gone
    if (sessionList.length === 0 && rfbRef.current) {
      disconnectVnc()
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionList, updateSessionState, connectVnc, disconnectVnc])

  // Keep sessionState in sync with the REST list
  useEffect(() => {
    for (const session of sessionList) {
      const sid = session.session_id
      const existing = sessionStates[sid]
      if (existing && (existing.chatId ?? null) !== (session.chat_id ?? null)) {
        updateSessionState(sid, { chatId: session.chat_id ?? null })
      }
      // Sync ai_active from polling as a fallback
      if (existing && existing.aiActive !== session.ai_active) {
        updateSessionState(sid, { aiActive: session.ai_active })
      }
    }
  }, [sessionList, sessionStates, updateSessionState])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(browserClientRefs.current).forEach((c) => c?.disconnect())
      disconnectVnc()
      browserClientRefs.current = {}
    }
  }, [disconnectVnc])

  // Handle VNC viewport — dynamic resize via Xvnc, no scaling needed
  useEffect(() => {
    if (rfbRef.current && vncContainerRef.current) {
      rfbRef.current.scaleViewport = false
      rfbRef.current.resizeSession = true
    }
  }, [width])

  // Resize Chrome's window to match the container when it changes size.
  // Xvnc resizes its framebuffer via noVNC's SetDesktopSize, but Chrome's
  // window stays at its original size — we need to explicitly resize it.
  useEffect(() => {
    const container = vncContainerRef.current
    if (!container || !hasSessions) return
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      Object.values(browserClientRefs.current).forEach((c) => {
        c?.resize(Math.round(rect.width), Math.round(rect.height))
      })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [hasSessions])

  const handleStopAi = useCallback(async (sessionId: string, chatId: string | null | undefined) => {
    if (!chatId) return
    updateSessionState(sessionId, { stopping: true })
    try {
      await api.delete(`/chats/${chatId}/stream`)
    } catch {
      // Stream may have already finished
    }
  }, [updateSessionState])

  // Find the first AI-active session for the overlay.
  const aiActiveSession = sessionList.find((s) => {
    const state = sessionStates[s.session_id]
    return state?.aiActive
  })
  const aiActiveState = aiActiveSession ? sessionStates[aiActiveSession.session_id] : undefined

  return (
    <div className="flex h-full flex-col bg-layer">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-interactive" />
          <span className="text-sm font-semibold text-text-primary">Browser Control</span>
          {/* Connection status badge */}
          {hasSessions && (
            <div className="ml-1 flex items-center gap-1 text-[10px]">
              {vncConnected ? (
                <>
                  <Wifi className="h-2.5 w-2.5 text-support-success" />
                  <span className="text-support-success">Connected</span>
                </>
              ) : vncConnecting ? (
                <>
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-support-warning" />
                  <span className="text-support-warning">Connecting…</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-2.5 w-2.5 text-support-error" />
                  <span className="text-support-error">Offline</span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
          title="Close browser panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!hasSessions ? (
        /* Empty state — Chrome not running */
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <MousePointerClick className="mb-3 h-10 w-10 text-text-disabled" />
          <p className="text-sm font-medium text-text-secondary">No active browser</p>
          <p className="mt-1 text-xs text-text-helper">
            Start a browser session to browse the web. The AI can borrow it later when it needs browser control.
          </p>
          <button
            onClick={handleOpenBrowser}
            disabled={creating}
            className="mt-4 flex items-center gap-1.5 rounded-full bg-interactive px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-interactive-hover disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            Open Browser
          </button>
        </div>
      ) : (
        <>
          {/* noVNC canvas — single container, shows full Chrome with its own tab bar */}
          <div className="relative flex-1 overflow-hidden bg-black/90">
            <div
              ref={(el) => { vncContainerRef.current = el }}
              className="absolute inset-0 z-10"
              style={{ minHeight: 0 }}
            />

            {/* AI active overlay with stop button */}
            {aiActiveState && aiActiveSession && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 pointer-events-auto">
                <div className="rounded-lg bg-layer/90 px-6 py-4 shadow-lg">
                  <div className="flex items-center gap-2 text-text-primary">
                    <Loader2 className="h-4 w-4 animate-spin text-support-warning" />
                    <span className="text-sm font-medium">
                      {aiActiveState.stopping ? 'Stopping...' : `AI is controlling: ${aiActiveState.aiAction}`}
                    </span>
                  </div>
                  {!aiActiveState.stopping && (aiActiveState.chatId ?? aiActiveSession.chat_id) && (
                    <button
                      onClick={() => handleStopAi(aiActiveSession.session_id, aiActiveState.chatId ?? aiActiveSession.chat_id)}
                      className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-support-error px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-support-error/90"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      Stop AI
                    </button>
                  )}
                  {aiActiveState.stopping && (
                    <p className="mt-3 text-center text-xs text-text-helper">
                      AI will stop after current action completes
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}