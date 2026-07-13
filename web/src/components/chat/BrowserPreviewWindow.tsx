import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  X,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
  Loader2,
  MousePointerClick,
  ChevronDown,
} from 'lucide-react'
// noVNC is loaded dynamically to avoid top-level await issues with the build target.
// The RFB constructor is stored in a ref once the module is imported.
let RFBConstructor: any = null

async function loadRFB(): Promise<typeof import('@novnc/novnc').default> {
  if (RFBConstructor) return RFBConstructor
  const mod = await import('@novnc/novnc')
  RFBConstructor = mod.default
  return RFBConstructor
}
import { BrowserClient } from '../../lib/browserClient'
import ToolExecutionCard from './ToolExecutionCard'
import type { BrowserSessionTab } from '../../hooks/useChatStream'

interface BrowserPreviewWindowProps {
  chatId?: string
  sessions: BrowserSessionTab[]
  mode: 'live' | 'replay'
}

interface SessionState {
  connected: boolean
  connecting: boolean
  aiActive: boolean
  aiAction: string
  currentUrl: string
  title: string
  wsPort?: number
  sessionClosed: boolean
}

export default function BrowserPreviewWindow({
  chatId,
  sessions,
  mode,
}: BrowserPreviewWindowProps) {
  const [activeSessionIdx, setActiveSessionIdx] = useState(0)
  const [isMaximized, setIsMaximized] = useState(false)
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({})
  const [expandedScreenshots, setExpandedScreenshots] = useState<Record<string, boolean>>({})

  const vncContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rfbRefs = useRef<Record<string, InstanceType<typeof import('@novnc/novnc').default> | null>>({})
  const browserClientRefs = useRef<Record<string, BrowserClient | null>>({})
  const vncWsPortRefs = useRef<Record<string, number | undefined>>({})

  const activeSession = sessions[activeSessionIdx]
  const activeSessionId = activeSession?.sessionId

  const updateSessionState = useCallback((sessionId: string, updates: Partial<SessionState>) => {
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || defaultSessionState()), ...updates },
    }))
  }, [])

  // Initialize BrowserClient for each live session
  useEffect(() => {
    if (mode !== 'live') return

    sessions.forEach((session) => {
      const sid = session.sessionId
      if (browserClientRefs.current[sid] || !sid) return

      updateSessionState(sid, { connecting: true })

      const client = new BrowserClient({
        sessionId: sid,
        onStatusChange: (connected) => {
          updateSessionState(sid, { connected, connecting: !connected })
        },
        onAiActive: (active, action) => {
          updateSessionState(sid, { aiActive: active, aiAction: action })
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
          // Connect noVNC once we have the port
          connectVnc(sid, wsPort)
        },
        onSessionClosed: () => {
          updateSessionState(sid, { sessionClosed: true, connected: false })
          disconnectVnc(sid)
        },
      })

      browserClientRefs.current[sid] = client
      client.connect()
    })

    return () => {
      // Cleanup clients when component unmounts or sessions change
    }
  }, [sessions, mode, updateSessionState])

  // Connect noVNC RFB to websockify
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

      rfb.addEventListener('desktopname', () => {})

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
    if (rfb) {
      const container = vncContainerRefs.current[activeSessionId]
      if (container) {
        rfb.scaleViewport = true
        rfb.resizeSession = false
      }
    }
  }, [activeSessionId, isMaximized])

  // User navigation from URL bar
  const handleNavigate = useCallback((url: string) => {
    if (!activeSessionId || mode !== 'live') return
    const client = browserClientRefs.current[activeSessionId]
    client?.navigate(url)
  }, [activeSessionId, mode])

  const handleCloseSession = useCallback(() => {
    if (!activeSessionId || mode !== 'live') return
    const client = browserClientRefs.current[activeSessionId]
    client?.close()
  }, [activeSessionId, mode])

  if (sessions.length === 0) return null

  const activeState = activeSessionId ? sessionStates[activeSessionId] : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`my-2 w-full overflow-hidden border border-border-subtle bg-layer ${
        isMaximized ? 'fixed inset-0 z-50' : ''
      }`}
      style={isMaximized ? { height: '100vh' } : { height: '420px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-layer px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center border border-border-subtle bg-background">
            <MousePointerClick className="h-3.5 w-3.5 text-interactive" />
          </div>
          <span className="text-xs font-semibold text-text-primary">Browser</span>
          {mode === 'replay' && (
            <span className="rounded bg-text-helper/10 px-1.5 py-0.5 text-[10px] font-medium text-text-helper">
              Replay
            </span>
          )}
          {/* Connection status */}
          {mode === 'live' && activeState && (
            <div className="flex items-center gap-1.5">
              {activeState.connected ? (
                <>
                  <Wifi className="h-2.5 w-2.5 text-support-success" />
                  <span className="text-[10px] text-support-success">Connected</span>
                </>
              ) : activeState.connecting ? (
                <>
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-support-warning" />
                  <span className="text-[10px] text-support-warning">Connecting…</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-2.5 w-2.5 text-support-error" />
                  <span className="text-[10px] text-support-error">Offline</span>
                </>
              )}
              {activeState.sessionClosed && (
                <span className="text-[10px] text-text-helper">Session ended</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      {sessions.length > 1 && (
        <div className="flex items-center border-b border-border-subtle bg-layer/50 px-2 py-1">
          <div className="flex flex-1 items-center gap-1 overflow-x-auto py-0.5">
            {sessions.map((session, idx) => {
              const state = sessionStates[session.sessionId]
              return (
                <button
                  key={session.sessionId}
                  onClick={() => setActiveSessionIdx(idx)}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors ${
                    idx === activeSessionIdx
                      ? 'bg-background text-text-primary'
                      : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
                  }`}
                >
                  <span className="truncate">
                    {state?.title || state?.currentUrl || `Session ${idx + 1}`}
                  </span>
                  {state?.aiActive && (
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-support-warning" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* URL bar (live mode only) */}
      {mode === 'live' && activeState && !activeState.sessionClosed && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-background px-3 py-1.5">
          <input
            type="text"
            value={activeState.currentUrl}
            onChange={(e) => updateSessionState(activeSessionId!, { currentUrl: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNavigate(activeState.currentUrl)
            }}
            placeholder="Enter URL and press Enter"
            className="flex-1 rounded border border-border-subtle bg-layer px-2 py-1 text-[11px] text-text-primary outline-none focus:border-interactive"
          />
          <button
            onClick={handleCloseSession}
            className="flex items-center gap-1 rounded border border-support-error/30 bg-support-error/10 px-2 py-1 text-[10px] text-support-error transition-colors hover:bg-support-error/20"
            title="Close session"
          >
            <X className="h-3 w-3" />
            Close
          </button>
        </div>
      )}

      {/* Split layout: VNC (left) + tool list (right) */}
      <div className={`flex overflow-hidden ${isMaximized ? 'h-[calc(100vh-120px)]' : 'h-[calc(420px-120px)]'}`}>
        {/* Left: noVNC canvas / replay placeholder */}
        <div className="relative flex-1 overflow-hidden bg-black/90">
          {mode === 'live' && sessions.map((session) => (
            <div
              key={session.sessionId}
              ref={(el) => { vncContainerRefs.current[session.sessionId] = el }}
              className={`absolute inset-0 ${session.sessionId === activeSessionId ? 'z-10' : 'z-0 opacity-0 pointer-events-none'}`}
              style={{ minHeight: 0 }}
            />
          ))}

          {/* Replay mode: show last screenshot or placeholder */}
          {mode === 'replay' && activeSession && (
            <div className="flex h-full items-center justify-center">
              {(() => {
                const screenshots = activeSession.toolExecutions.filter(
                  (t) => t.tool_name === 'browser_screenshot' && t.screenshot_id
                )
                const last = screenshots[screenshots.length - 1]
                if (last?.screenshot_id) {
                  return (
                    <img
                      src={`/api/browser/screenshot/${last.screenshot_id}`}
                      alt="Browser state"
                      className="max-h-full max-w-full object-contain"
                    />
                  )
                }
                return (
                  <div className="text-center">
                    <MousePointerClick className="mx-auto h-8 w-8 text-text-disabled" />
                    <p className="mt-2 text-xs text-text-helper">No screenshot captured</p>
                  </div>
                )
              })()}
            </div>
          )}

          {/* AI active overlay (live mode only) */}
          {mode === 'live' && activeState?.aiActive && (
            <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/50 pt-12 pointer-events-auto">
              <div className="flex items-center gap-2 rounded-full bg-layer/90 px-4 py-2 shadow-lg">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-support-warning" />
                <span className="text-xs font-medium text-text-primary">
                  AI is controlling: {activeState.aiAction}
                </span>
              </div>
            </div>
          )}

          {/* Session closed overlay */}
          {mode === 'live' && activeState?.sessionClosed && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 pointer-events-auto">
              <div className="text-center">
                <WifiOff className="mx-auto h-8 w-8 text-text-disabled" />
                <p className="mt-2 text-xs text-text-helper">Session ended</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: tool execution list */}
        <div className="w-2/5 overflow-y-auto border-l border-border-subtle bg-background">
          {activeSession?.toolExecutions.map((tool, index) => {
            const isScreenshot = tool.tool_name === 'browser_screenshot'
            const screenshotKey = tool.screenshot_id || `${tool.tool_id}-${index}`
            const isExpanded = expandedScreenshots[screenshotKey]

            return (
              <div key={`${tool.tool_id}-${index}`}>
                <ToolExecutionCard
                  tool={tool}
                  chatId={chatId}
                  defaultExpanded={index === activeSession.toolExecutions.length - 1}
                />
                {/* Inline screenshot thumbnail */}
                {isScreenshot && tool.screenshot_id && (
                  <div className="px-3 pb-2">
                    <button
                      onClick={() =>
                        setExpandedScreenshots((prev) => ({
                          ...prev,
                          [screenshotKey]: !prev[screenshotKey],
                        }))
                      }
                      className="block w-full"
                    >
                      <img
                        src={`/api/browser/screenshot/${tool.screenshot_id}`}
                        alt="Screenshot"
                        className={`w-full border border-border-subtle object-contain transition-all ${
                          isExpanded ? 'max-h-96' : 'max-h-24'
                        }`}
                      />
                      <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-text-helper">
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                        {isExpanded ? 'Click to collapse' : 'Click to expand'}
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
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
  }
}