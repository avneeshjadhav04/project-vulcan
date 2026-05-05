import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import {
  Plus,
  Trash2,
  MessageSquare,
  Clock,
  Pencil,
  AlertCircle,
  Pin,
  Archive,
  Folder,
  Star,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ChatItem {
  id: string
  title: string
  model_id: string
  folder: string
  tags: string
  is_pinned: number
  is_archived: number
  updated_at: string
}

export default function Sidebar({
  activeChatId,
  selectedModel,
}: {
  activeChatId: string | null
  selectedModel: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['default']))

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(''), 4000)
  }

  const { data: chats } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => {
      const res = await api.get('/chats')
      return res.data as ChatItem[]
    },
  })

  const createChat = useMutation({
    mutationFn: async (modelId: string) => {
      const res = await api.post('/chats', { title: 'New Chat', model_id: modelId })
      return res.data as ChatItem
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      navigate(`/chat/${data.id}`)
    },
    onError: (err: any) => {
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to create chat')
    },
  })

  const deleteChat = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chats/${id}`)
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      if (activeChatId === deletedId) {
        navigate('/chat')
      }
    },
    onError: (err: any) => {
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to delete chat')
    },
  })

  const updateChat = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await api.patch(`/chats/${id}`, updates)
      return res.data as ChatItem
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      setEditingId(null)
      setEditTitle('')
    },
    onError: (err: any) => {
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to update chat')
      setEditingId(null)
    },
  })

  const startEdit = (chat: ChatItem) => {
    setEditingId(chat.id)
    setEditTitle(chat.title)
  }

  const submitRename = () => {
    if (editingId && editTitle.trim()) {
      updateChat.mutate({ id: editingId, updates: { title: editTitle.trim() } })
    } else {
      setEditingId(null)
    }
  }

  const togglePin = (chat: ChatItem, e: React.MouseEvent) => {
    e.stopPropagation()
    updateChat.mutate({ id: chat.id, updates: { is_pinned: !chat.is_pinned } })
  }

  const toggleArchive = (chat: ChatItem, e: React.MouseEvent) => {
    e.stopPropagation()
    updateChat.mutate({ id: chat.id, updates: { is_archived: !chat.is_archived } })
  }

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  // Parse tags from JSON string
  const parseTags = (tagsJson: string): string[] => {
    try {
      return JSON.parse(tagsJson)
    } catch {
      return []
    }
  }

  // Group chats
  const activeChats = chats?.filter(c => !c.is_archived) || []
  const archivedChats = chats?.filter(c => c.is_archived) || []
  const pinnedChats = activeChats.filter(c => c.is_pinned)
  const unpinnedChats = activeChats.filter(c => !c.is_pinned)

  // Group unpinned chats by folder
  const folderGroups = unpinnedChats.reduce((acc, chat) => {
    const folder = chat.folder || 'default'
    if (!acc[folder]) acc[folder] = []
    acc[folder].push(chat)
    return acc
  }, {} as Record<string, ChatItem[]>)

  const renderChatItem = (chat: ChatItem) => (
    <motion.div
      key={chat.id}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all ${
        activeChatId === chat.id
          ? 'bg-gradient-to-r from-[#0f62fe]/15 to-transparent border border-[#0f62fe]/20'
          : 'text-[#525252] hover:bg-[#1a1a1a] hover:text-white'
      }`}
      onClick={() => navigate(`/chat/${chat.id}`)}
    >
      <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${activeChatId === chat.id ? 'text-[#0f62fe]' : ''}`} />
      <div className="min-w-0 flex-1">
        {editingId === chat.id ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setEditingId(null)
            }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-xs font-medium text-white outline-none"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              {chat.is_pinned === 1 && <Pin className="h-2.5 w-2.5 text-[#f1c21b]" />}
              <p className={`truncate text-xs font-medium ${activeChatId === chat.id ? 'text-white' : ''}`}>
                {chat.title}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex items-center gap-1 truncate text-[10px] text-[#525252]">
                <Clock className="h-2.5 w-2.5" />
                {new Date(chat.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              {parseTags(chat.tags).map(tag => (
                <span key={tag} className="rounded bg-[#0f62fe]/10 px-1 py-0.5 text-[9px] text-[#0f62fe]">
                  {tag}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => togglePin(chat, e)}
          className="rounded-lg p-1.5 text-[#525252] transition-all hover:bg-[#f1c21b]/10 hover:text-[#f1c21b]"
          title={chat.is_pinned ? 'Unpin' : 'Pin'}
        >
          <Star className={`h-3 w-3 ${chat.is_pinned ? 'fill-[#f1c21b] text-[#f1c21b]' : ''}`} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            startEdit(chat)
          }}
          className="rounded-lg p-1.5 text-[#525252] transition-all hover:bg-[#0f62fe]/10 hover:text-[#0f62fe]"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => toggleArchive(chat, e)}
          className="rounded-lg p-1.5 text-[#525252] transition-all hover:bg-[#78a9ff]/10 hover:text-[#78a9ff]"
          title="Archive"
        >
          <Archive className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm('Delete this chat?')) {
              deleteChat.mutate(chat.id)
            }
          }}
          className="rounded-lg p-1.5 text-[#525252] transition-all hover:bg-[#da1e28]/10 hover:text-[#da1e28]"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </motion.div>
  )

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-xl border border-[#da1e28]/30 bg-[#da1e28]/10 px-3 py-2 text-xs text-[#da1e28]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Chat Button */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => createChat.mutate(selectedModel)}
        disabled={createChat.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#1a1a1a] py-2.5 text-sm font-medium text-white transition-all hover:border-[#0f62fe]/50 hover:shadow-lg hover:shadow-[#0f62fe]/10 disabled:opacity-50"
      >
        <Plus className="h-4 w-4 text-[#0f62fe]" />
        New Chat
      </motion.button>

      {/* Pinned Chats */}
      {pinnedChats.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 px-3 py-1">
            <Pin className="h-3 w-3 text-[#f1c21b]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Pinned</span>
          </div>
          {pinnedChats.map(renderChatItem)}
        </div>
      )}

      {/* Folder Groups */}
      <div className="space-y-0.5">
        {Object.entries(folderGroups).map(([folder, folderChats]) => (
          <div key={folder}>
            <button
              onClick={() => toggleFolder(folder)}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left"
            >
              {expandedFolders.has(folder) ? (
                <ChevronDown className="h-3 w-3 text-[#525252]" />
              ) : (
                <ChevronRight className="h-3 w-3 text-[#525252]" />
              )}
              <Folder className="h-3 w-3 text-[#525252]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">
                {folder === 'default' ? 'Chats' : folder}
              </span>
              <span className="ml-auto text-[10px] text-[#525252]">{folderChats.length}</span>
            </button>
            <AnimatePresence>
              {expandedFolders.has(folder) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-0.5 overflow-hidden"
                >
                  {folderChats.map(renderChatItem)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* Archived */}
      {archivedChats.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex w-full items-center gap-1.5 px-3 py-1 text-left"
          >
            {showArchived ? (
              <ChevronDown className="h-3 w-3 text-[#525252]" />
            ) : (
              <ChevronRight className="h-3 w-3 text-[#525252]" />
            )}
            <Archive className="h-3 w-3 text-[#525252]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Archived</span>
            <span className="ml-auto text-[10px] text-[#525252]">{archivedChats.length}</span>
          </button>
          <AnimatePresence>
            {showArchived && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-0.5 overflow-hidden opacity-60"
              >
                {archivedChats.map(renderChatItem)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {(!chats || chats.length === 0) && (
        <div className="py-8 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-[#2a2a2a]" />
          <p className="text-xs text-[#525252]">No chats yet</p>
          <p className="mt-1 text-[10px] text-[#525252]/70">Click &quot;New Chat&quot; to start</p>
        </div>
      )}
    </div>
  )
}
