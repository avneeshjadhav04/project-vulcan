import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Wifi,
  WifiOff,
  Loader2,
  MousePointerClick,
  Square,
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
  chat_id: string
  ws_port: number
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
  wsPort?: number
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
  chatId,
}: {
  onClose: () => void
  width: number
  chatId?: string
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({})

  const vncContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rfbRefs = useRef<Record<string, any | null>>({})
  const browserClientRefs = useRef<Record<string, BrowserClient | null>>({})
  const vncWsPortRefs = useRef<Record<string, number | undefined>>({})
  const mountedRef = useRef(true)

  const { data: sessions } = useQuery<BrowserSessionInfo[]>({
    queryKey: ['browser-sessions'],
    queryFn: async () => {
      const res = await api.get('/browser/sessions')
      return res.data || []
    },
    refetchInterval: 2000,
  })

  const sessionList = sessions || []

  const updateSessionState = useCallback((sessionId: string, updates: Partial<SessionState>) => {
    if (!mountedRef.current) return
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || defaultSessionState()), ...updates },
    }))
  }, [])

  // Auto-select first session when none selected or selected one disappeared
  useEffect(() => {
    if (sessionList.length === 0) {
      setActiveSessionId(null)
      return
    }
    if (!activeSessionId || !sessionList.find((s) => s.session_id === activeSessionId)) {
      // Prefer a session from the current chat, else first
      const fromCurrentChat = sessionList.find((s) => s.chat_id === chatId)
      setActiveSessionId((fromCurrentChat || sessionList[0]).session_id)
    }
  }, [sessionList, activeSessionId, chatId])

  // Connect noVNC to websockify
  const connectVnc = useCallback(async (sessionId: string, wsPort: number) => {
    const container = vncContainerRefs.current[sessionId]
    if (!container || rfbRefs.current[sessionId]) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const wsUrl = `${protocol}//${host}:${wsPort}/websockify`

    try {
      const RFB = await loadRFB()
      const rfb = new RFB(container, wsUrl, {
        shared: true,
        credentials: { password: '' },
      })

      rfb.addEventListener('connect', () => {
        updateSessionState(sessionId, { connected: true, connecting: false })
      })

      rfb.addEventListener('disconnect', () => {
        updateSessionState(sessionId, { connected: false })
        rfbRefs.current[sessionId] = null
      })

      rfbRefs.current[sessionId] = rfb
    } catch (e) {
      console.error('noVNC connection failed:', e)
    }
  }, [updateSessionState])

  const disconnectVnc = useCallback((sessionId: string) => {
    const rfb = rfbRefs.current[sessionId]
    if (rfb) {
      rfb.disconnect()
      rfbRefs.current[sessionId] = null
    }
  }, [])

  // Initialize BrowserClient + noVNC for each active session
  useEffect(() => {
    mountedRef.current = true
    const activeSessionIds = new Set(sessionList.map((s) => s.session_id))

    // Connect new sessions
    for (const session of sessionList) {
      const sid = session.session_id
      if (browserClientRefs.current[sid] || !sid) continue

      // Initialize state from API data
      updateSessionState(sid, {
        connecting: true,
        aiActive: session.ai_active,
        currentUrl: session.current_url,
        title: session.title,
      })

      const client = new BrowserClient({
        sessionId: sid,
        onStatusChange: (connected) => {
          updateSessionState(sid, { connected, connecting: !connected })
        },
        onAiActive: (active, action) => {
          updateSessionState(sid, { aiActive: active, aiAction: action, stopping: false })
        },
        onUrlChanged: (url) => {
          updateSessionState(sid, { currentUrl: url })
        },
        onTitleChanged: (title) => {
          updateSessionState(sid, { title })
        },
        onSessionReady: (wsPort) => {
          vncWsPortRefs.current[sid] = wsPort
          updateSessionState(sid, { wsPort })
          connectVnc(sid, wsPort)
        },
        onSessionClosed: () => {
          updateSessionState(sid, { sessionClosed: true, connected: false })
          disconnectVnc(sid)
        },
      })

      browserClientRefs.current[sid] = client
      client.connect()
    }

    // Cleanup sessions that disappeared from the API
    for (const sid of Object.keys(browserClientRefs.current)) {
      if (!activeSessionIds.has(sid)) {
        browserClientRefs.current[sid]?.disconnect()
        delete browserClientRefs.current[sid]
        disconnectVnc(sid)
        setSessionStates((prev) => {
          const { [sid]: _, ...rest } = prev
          return rest
        })
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionList, updateSessionState, connectVnc, disconnectVnc])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(browserClientRefs.current).forEach((c) => c?.disconnect())
      Object.values(rfbRefs.current).forEach((r) => r?.disconnect())
      browserClientRefs.current = {}
      rfbRefs.current = {}
    }
  }, [])

  // Handle VNC viewport scaling
  useEffect(() => {
    if (!activeSessionId) return
    const rfb = rfbRefs.current[activeSessionId]
    if (rfb && vncContainerRefs.current[activeSessionId]) {
      rfb.scaleViewport = true
      rfb.resizeSession = false
    }
  }, [activeSessionId, width])

  const handleStopAi = useCallback(async (sessionId: string, chatId: string) => {
    updateSessionState(sessionId, { stopping: true })
    try {
      await api.delete(`/chats/${chatId}/stream`)
    } catch {
      // Stream may have already finished
    }
    // The stopping state will be cleared when ai_active flips to false via WebSocket
  }, [updateSessionState])

  const handleNavigate = useCallback((sessionId: string, url: string) => {
    if (!sessionId) return
    const client = browserClientRefs.current[sessionId]
    client?.navigate(url)
  }, [])

  const activeSession = sessionList.find((s) => s.session_id === activeSessionId)
  const activeState = activeSessionId ? sessionStates[activeSessionId] : undefined

  return (
    <div className="flex h-full flex-col bg-layer">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-interactive" />
          <span className="text-sm font-semibold text-text-primary">Browser Control</span>
          {sessionList.length > 0 && (
            <span className="text-[10px] text-text-helper">
              {sessionList.length} session{sessionList.length !== 1 ? 's' : ''}
            </span>
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

      {sessionList.length === 0 ? (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <MousePointerClick className="mb-3 h-10 w-10 text-text-disabled" />
          <p className="text-sm font-medium text-text-secondary">No active browser sessions</p>
          <p className="mt-1 text-xs text-text-helper">
            Ask the AI to automate a browser task in any chat to see it here.
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex items-center border-b border-border-subtle bg-layer/50 px-2 py-1">
            <div
              className="flex flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-0.5"
              onWheel={(e) => {
                e.currentTarget.scrollLeft += e.deltaY
                e.preventDefault()
              }}
            >
              {sessionList.map((session) => {
                const state = sessionStates[session.session_id]
                const isActive = session.session_id === activeSessionId
                const isCurrentChat = session.chat_id === chatId
                return (
                  <button
                    key={session.session_id}
                    onClick={() => setActiveSessionId(session.session_id)}
                    className={`flex shrink-0 cursor-pointer items-center gap-2 rounded px-2.5 py-1 text-[11px] transition-colors ${
                      isActive
                        ? 'bg-background text-text-primary'
                        : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
                    }`}
                    title={isCurrentChat ? 'Current chat session' : `Session from chat ${session.chat_id.slice(0, 8)}`}
                  >
                    <span className="max-w-[120px] truncate">
                      {state?.title || state?.currentUrl || `Session ${session.session_id.slice(0, 6)}`}
                    </span>
                    {state?.aiActive && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-support-warning" />
                    )}
                    {isCurrentChat && !isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-interactive" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* URL bar for active session */}
          {activeSession && activeState && !activeState.sessionClosed && (
            <div className="flex items-center gap-2 border-b border-border-subtle bg-background px-3 py-1.5">
              <input
                type="text"
                value={activeState.currentUrl}
                onChange={(e) => {
                  if (activeSessionId) {
                    updateSessionState(activeSessionId, { currentUrl: e.target.value })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && activeSessionId) {
                    handleNavigate(activeSessionId, activeState.currentUrl)
                  }
                }}
                placeholder="Enter URL and press Enter"
                className="flex-1 rounded border border-border-subtle bg-layer px-2 py-1 text-[11px] text-text-primary outline-none focus:border-interactive"
              />
            </div>
          )}

          {/* noVNC canvas */}
          <div className="relative flex-1 overflow-hidden bg-black/90">
            {sessionList.map((session) => {
              const sid = session.session_id
              return (
                <div
                  key={sid}
                  ref={(el) => { vncContainerRefs.current[sid] = el }}
                  className={`absolute inset-0 ${sid === activeSessionId ? 'z-10' : 'z-0 opacity-0 pointer-events-none'}`}
                  style={{ minHeight: 0 }}
                />
              )
            })}

            {/* AI active overlay with stop button */}
            {activeState?.aiActive && activeSession && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 pointer-events-auto">
                <div className="rounded-lg bg-layer/90 px-6 py-4 shadow-lg">
                  <div className="flex items-center gap-2 text-text-primary">
                    <Loader2 className="h-4 w-4 animate-spin text-support-warning" />
                    <span className="text-sm font-medium">
                      {activeState.stopping ? 'Stopping...' : `AI is controlling: ${activeState.aiAction}`}
                    </span>
                  </div>
                  {!activeState.stopping && (
                    <button
                      onClick={() => handleStopAi(activeSession.session_id, activeSession.chat_id)}
                      className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-support-error px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-support-error/90"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      Stop AI
                    </button>
                  )}
                  {activeState.stopping && (
                    <p className="mt-3 text-center text-xs text-text-helper">
                      AI will stop after current action completes
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Session closed overlay */}
            {activeState?.sessionClosed && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
                <div className="text-center">
                  <WifiOff className="mx-auto h-8 w-8 text-text-disabled" />
                  <p className="mt-2 text-xs text-text-helper">Session ended</p>
                </div>
              </div>
            )}

            {/* Connection status badge */}
            {activeState && !activeState.sessionClosed && (
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-layer/80 px-2 py-1 text-[10px] shadow-sm">
                {activeState.connected ? (
                  <>
                    <Wifi className="h-2.5 w-2.5 text-support-success" />
                    <span className="text-support-success">Connected</span>
                  </>
                ) : activeState.connecting ? (
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
        </>
      )}
    </div>
  )
}