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
import { api } from '../../lib/api'

let RFBConstructor: any = null

async function loadRFB(): Promise<any> {
  if (RFBConstructor) return RFBConstructor
  const mod = await import('@novnc/novnc')
  RFBConstructor = mod.default
  return RFBConstructor
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
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [vncConnected, setVncConnected] = useState(false)
  const [vncConnecting, setVncConnecting] = useState(false)

  const vncContainerRef = useRef<HTMLDivElement | null>(null)
  const rfbRef = useRef<any | null>(null)
  const mountedRef = useRef(true)
  const vncConnectedRef = useRef(false)

  const { data: status } = useQuery<{
    running: boolean
    current_url: string
    title: string
    ai_active: boolean
  }>({
    queryKey: ['browser-status'],
    queryFn: async () => {
      const res = await api.get('/browser/status')
      return res.data || { running: false, current_url: '', title: '', ai_active: false }
    },
    refetchInterval: 2000,
  })

  const isRunning = status?.running ?? false

  // Start the browser (Chrome + Xvnc). No session created.
  const handleOpenBrowser = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      await api.post('/browser/start', {})
      queryClient.invalidateQueries({ queryKey: ['browser-status'] })
    } catch (e) {
      console.error('Failed to start browser:', e)
    } finally {
      setCreating(false)
    }
  }, [creating, queryClient])

  // Connect noVNC to the shared VNC stream.
  const connectVnc = useCallback(async () => {
    if (rfbRef.current || vncConnectedRef.current) return
    const container = vncContainerRef.current
    if (!container) return

    setVncConnecting(true)

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/api/browser/vnc`

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

        const container = vncContainerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            // Send resize via the events WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
            const host = window.location.host
            const eventsWs = new WebSocket(`${protocol}//${host}/api/browser/events`)
            eventsWs.onopen = () => {
              eventsWs.send(JSON.stringify({
                type: 'resize',
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }))
              eventsWs.close()
            }
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

  // Connect VNC when browser is running
  useEffect(() => {
    if (isRunning && !rfbRef.current && !vncConnectedRef.current) {
      connectVnc()
    }
  }, [isRunning, connectVnc])

  // Disconnect VNC when browser stops
  useEffect(() => {
    if (!isRunning && rfbRef.current) {
      disconnectVnc()
    }
  }, [isRunning, disconnectVnc])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false
      disconnectVnc()
    }
  }, [disconnectVnc])

  // VNC auto-reconnect
  useEffect(() => {
    if (!vncConnected && !vncConnecting && isRunning && !rfbRef.current && !vncConnectedRef.current) {
      const timer = setTimeout(() => {
        if (mountedRef.current && !rfbRef.current && !vncConnectedRef.current && isRunning) {
          connectVnc()
        }
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [vncConnected, vncConnecting, isRunning, connectVnc])

  // Handle VNC viewport
  useEffect(() => {
    if (rfbRef.current && vncContainerRef.current) {
      rfbRef.current.scaleViewport = false
      rfbRef.current.resizeSession = true
    }
  }, [width])

  // Resize Chrome's window to match the container
  useEffect(() => {
    const container = vncContainerRef.current
    if (!container || !isRunning) return
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const eventsWs = new WebSocket(`${protocol}//${host}/api/browser/events`)
      eventsWs.onopen = () => {
        eventsWs.send(JSON.stringify({
          type: 'resize',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }))
        eventsWs.close()
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [isRunning])

  const handleStopAi = useCallback(async () => {
    try {
      await api.delete(`/chats/${chatId}/stream`)
    } catch {
      // Stream may have already finished
    }
  }, [chatId])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-layer">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-interactive" />
          <span className="text-sm font-semibold text-text-primary">Browser Control</span>
          {/* Connection status badge */}
          {isRunning && (
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

      {!isRunning ? (
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
          <div className="relative flex-1 overflow-hidden bg-black/90 scrollbar-none">
            <div
              ref={(el) => { vncContainerRef.current = el }}
              className="absolute inset-0 z-10 scrollbar-none"
              style={{ minHeight: 0 }}
            />

            {/* AI active overlay with stop button */}
            {status?.ai_active && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 pointer-events-auto">
                <div className="rounded-lg bg-layer/90 px-6 py-4 shadow-lg">
                  <div className="flex items-center gap-2 text-text-primary">
                    <Loader2 className="h-4 w-4 animate-spin text-support-warning" />
                    <span className="text-sm font-medium">AI is controlling the browser</span>
                  </div>
                  {chatId && (
                    <button
                      onClick={handleStopAi}
                      className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-support-error px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-support-error/90"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      Stop AI
                    </button>
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
