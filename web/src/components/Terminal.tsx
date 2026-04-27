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
} from 'lucide-react'

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [commandCount, setCommandCount] = useState(0)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [lastError, setLastError] = useState('')

  const initTerminal = useCallback(() => {
    if (!containerRef.current) return

    containerRef.current.innerHTML = ''
    setConnecting(true)
    setLastError('')

    const term = new XTerm({
      theme: {
        background: '#0f0f0f',
        foreground: '#c6c6c6',
        cursor: '#0f62fe',
        selectionBackground: 'rgba(15, 98, 254, 0.3)',
        black: '#161616',
        red: '#ff6b6b',
        green: '#24a148',
        yellow: '#f1c21b',
        blue: '#78a9ff',
        magenta: '#be95ff',
        cyan: '#33b1ff',
        white: '#f4f4f4',
        brightBlack: '#525252',
        brightRed: '#ff8d8d',
        brightGreen: '#42be65',
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

    xtermRef.current = term

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/terminal`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setConnecting(false)
      setLastError('')
      term.writeln('')
      term.writeln('\x1b[1;34m  Carbon AI Sandbox Terminal\x1b[0m')
      term.writeln('\x1b[90m  ───────────────────────────\x1b[0m')
      term.writeln('\x1b[32m  Connected to sandboxed environment.\x1b[0m')
      term.writeln('\x1b[90m  Type commands and press Enter to execute.\x1b[0m')
      term.writeln('\x1b[90m  Commands run in an isolated container with limited resources.\x1b[0m')
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

  const handleClear = () => {
    xtermRef.current?.clear()
    if (connected) {
      xtermRef.current?.writeln('\x1b[32m  Terminal cleared.\x1b[0m')
      xtermRef.current?.writeln('')
      xtermRef.current?.write('\x1b[36m\u276f \x1b[0m')
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0f0f0f] rounded-xl overflow-hidden border border-[#2a2a2a]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0f62fe]/10">
            <TerminalIcon className="h-3.5 w-3.5 text-[#0f62fe]" />
          </div>
          <div>
            <span className="text-xs font-semibold text-white">Sandbox Terminal</span>
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
                    <Wifi className="h-3 w-3 text-[#24a148]" />
                    <span className="text-[10px] text-[#24a148]">Connected</span>
                  </motion.div>
                ) : connecting ? (
                  <motion.div
                    key="connecting"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3 animate-spin text-[#f1c21b]" />
                    <span className="text-[10px] text-[#f1c21b]">Connecting...</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="offline"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1"
                  >
                    <WifiOff className="h-3 w-3 text-[#da1e28]" />
                    <span className="text-[10px] text-[#da1e28]">Offline</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {commandCount > 0 && (
                <span className="text-[10px] text-[#525252]">
                  {commandCount} command{commandCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
            title="Clear terminal"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </motion.button>
          {!connected && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setReconnectKey((k) => k + 1)
                setConnecting(true)
              }}
              className="flex items-center gap-1.5 rounded-lg bg-[#0f62fe]/10 px-2.5 py-1.5 text-[11px] text-[#0f62fe] transition-all hover:bg-[#0f62fe]/20"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </motion.button>
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
            <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#da1e28]/10 px-4 py-2 text-[11px] text-[#da1e28]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {lastError}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info banner */}
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#1a1a1a]/50 px-4 py-1.5">
        <Shield className="h-3 w-3 text-[#525252]" />
        <span className="text-[10px] text-[#525252]">
          Commands run in an isolated sandbox with CPU, memory, and network restrictions.
        </span>
      </div>

      {/* Terminal Area */}
      <div ref={containerRef} className="flex-1 p-3" />
    </div>
  )
}
