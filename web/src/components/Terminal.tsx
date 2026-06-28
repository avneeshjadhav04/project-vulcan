import { useEffect, useRef, useState, useCallback } from 'react'
import 'xterm/css/xterm.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  RefreshCw,
  Terminal as TerminalIcon,
  Trash2,
  WifiOff,
  Wifi,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react'
import { useThemeStore } from '../stores/themeStore'
import { ShellClient } from '../lib/shellClient'
import type { ITheme } from 'xterm'

interface TerminalTab {
  id: string
  name: string
  shell?: ShellClient
  connected: boolean
  running: boolean
  cwd: string
  pid: number
}

export default function Terminal({
  isMaximized = false,
  onToggleMaximize,
}: {
  isMaximized?: boolean
  onToggleMaximize?: () => void
}) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const saved = localStorage.getItem('terminalTabs')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((id: string, idx: number) => ({
            id,
            name: `bash ${idx + 1}`,
            connected: false,
            running: false,
            cwd: '/workspace',
            pid: 0,
          }))
        }
      } catch {
        // ignore
      }
    }
    return [{ id: crypto.randomUUID(), name: 'bash 1', connected: false, running: false, cwd: '/workspace', pid: 0 }]
  })

  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '')
  const [tabCounter, setTabCounter] = useState(() => tabs.length + 1)
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)

  const darkTheme: ITheme = {
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
  }

  const lightTheme: ITheme = {
    background: '#eceef2',
    foreground: '#2a3441',
    cursor: '#0f62fe',
    selectionBackground: 'rgba(15, 98, 254, 0.2)',
    black: '#2a3441',
    red: '#b91c1c',
    green: '#166534',
    yellow: '#9a4f0b',
    blue: '#0f62fe',
    magenta: '#6d4d8c',
    cyan: '#2563eb',
    white: '#f3f4f7',
    brightBlack: '#525b69',
    brightRed: '#c2410c',
    brightGreen: '#15803d',
    brightYellow: '#b45309',
    brightBlue: '#4589ff',
    brightMagenta: '#7c5d9c',
    brightCyan: '#3b82f6',
    brightWhite: '#f7f8f9',
  }

  const theme = resolvedTheme === 'light' ? lightTheme : darkTheme

  // Persist tab IDs.
  useEffect(() => {
    localStorage.setItem('terminalTabs', JSON.stringify(tabs.map((t) => t.id)))
  }, [tabs])

  const updateTab = useCallback((tabId: string, updates: Partial<TerminalTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)))
  }, [])

  const attachShell = useCallback(
    (tab: TerminalTab) => {
      const container = containerRefs.current[tab.id]
      if (!container || tab.shell) return

      const shell = new ShellClient({
        tabId: tab.id,
        container,
        theme,
        onConnectedChange: (connected) => updateTab(tab.id, { connected }),
        onRunningChange: (running) => updateTab(tab.id, { running }),
        onCwdChange: (cwd) => updateTab(tab.id, { cwd }),
      })

      shell.connect()
      updateTab(tab.id, { shell })
    },
    [theme, updateTab]
  )

  // Initialize shells for visible tabs on first mount.
  useEffect(() => {
    tabs.forEach((tab) => {
      if (!tab.shell) {
        setTimeout(() => attachShell(tab), 0)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-attach shell when theme changes for all tabs.
  useEffect(() => {
    tabs.forEach((tab) => tab.shell?.updateTheme(theme))
  }, [theme, tabs])

  // Focus active tab's terminal when switching.
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.shell) {
      setTimeout(() => {
        activeTab.shell?.fit()
        activeTab.shell?.focus()
      }, 50)
    }
  }, [activeTabId, tabs])

  const addTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: crypto.randomUUID(),
      name: `bash ${tabCounter}`,
      connected: false,
      running: false,
      cwd: '/workspace',
      pid: 0,
    }
    setTabCounter((c) => c + 1)
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    setTimeout(() => attachShell(newTab), 0)
  }, [tabCounter, attachShell])

  const closeTab = useCallback(
    (tabId: string, e?: React.MouseEvent) => {
      e?.stopPropagation()
      const tab = tabs.find((t) => t.id === tabId)
      tab?.shell?.disconnect()

      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId)
        if (next.length === 0) {
          // Always keep at least one tab.
          const fresh: TerminalTab = {
            id: crypto.randomUUID(),
            name: 'bash 1',
            connected: false,
            running: false,
            cwd: '/workspace',
            pid: 0,
          }
          setTabCounter(2)
          setActiveTabId(fresh.id)
          setTimeout(() => attachShell(fresh), 0)
          return [fresh]
        }
        if (activeTabId === tabId) {
          setActiveTabId(next[0].id)
        }
        return next
      })
    },
    [tabs, activeTabId, attachShell]
  )

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const handleClear = () => {
    activeTab?.shell?.clear()
  }

  const handleReconnect = () => {
    activeTab?.shell?.disconnect()
    setTimeout(() => {
      const container = containerRefs.current[activeTabId]
      if (!container) return
      const shell = new ShellClient({
        tabId: activeTabId,
        container,
        theme,
        onConnectedChange: (connected) => updateTab(activeTabId, { connected }),
        onRunningChange: (running) => updateTab(activeTabId, { running }),
        onCwdChange: (cwd) => updateTab(activeTabId, { cwd }),
      })
      shell.connect()
      updateTab(activeTabId, { shell })
      setTimeout(() => shell.focus(), 50)
    }, 0)
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
                {activeTab?.connected ? (
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
              {activeTab?.running && (
                <span className="text-[10px] text-support-warning">Running…</span>
              )}
              {activeTab && activeTab.cwd !== '/workspace' && (
                <span className="max-w-[160px] truncate text-[10px] text-text-helper">
                  {activeTab.cwd}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => activeTab?.shell?.scrollToTop()}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll to top"
          >
            <ArrowUpToLine className="h-3 w-3" />
          </button>
          <button
            onClick={() => activeTab?.shell?.scrollLines(-5)}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll up"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={() => activeTab?.shell?.scrollLines(5)}
            className="p-1.5 text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
            title="Scroll down"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            onClick={() => activeTab?.shell?.scrollToBottom()}
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
          {!activeTab?.connected && (
            <button
              onClick={handleReconnect}
              className="ml-1 flex items-center gap-1 border border-interactive/30 bg-interactive/10 px-2 py-1 text-[11px] text-interactive transition-colors hover:bg-interactive/20"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border-subtle bg-layer/50 px-2 py-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => {
              setActiveTabId(tab.id)
              if (!tab.shell) {
                setTimeout(() => attachShell(tab), 0)
              }
            }}
            title={tab.pid > 0 ? `PID: ${tab.pid}` : `Shell ${tab.name}`}
            className={`group flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors ${
              tab.id === activeTabId
                ? 'bg-background text-text-primary'
                : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
            }`}
          >
            <span className="truncate">{tab.name}</span>
            {tab.running && (
              <RefreshCw className="h-2.5 w-2.5 animate-spin text-support-warning" />
            )}
            {tabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="ml-1 rounded p-0.5 text-text-helper opacity-0 transition-opacity hover:bg-support-error/10 hover:text-support-error group-hover:opacity-100"
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="flex h-6 w-6 items-center justify-center rounded text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
          title="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Terminal Areas */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => (containerRefs.current[tab.id] = el)}
            onClick={() => tab.shell?.focus()}
            className={`absolute inset-0 ${tab.id === activeTabId ? 'z-10' : 'z-0 opacity-0 pointer-events-none'}`}
            style={{ minHeight: 0 }}
          />
        ))}
      </div>
    </div>
  )
}
