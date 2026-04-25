import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { RefreshCw } from 'lucide-react'

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)

  const initTerminal = useCallback(() => {
    if (!containerRef.current) return

    // Clear previous terminal if any
    containerRef.current.innerHTML = ''

    const term = new XTerm({
      theme: {
        background: '#161616',
        foreground: '#f4f4f4',
        cursor: '#0f62fe',
        selectionBackground: '#0f62fe',
        black: '#161616',
        red: '#da1e28',
        green: '#24a148',
        yellow: '#f1c21b',
        blue: '#0f62fe',
        magenta: '#8a3ffc',
        cyan: '#0072c3',
        white: '#f4f4f4',
      },
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    xtermRef.current = term

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/terminal`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      term.writeln('\x1b[32mConnected to sandboxed terminal.\x1b[0m')
      term.writeln('\x1b[90mType a command and press Enter to execute.\x1b[0m')
      term.writeln('')
      term.write('\x1b[36m$ \x1b[0m')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          term.writeln(msg.data)
        } else if (msg.status) {
          const color = msg.status === 'success' ? '\x1b[32m' : '\x1b[31m'
          term.writeln(`${color}[${msg.status.toUpperCase()}]\x1b[0m`)
          term.writeln('')
          term.write('\x1b[36m$ \x1b[0m')
        }
      } catch {
        term.writeln(event.data)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      term.writeln('\x1b[31mDisconnected from terminal.\x1b[0m')
    }

    ws.onerror = () => {
      term.writeln('\x1b[31mTerminal connection error.\x1b[0m')
    }

    let currentLine = ''
    const history: string[] = []
    let historyIndex = -1

    term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      const code = data.charCodeAt(0)

      if (data === '\r' || data === '\n') {
        if (currentLine.trim().length > 0) {
          history.push(currentLine)
          if (history.length > 100) history.shift()
          ws.send(JSON.stringify({ command: currentLine.trim() }))
        }
        currentLine = ''
        historyIndex = history.length
        term.writeln('')
      } else if (code === 127 || code === 8) {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1)
          term.write('\b \b')
        }
      } else if (data === '\x1b[A') {
        // Up arrow - previous command
        if (historyIndex > 0) {
          historyIndex--
          currentLine = history[historyIndex] || ''
          term.write(`\x1b[2K\r\x1b[36m$ \x1b[0m${currentLine}`)
        }
      } else if (data === '\x1b[B') {
        // Down arrow - next command
        if (historyIndex < history.length - 1) {
          historyIndex++
          currentLine = history[historyIndex] || ''
          term.write(`\x1b[2K\r\x1b[36m$ \x1b[0m${currentLine}`)
        } else {
          historyIndex = history.length
          currentLine = ''
          term.write(`\x1b[2K\r\x1b[36m$ \x1b[0m`)
        }
      } else if (code < 32) {
        // Ignore other control characters
      } else {
        currentLine += data
        term.write(data)
      }
    })

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      ws.close()
      term.dispose()
    }
  }, [reconnectKey])

  useEffect(() => {
    const cleanup = initTerminal()
    return cleanup
  }, [initTerminal])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">Sandboxed Terminal</span>
        <div className="flex items-center gap-3">
          {!connected && (
            <button
              onClick={() => setReconnectKey((k) => k + 1)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              title="Reconnect"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 ${connected ? 'bg-success' : 'bg-error'}`} />
            <span className="text-xs text-text-secondary">{connected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 p-2" />
    </div>
  )
}
