import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Search, MessageSquare, Plus, X } from 'lucide-react'
import { api } from '../lib/api'

interface Chat {
  id: string
  title: string
  folder: string
  tags: string
}

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data: chats } = useQuery<Chat[]>({
    queryKey: ['chats'],
    queryFn: async () => {
      const res = await api.get('/chats')
      return res.data
    },
    enabled: isOpen,
  })

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
      setSelectedIndex(0)
    }
  }, [isOpen])

  const filteredChats = chats?.filter(chat => 
    chat.title.toLowerCase().includes(query.toLowerCase()) || 
    chat.folder.toLowerCase().includes(query.toLowerCase())
  ) || []

  const items = [
    ...(query.length === 0 ? [{ type: 'action' as const, label: 'New Chat', id: 'new-chat' }] : []),
    ...filteredChats.map(chat => ({ type: 'chat' as const, ...chat })),
  ]

  const handleSelect = useCallback((item: typeof items[number]) => {
    if (item.type === 'action' && item.id === 'new-chat') {
      navigate('/chat')
    } else if (item.type === 'chat') {
      navigate(`/chat/${item.id}`)
    }
    setIsOpen(false)
  }, [navigate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selectedIndex]
      if (item) handleSelect(item)
    }
  }, [items, selectedIndex, handleSelect])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const el = listRef.current.children[selectedIndex] as HTMLElement
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-scrim backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-border-subtle bg-layer shadow-2xl"
        >
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-4">
            <Search className="h-5 w-5 text-text-helper" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search chats or type a command..."
              className="flex-1 bg-transparent text-lg text-text-primary placeholder:text-text-helper outline-none"
              aria-label="Search chats"
              aria-controls="command-palette-list"
              aria-activedescendant={items[selectedIndex] ? `cmd-item-${selectedIndex}` : undefined}
            />
            <button 
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-text-helper hover:bg-layer-hover hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div 
            id="command-palette-list"
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto p-2"
            role="listbox"
            aria-label="Search results"
          >
            {query.length === 0 && (
              <div className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-text-helper">
                Quick Actions
              </div>
            )}
            
            {query.length === 0 && (
              <button
                id="cmd-item-0"
                role="option"
                aria-selected={selectedIndex === 0}
                onClick={() => handleSelect(items[0])}
                onMouseEnter={() => setSelectedIndex(0)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                  selectedIndex === 0 ? 'bg-interactive/10 text-interactive' : 'text-text-secondary hover:bg-interactive/10 hover:text-interactive'
                }`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-interactive/10 text-interactive">
                  <Plus className="h-4 w-4" />
                </div>
                <span className="font-medium">New Chat</span>
              </button>
            )}

            {(query.length > 0 || filteredChats.length > 0) && (
              <div className="px-3 pb-2 pt-4 text-xs font-semibold uppercase tracking-wider text-text-helper">
                Chats
              </div>
            )}

            <div className="flex flex-col gap-1">
              {filteredChats.map((chat, idx) => {
                const itemIndex = query.length === 0 ? idx + 1 : idx
                return (
                  <button
                    key={chat.id}
                    id={`cmd-item-${itemIndex}`}
                    role="option"
                    aria-selected={selectedIndex === itemIndex}
                    onClick={() => handleSelect({ type: 'chat', ...chat })}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={`group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                      selectedIndex === itemIndex ? 'bg-layer-hover' : 'hover:bg-layer-hover'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare className={`h-4 w-4 ${selectedIndex === itemIndex ? 'text-text-primary' : 'text-text-helper group-hover:text-text-primary'}`} />
                      <span className={`text-sm font-medium ${selectedIndex === itemIndex ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                        {chat.title}
                      </span>
                    </div>
                    {chat.folder !== 'General' && (
                      <span className="rounded-full border border-border-subtle bg-layer px-2 py-0.5 text-[10px] text-text-helper">
                        {chat.folder}
                      </span>
                    )}
                  </button>
                )
              })}

              {query.length > 0 && filteredChats.length === 0 && (
                <div className="py-8 text-center text-sm text-text-helper">
                  No results found for "{query}"
                </div>
              )}
            </div>
          </div>
          
          <div className="border-t border-border-subtle bg-layer-hover px-4 py-2 text-xs text-text-helper flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">↑↓</kbd> to navigate</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">↵</kbd> to select</span>
            </div>
            <span className="flex items-center gap-1"><kbd className="rounded border border-border-subtle bg-layer px-1.5 font-mono">esc</kbd> to close</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
