import { Terminal as XTerm, type ITheme } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

export interface ShellMessage {
  type: 'cwd' | 'status'
  cwd?: string
  running?: boolean
  code?: number
}

export interface ShellClientOptions {
  tabId: string
  container: HTMLElement
  theme: ITheme
  onConnectedChange?: (connected: boolean) => void
  onRunningChange?: (running: boolean) => void
  onCwdChange?: (cwd: string) => void
}

export class ShellClient {
  private tabId: string
  private container: HTMLElement
  private theme: ITheme
  private term: XTerm | null = null
  private fitAddon: FitAddon | null = null
  private ws: WebSocket | null = null
  private onConnectedChange?: (connected: boolean) => void
  private onRunningChange?: (running: boolean) => void
  private onCwdChange?: (cwd: string) => void
  private connected = false
  private resizeObserver: ResizeObserver | null = null
  private cleanupWindowResize: (() => void) | null = null

  constructor(options: ShellClientOptions) {
    this.tabId = options.tabId
    this.container = options.container
    this.theme = options.theme
    this.onConnectedChange = options.onConnectedChange
    this.onRunningChange = options.onRunningChange
    this.onCwdChange = options.onCwdChange
  }

  connect() {
    if (this.ws) {
      this.disconnect()
    }

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
    fitAddon.fit()
    term.focus()

    this.term = term
    this.fitAddon = fitAddon

    this.resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        this.sendResize()
      } catch {}
    })
    this.resizeObserver.observe(this.container)

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/terminal?tab=${this.tabId}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.connected = true
      this.onConnectedChange?.(true)
      this.sendResize()
      // Backend sends an initial banner in text JSON, then PTY output.
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

    ws.onclose = () => {
      this.connected = false
      this.onConnectedChange?.(false)
      this.writeError('Connection closed.')
    }

    ws.onerror = () => {
      this.connected = false
      this.onConnectedChange?.(false)
      this.writeError('Terminal connection error.')
    }

    term.onData((data) => this.handleInput(data))

    const handleWindowResize = () => {
      try {
        fitAddon.fit()
        this.sendResize()
      } catch {}
    }
    window.addEventListener('resize', handleWindowResize)
    this.cleanupWindowResize = () => window.removeEventListener('resize', handleWindowResize)
  }

  private sendResize() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.term) return
    const cols = this.term.cols
    const rows = this.term.rows
    if (cols > 0 && rows > 0) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  }

  private handleMessage(msg: ShellMessage) {
    if (msg.type === 'cwd' && msg.cwd) {
      this.onCwdChange?.(msg.cwd)
      // When cwd arrives, prompt has returned; command is no longer running.
      this.onRunningChange?.(false)
    } else if (msg.type === 'status') {
      this.onRunningChange?.(msg.running ?? false)
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
    } catch {}
  }

  get isConnected() {
    return this.connected
  }

  disconnect() {
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
