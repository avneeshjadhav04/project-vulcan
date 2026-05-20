import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, FileJson, FileText } from 'lucide-react'

interface ChatHeaderProps {
  title?: string
  optimisticTitle?: string
  chatId?: string
}

export default function ChatHeader({ title, optimisticTitle, chatId }: ChatHeaderProps) {
  const [showExportMenu, setShowExportMenu] = useState(false)
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

  return (
    <header className="flex items-center justify-between border-b border-border-subtle bg-background px-5 py-2.5">
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
              aria-label="Export chat"
              aria-expanded={showExportMenu}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export
            </button>
            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full z-50 mt-1 w-36 border border-border-subtle bg-layer shadow-lg"
                >
                  <button
                    onClick={() => {
                      window.open(`/api/chats/${chatId}/export?format=markdown`, '_blank')
                      setShowExportMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    Markdown
                  </button>
                  <button
                    onClick={() => {
                      window.open(`/api/chats/${chatId}/export?format=json`, '_blank')
                      setShowExportMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  >
                    <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                    JSON
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
