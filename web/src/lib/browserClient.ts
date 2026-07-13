export interface BrowserClientOptions {
  sessionId: string
  onAiActive?: (active: boolean, action: string) => void
  onUrlChanged?: (url: string) => void
  onTitleChanged?: (title: string) => void
  onSessionReady?: (wsPort: number) => void
  onSessionClosed?: () => void
  onStatusChange?: (connected: boolean) => void
}

export class BrowserClient {
  private ws: WebSocket | null = null
  private opts: BrowserClientOptions
  private reconnectTimer: number | null = null
  private closed = false

  constructor(opts: BrowserClientOptions) {
    this.opts = opts
  }

  connect() {
    if (this.closed) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/api/browser?session=${encodeURIComponent(this.opts.sessionId)}`

    this.opts.onStatusChange?.(false)

    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.opts.onStatusChange?.(true)
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        switch (data.type) {
          case 'ai_active':
            this.opts.onAiActive?.(data.active, data.action || '')
            break
          case 'url_changed':
            this.opts.onUrlChanged?.(data.url)
            break
          case 'title_changed':
            this.opts.onTitleChanged?.(data.title)
            break
          case 'session_ready':
            this.opts.onSessionReady?.(data.ws_port)
            break
          case 'session_closed':
            this.opts.onSessionClosed?.()
            this.opts.onStatusChange?.(false)
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      this.opts.onStatusChange?.(false)
      if (!this.closed) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.closed) this.connect()
    }, 2000)
  }

  navigate(url: string) {
    this.ws?.send(JSON.stringify({ type: 'navigate', url }))
  }

  close() {
    this.ws?.send(JSON.stringify({ type: 'close' }))
  }

  disconnect() {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}