import { Terminal as XTerm, type ITheme } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

export interface ShellMessage {
  type: 'cwd' | 'status' | 'stdout' | 'stderr'
  cwd?: string
  running?: boolean
  code?: number
  data?: string
}

export interface ShellClientOptions {
  tabId: string
  container: HTMLElement
  theme: ITheme
  onStateChange?: (state: ShellState) => void
  onRunningChange?: (running: boolean) => void
  onCwdChange?: (cwd: string) => void
}

export interface ShellState {
  connecting: boolean
  connected: boolean
  error?: string
}

const OPEN_TIMEOUT_MS = 5000
const RETRY_BACKOFF_MS = [1000, 2000, 4000]

export class ShellClient {
  private tabId: string
  private container: HTMLElement
  private theme: ITheme
  private term: XTerm | null = null
  private fitAddon: FitAddon | null = null
  private ws: WebSocket | null = null
  private onStateChange?: (state: ShellState) => void
  private onRunningChange?: (running: boolean) => void
  private onCwdChange?: (cwd: string) => void
  private connected = false
  private connecting = false
  private retryCount = 0
  private openTimeout: ReturnType<typeof setTimeout> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private resizeObserver: ResizeObserver | null = null
  private cleanupWindowResize: (() => void) | null = null

  constructor(options: ShellClientOptions) {
    this.tabId = options.tabId
    this.container = options.container
    this.theme = options.theme
    this.onStateChange = options.onStateChange
    this.onRunningChange = options.onRunningChange
    this.onCwdChange = options.onCwdChange
  }

  connect() {
    if (this.ws || this.connecting) return

    this.connecting = true
    this.emitState()

    this.container.innerHTML = ''
    const term = new XTerm({
      theme: this.theme,
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(this.container)

    this.term = term
    this.fitAddon = fitAddon

    this.resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        this.sendResize()
      } catch (err) {
        console.warn('[ShellClient] fit/resize error:', err)
      }
    })
    this.resizeObserver.observe(this.container)

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/terminal?tab=${this.tabId}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    this.openTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[ShellClient] WebSocket open timeout')
        ws.close()
        this.handleDisconnect('Connection timed out.')
        this.scheduleRetry()
      }
    }, OPEN_TIMEOUT_MS)

    ws.onopen = () => {
      if (this.openTimeout) {
        clearTimeout(this.openTimeout)
        this.openTimeout = null
      }
      this.retryCount = 0
      this.connecting = false
      this.connected = true
      this.emitState()

      try {
        fitAddon.fit()
      } catch (err) {
        console.warn('[ShellClient] initial fit error:', err)
      }
      this.sendResize()
      term.focus()
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg: ShellMessage = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch {
          // Fallback: treat unknown text as terminal output.
          this.writeBytes(new TextEncoder().encode(event.data))
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.writeBytes(new Uint8Array(event.data))
      }
    }

    ws.onclose = (event) => {
      if (this.openTimeout) {
        clearTimeout(this.openTimeout)
        this.openTimeout = null
      }
      const wasConnected = this.connected
      this.connected = false
      this.connecting = false
      this.emitState()

      if (!event.wasClean && wasConnected) {
        this.writeError('Connection lost. Reconnecting…')
        this.scheduleRetry()
      } else if (!wasConnected && !this.connecting) {
        this.handleDisconnect('Connection closed.')
        this.scheduleRetry()
      }
    }

    ws.onerror = () => {
      this.connecting = false
      this.connected = false
      this.emitState()
      this.handleDisconnect('Terminal connection error.')
      this.scheduleRetry()
    }

    term.onData((data) => this.handleInput(data))

    const handleWindowResize = () => {
      try {
        fitAddon.fit()
        this.sendResize()
      } catch (err) {
        console.warn('[ShellClient] window resize error:', err)
      }
    }
    window.addEventListener('resize', handleWindowResize)
    this.cleanupWindowResize = () => window.removeEventListener('resize', handleWindowResize)
  }

  private scheduleRetry() {
    if (this.retryTimeout) return
    const delay = RETRY_BACKOFF_MS[Math.min(this.retryCount, RETRY_BACKOFF_MS.length - 1)]
    this.retryCount += 1
    console.info(`[ShellClient] retrying connection in ${delay}ms (attempt ${this.retryCount})`)
    this.connecting = true
    this.emitState()
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null
      this.ws = null
      this.connect()
    }, delay)
  }

  private handleDisconnect(reason: string) {
    this.connected = false
    this.connecting = false
    this.emitState()
    this.writeError(reason)
  }

  private emitState() {
    this.onStateChange?.({
      connecting: this.connecting,
      connected: this.connected,
    })
  }

  private sendResize() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.term) return
    const cols = this.term.cols
    const rows = this.term.rows
    if (cols > 0 && rows > 0) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    } else {
      console.warn('[ShellClient] refusing resize with zero dimensions', { cols, rows })
    }
  }

  private handleMessage(msg: ShellMessage) {
    switch (msg.type) {
      case 'cwd':
        if (msg.cwd) {
          this.onCwdChange?.(msg.cwd)
          this.onRunningChange?.(false)
        }
        break
      case 'status':
        this.onRunningChange?.(msg.running ?? false)
        break
      case 'stdout':
      case 'stderr':
        if (msg.data) {
          this.writeBytes(new TextEncoder().encode(msg.data))
        }
        break
      default:
        // Unknown JSON messages are intentionally ignored.
        console.warn('[ShellClient] unknown message type:', msg)
    }
  }

  private handleInput(data: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    // Ctrl+L clears the screen locally; also send it to bash which handles it.
    if (data === '\x0c') {
      this.term?.clear()
    }

    // If the user pressed Enter, mark command as running for the UI.
    if (data === '\r' || data === '\n') {
      this.onRunningChange?.(true)
    }

    this.ws.send(JSON.stringify({ type: 'input', data }))
  }

  private writeBytes(data: Uint8Array) {
    this.term?.write(data)
  }

  private writeError(text: string) {
    this.term?.writeln('')
    this.term?.writeln(`\x1b[31m${text}\x1b[0m`)
  }

  focus() {
    this.term?.focus()
  }

  clear() {
    this.term?.clear()
  }

  scrollToTop() {
    this.term?.scrollToTop()
  }

  scrollToBottom() {
    this.term?.scrollToBottom()
  }

  scrollLines(amount: number) {
    this.term?.scrollLines(amount)
  }

  updateTheme(theme: ITheme) {
    this.theme = theme
    if (this.term) {
      this.term.options.theme = { ...theme }
    }
  }

  fit() {
    try {
      this.fitAddon?.fit()
      this.sendResize()
    } catch (err) {
      console.warn('[ShellClient] fit error:', err)
    }
  }

  get isConnected() {
    return this.connected
  }

  disconnect() {
    if (this.openTimeout) {
      clearTimeout(this.openTimeout)
      this.openTimeout = null
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    this.connected = false
    this.connecting = false
    this.retryCount = 0
    this.emitState()

    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.cleanupWindowResize) {
      this.cleanupWindowResize()
      this.cleanupWindowResize = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.term) {
      this.term.dispose()
      this.term = null
      this.fitAddon = null
    }
  }
}
