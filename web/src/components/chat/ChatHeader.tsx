import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, FileJson, FileText, Loader2 } from 'lucide-react'

interface ChatHeaderProps {
  title?: string
  optimisticTitle?: string
  chatId?: string
  sidebarOpen?: boolean
}

export default function ChatHeader({ title, optimisticTitle, chatId, sidebarOpen }: ChatHeaderProps) {
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (showExportMenu) {
      const firstBtn = exportRef.current?.querySelector('[role="menuitem"]')
      ;(firstBtn as HTMLElement)?.focus()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [showExportMenu])

  const handleExport = async (format: string) => {
    if (!chatId) return
    setExporting(format)
    setShowExportMenu(false)

    try {
      const res = await fetch(`/api/chats/${chatId}/export?format=${format}`, {
        credentials: 'include',
      })

      if (!res.ok) {
        throw new Error(`Export failed: ${res.status}`)
      }

      const blob = await res.blob()
      const contentType = res.headers.get('content-type') || 'text/plain'
      const contentDisposition = res.headers.get('content-disposition')
      let filename = `chat-export.${format === 'json' ? 'json' : 'md'}`

      // Extract filename from Content-Disposition header if present
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/)
        if (match) {
          filename = match[1]
        }
      }

      const url = window.URL.createObjectURL(new Blob([blob], { type: contentType }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      alert('Export failed. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <header className={`relative z-10 flex items-center justify-between border-b border-border-subtle bg-background/80 px-6 py-4 backdrop-blur-md ${sidebarOpen === false ? 'pl-32' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="truncate text-xs font-semibold text-text-primary">
          {title || optimisticTitle || 'New Chat'}
        </h2>
      </div>
      <div className="flex items-center gap-1">
        {chatId && (
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!!exporting}
              aria-label="Export chat"
              aria-expanded={showExportMenu}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-40"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {exporting ? 'Exporting...' : 'Export'}
            </button>
            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-carbon border border-border-subtle bg-layer/90 shadow-xl backdrop-blur-md"
                >
                  <button
                    onClick={() => handleExport('markdown')}
                    disabled={exporting === 'markdown'}
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-40"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {exporting === 'markdown' ? 'Exporting...' : 'Markdown'}
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    disabled={exporting === 'json'}
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-40"
                  >
                    <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                    {exporting === 'json' ? 'Exporting...' : 'JSON'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </header>
  )
}
