import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MoreHorizontal,
  Pin,
  Pencil,
  Archive,
  Trash2,
  FileText,
  FileJson,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useChatExport } from '../../hooks/useChatExport'

interface ChatHeaderProps {
  title?: string
  optimisticTitle?: string
  chatId?: string
  sidebarOpen?: boolean
  isPinned?: boolean
  isArchived?: boolean
  onTogglePin?: () => void
  onToggleArchive?: () => void
  onRename?: (newTitle: string) => void
  onDelete?: () => void
}

export default function ChatHeader({
  title,
  optimisticTitle,
  chatId,
  sidebarOpen,
  isPinned,
  isArchived,
  onTogglePin,
  onToggleArchive,
  onRename,
  onDelete,
}: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showExportSubmenu, setShowExportSubmenu] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(title || '')
  const [pendingDelete, setPendingDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { exporting, exportChat } = useChatExport(chatId)

  useEffect(() => {
    setRenameValue(title || '')
  }, [title])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowExportSubmenu(false)
        setPendingDelete(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowMenu(false)
        setShowExportSubmenu(false)
        setPendingDelete(false)
        if (isRenaming) {
          setIsRenaming(false)
          setRenameValue(title || '')
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isRenaming, title])

  const handleExport = (format: string) => {
    exportChat(format)
    setShowExportSubmenu(false)
    setShowMenu(false)
  }

  const submitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== title && onRename) {
      onRename(trimmed)
    }
    setIsRenaming(false)
  }

  const startRename = () => {
    setRenameValue(title || '')
    setIsRenaming(true)
    setShowMenu(false)
  }

  const handleDeleteClick = () => {
    if (pendingDelete) {
      onDelete?.()
      setShowMenu(false)
      setPendingDelete(false)
    } else {
      setPendingDelete(true)
    }
  }

  const displayTitle = title || optimisticTitle || 'New Chat'

  return (
    <header
      className={`relative z-10 flex items-center justify-between border-b border-border-subtle bg-background/80 px-4 py-2.5 backdrop-blur-md ${
        sidebarOpen === false ? 'pl-32' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') {
                setIsRenaming(false)
                setRenameValue(title || '')
              }
            }}
            onBlur={submitRename}
            className="w-full max-w-md border border-border-subtle bg-background px-2 py-1 text-xs font-semibold text-text-primary outline-none focus:border-interactive focus:ring-1 focus:ring-focus"
          />
        ) : (
          <h2 className="truncate text-xs font-semibold text-text-primary">{displayTitle}</h2>
        )}
      </div>

      {chatId && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => {
              setShowMenu(!showMenu)
              setShowExportSubmenu(false)
              setPendingDelete(false)
            }}
            aria-label="Chat actions"
            aria-expanded={showMenu}
            className="p-1.5 text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 top-full z-50 mt-1 w-44 rounded-carbon border border-border-subtle bg-layer shadow-xl"
              >
                <button
                  onClick={() => {
                    onTogglePin?.()
                    setShowMenu(false)
                    setPendingDelete(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                >
                  <Pin
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isPinned ? 'fill-support-warning text-support-warning' : 'text-support-warning'
                    }`}
                  />
                  <span>{isPinned ? 'Unpin' : 'Pin'}</span>
                </button>

                <button
                  onClick={startRename}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-interactive" />
                  <span>Rename</span>
                </button>

                <button
                  onClick={() => setShowExportSubmenu(true)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                >
                  <span className="flex items-center gap-2">
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-text-helper" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-text-helper" />
                    )}
                    <span>{exporting ? 'Exporting...' : 'Export'}</span>
                  </span>
                  <ChevronRight className="h-3 w-3 text-text-helper" />
                </button>

                <button
                  onClick={() => {
                    onToggleArchive?.()
                    setShowMenu(false)
                    setPendingDelete(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                >
                  <Archive className="h-3.5 w-3.5 shrink-0 text-link-primary" />
                  <span>{isArchived ? 'Unarchive' : 'Archive'}</span>
                </button>

                <button
                  onClick={handleDeleteClick}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                    pendingDelete
                      ? 'font-medium text-support-error hover:bg-support-error/10'
                      : 'text-text-secondary hover:bg-layer-hover hover:text-support-error'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0 text-support-error" />
                  <span>{pendingDelete ? 'Confirm Delete?' : 'Delete'}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showExportSubmenu && showMenu && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                className="absolute right-full top-0 z-50 mr-1 w-36 rounded-carbon border border-border-subtle bg-layer shadow-xl"
              >
                <button
                  onClick={() => handleExport('markdown')}
                  disabled={exporting === 'markdown'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary disabled:opacity-40"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>{exporting === 'markdown' ? 'Exporting...' : 'Markdown'}</span>
                </button>
                <button
                  onClick={() => handleExport('json')}
                  disabled={exporting === 'json'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary disabled:opacity-40"
                >
                  <FileJson className="h-3.5 w-3.5 shrink-0" />
                  <span>{exporting === 'json' ? 'Exporting...' : 'JSON'}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </header>
  )
}
