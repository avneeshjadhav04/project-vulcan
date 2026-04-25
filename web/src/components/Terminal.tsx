import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

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
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`)
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

    term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      const code = data.charCodeAt(0)

      if (data === '\r' || data === '\n') {
        if (currentLine.trim().length > 0) {
          ws.send(JSON.stringify({ command: currentLine.trim() }))
        }
        currentLine = ''
        term.writeln('')
      } else if (code === 127 || code === 8) {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1)
          term.write('\b \b')
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
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">Sandboxed Terminal</span>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 ${connected ? 'bg-success' : 'bg-error'}`} />
          <span className="text-xs text-text-secondary">{connected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 p-2" />
    </div>
  )
}
