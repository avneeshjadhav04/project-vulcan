import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Search, MessageSquare, X, Hash } from 'lucide-react'
import { api } from '../lib/api'
import DOMPurify from 'dompurify'

interface SearchResult {
  chat_id: string
  chat_title: string
  message_id: string
  role: string
  content: string
  created_at: string
}

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setDebouncedQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ['search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery) return []
      const res = await api.get(`/search?q=${encodeURIComponent(debouncedQuery)}`)
      return res.data.results || []
    },
    enabled: isOpen && debouncedQuery.length > 0,
  })

  const items = results || []

  const handleSelect = useCallback((chatId: string, messageId?: string) => {
    navigate(`/chat/${chatId}`)
    setIsOpen(false)
    if (messageId) {
      setTimeout(() => {
        const el = document.getElementById(`msg-${messageId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
    }
  }, [navigate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(items.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selectedIndex]
      if (item) handleSelect(item.chat_id, item.message_id)
    }
  }, [items, selectedIndex, handleSelect])

  useEffect(() => {
    setSelectedIndex(0)
  }, [debouncedQuery])

  if (!isOpen) return null

  const highlightMatch = (text: string, q: string) => {
    if (!q) return text
    const clean = DOMPurify.sanitize(text)
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return clean.replace(regex, '<mark class="bg-interactive/30 text-text-primary px-0.5 rounded">$1</mark>')
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-border-subtle bg-layer shadow-2xl"
        >
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-4">
            <Search className="h-5 w-5 text-text-helper" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search messages across all chats..."
              className="flex-1 bg-transparent text-lg text-text-primary placeholder:text-text-helper outline-none"
              aria-label="Search messages"
            />
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-text-helper hover:bg-layer-hover hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {!debouncedQuery && (
              <div className="py-8 text-center text-sm text-text-helper">
                Type to search across all your conversations
              </div>
            )}

            {debouncedQuery && isLoading && (
              <div className="py-8 text-center">
                <div className="h-5 w-5 animate-spin border-2 border-interactive border-t-transparent mx-auto" />
                <p className="mt-2 text-xs text-text-helper">Searching...</p>
              </div>
            )}

            {debouncedQuery && !isLoading && items.length === 0 && (
              <div className="py-8 text-center text-sm text-text-helper">
                No results found for "{debouncedQuery}"
              </div>
            )}

            <div className="flex flex-col gap-1">
              {items.map((item, idx) => (
                <button
                  key={`${item.chat_id}-${item.message_id}-${idx}`}
                  onClick={() => handleSelect(item.chat_id, item.message_id)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`group flex w-full flex-col rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selectedIndex === idx ? 'bg-layer-hover' : 'hover:bg-layer-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="h-3.5 w-3.5 text-text-helper" />
                    <span className="text-xs font-medium text-text-primary truncate">{item.chat_title}</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-text-helper">
                      <Hash className="h-2.5 w-2.5" />
                      {item.role}
                    </span>
                  </div>
                  <p
                    className="text-sm text-text-secondary line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: highlightMatch(item.content, debouncedQuery) }}
                  />
                  <span className="text-[10px] text-text-helper mt-0.5">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border-subtle bg-layer-hover px-4 py-2 text-xs text-text-helper flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">↑↓</kbd> to navigate</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">↵</kbd> to open</span>
            </div>
            <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">esc</kbd> to close</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
