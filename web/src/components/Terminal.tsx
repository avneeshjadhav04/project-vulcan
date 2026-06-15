import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw,
  Terminal as TerminalIcon,
  Trash2,
  WifiOff,
  Wifi,
  Shield,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Maximize2,
  Minimize2,
} from 'lucide-react'

export default function Terminal({ 
  isMaximized = false,
  onToggleMaximize,
}: {
  isMaximized?: boolean
  onToggleMaximize?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [commandCount, setCommandCount] = useState(0)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [lastError, setLastError] = useState('')

  const initTerminal = useCallback(() => {
    if (!containerRef.current) return () => {}

    containerRef.current.innerHTML = ''
    setConnecting(true)
    setLastError('')

    const term = new XTerm({
      theme: {
        background: '#161616',
        foreground: '#c6c6c6',
        cursor: '#0f62fe',
        selectionBackground: 'rgba(15, 98, 254, 0.3)',
        black: '#161616',
        red: '#fa4d56',
        green: '#42be65',
        yellow: '#f1c21b',
        blue: '#78a9ff',
        magenta: '#be95ff',
        cyan: '#33b1ff',
        white: '#f4f4f4',
        brightBlack: '#525252',
        brightRed: '#ff8d8d',
        brightGreen: '#6fdc8c',
        brightYellow: '#f1c21b',
        brightBlue: '#a6c8ff',
        brightMagenta: '#d4bbff',
        brightCyan: '#82cfff',
        brightWhite: '#ffffff',
      },
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    term.focus()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {}
    })
    resizeObserver.observe(containerRef.current)

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/terminal`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setConnecting(false)
      setLastError('')
      term.writeln('')
      term.writeln('\x1b[1;34m  Project Vulcan Sandbox Terminal\x1b[0m')
      term.writeln('\x1b[90m  ──────────────────────────────\x1b[0m')
      term.writeln('\x1b[32m  Connected to sandboxed environment.\x1b[0m')
      term.writeln('\x1b[90m  Type commands and press Enter to execute.\x1b[0m')
      term.writeln('\x1b[90m  Commands run in an isolated Ubuntu container.\x1b[0m')
      term.writeln('')
      term.write('\x1b[36m\u276f \x1b[0m')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'stdout') {
          term.writeln(msg.data)
        } else if (msg.type === 'stderr') {
          term.writeln(`\x1b[31m${msg.data}\x1b[0m`)
        } else if (msg.status) {
          const color = msg.status === 'success' ? '\x1b[32m' : '\x1b[31m'
          const icon = msg.status === 'success' ? '\u2713' : '\u2717'
          term.writeln(`  ${color}${icon} ${msg.status.toUpperCase()}${msg.code !== undefined ? ` (exit ${msg.code})` : ''}\x1b[0m`)
          term.writeln('')
          term.write('\x1b[36m\u276f \x1b[0m')
          if (msg.status === 'success' || msg.status === 'error') {
            setCommandCount((c) => c + 1)
          }
        }
      } catch {
        term.writeln(event.data)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setConnecting(false)
      term.writeln('')
      term.writeln('\x1b[31m  Connection closed.\x1b[0m')
    }

    ws.onerror = () => {
      setConnected(false)
      setConnecting(false)
      setLastError('Could not connect to sandbox. Make sure the sandbox service is running.')
      term.writeln('')
      term.writeln('\x1b[31m  \u26a0 Terminal connection error.\x1b[0m')
      term.writeln('\x1b[90m  The sandbox service may not be available.\x1b[0m')
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
          term.writeln('')
        } else {
          term.writeln('')
        }
        currentLine = ''
        historyIndex = history.length
        term.write('\x1b[36m\u276f \x1b[0m')
      } else if (code === 127 || code === 8) {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1)
          term.write('\b \b')
        }
      } else if (data === '\x1b[A') {
        if (historyIndex > 0) {
          historyIndex--
          currentLine = history[historyIndex] || ''
          term.write(`\x1b[2K\r\x1b[36m\u276f \x1b[0m${currentLine}`)
        }
      } else if (data === '\x1b[B') {
        if (historyIndex < history.length - 1) {
          historyIndex++
          currentLine = history[historyIndex] || ''
          term.write(`\x1b[2K\r\x1b[36m\u276f \x1b[0m${currentLine}`)
        } else {
          historyIndex = history.length
          currentLine = ''
          term.write(`\x1b[2K\r\x1b[36m\u276f \x1b[0m`)
        }
      } else if (code < 32) {
        // Ignore other control characters
      } else {
        currentLine += data
        term.write(data)
      }
    })

    const handleWindowResize = () => {
      try {
        fitAddon.fit()
      } catch {}
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [reconnectKey])

  useEffect(() => {
    const cleanup = initTerminal()
    return cleanup
  }, [initTerminal])

  const handleClear = () => {
    xtermRef.current?.clear()
    if (connected) {
      xtermRef.current?.writeln('\x1b[32m  Terminal cleared.\x1b[0m')
      xtermRef.current?.writeln('')
      xtermRef.current?.write('\x1b[36m\u276f \x1b[0m')
    }
  }

  return (
    <div className="flex h-full flex-col border border-border-subtle bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-layer px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center border border-border-subtle bg-background">
            <TerminalIcon className="h-3.5 w-3.5 text-interactive" />
          </div>
          <div>
            <span className="text-xs font-semibold text-text-primary">Sandbox Terminal</span>
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait">
                {connected ? (
                  <motion.div
                    key="connected"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1"
                  >
                    <Wifi className="h-2.5 w-2.5 text-support-success" />
                    <span className="text-[10px] text-support-success">Connected</span>
                  </motion.div>
                ) : connecting ? (
                  <motion.div
                    key="connecting"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1"
                  >
                    <RefreshCw className="h-2.5 w-2.5 animate-spin text-support-warning" />
                    <span className="text-[10px] text-support-warning">Connecting...</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="offline"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1"
                  >
                    <WifiOff className="h-2.5 w-2.5 text-support-error" />
                    <span className="text-[10px] text-support-error">Offline</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {commandCount > 0 && (
                <span className="text-[10px] text-text-helper">
                  {commandCount} command{commandCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => xtermRef.current?.scrollToTop()}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll to top"
          >
            <ArrowUpToLine className="h-3 w-3" />
          </button>
          <button
            onClick={() => xtermRef.current?.scrollLines(-5)}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll up"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={() => xtermRef.current?.scrollLines(5)}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll down"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            onClick={() => xtermRef.current?.scrollToBottom()}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll to bottom"
          >
            <ArrowDownToLine className="h-3 w-3" />
          </button>
          <div className="mx-1 h-3 w-px bg-border-subtle" />
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
              title={isMaximized ? 'Minimize terminal' : 'Maximize terminal'}
            >
              {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
          )}
          <button
            onClick={handleClear}
            className="flex items-center gap-1 p-1.5 text-[11px] text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Clear terminal"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
          {!connected && (
            <button
              onClick={() => {
                setReconnectKey((k) => k + 1)
                setConnecting(true)
              }}
              className="ml-1 flex items-center gap-1 border border-interactive/30 bg-interactive/10 px-2 py-1 text-[11px] text-interactive transition-colors hover:bg-interactive/20"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {lastError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 border-b border-border-subtle bg-support-error/10 px-4 py-1.5 text-[11px] text-support-error">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {lastError}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info banner */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-layer/50 px-4 py-1">
        <Shield className="h-2.5 w-2.5 text-text-helper" />
        <span className="text-[10px] text-text-helper">
          Commands run in an isolated Ubuntu environment via proot.
        </span>
      </div>

      {/* Terminal Area */}
      <div
        ref={containerRef}
        className="relative flex-1"
        style={{ minHeight: 0 }}
      />
    </div>
  )
}
