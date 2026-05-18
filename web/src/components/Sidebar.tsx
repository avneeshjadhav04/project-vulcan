import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { SelectedModel } from './ProviderModelSelector'
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
  provider_id: string
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
  selectedModel: SelectedModel
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
    mutationFn: async (selection: SelectedModel) => {
      const res = await api.post('/chats', {
        title: 'New Chat',
        model_id: selection.modelId,
        provider_id: selection.providerId || undefined,
      })
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

  const parseTags = (tagsJson: string): string[] => {
    try {
      return JSON.parse(tagsJson)
    } catch {
      return []
    }
  }

  const activeChats = chats?.filter(c => !c.is_archived) || []
  const archivedChats = chats?.filter(c => c.is_archived) || []
  const pinnedChats = activeChats.filter(c => c.is_pinned)
  const unpinnedChats = activeChats.filter(c => !c.is_pinned)

  const folderGroups = unpinnedChats.reduce((acc, chat) => {
    const folder = chat.folder || 'default'
    if (!acc[folder]) acc[folder] = []
    acc[folder].push(chat)
    return acc
  }, {} as Record<string, ChatItem[]>)

  const renderChatItem = (chat: ChatItem) => (
    <div
      key={chat.id}
      className={`group flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm transition-colors ${
        activeChatId === chat.id
          ? 'bg-interactive/10 border-l-2 border-interactive'
          : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
      }`}
      onClick={() => navigate(`/chat/${chat.id}`)}
    >
      <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${activeChatId === chat.id ? 'text-interactive' : ''}`} />
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
            className="w-full bg-transparent text-xs font-medium text-text-primary outline-none"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              {chat.is_pinned === 1 && <Pin className="h-2.5 w-2.5 text-support-warning" />}
              <p className={`truncate text-xs font-medium ${activeChatId === chat.id ? 'text-text-primary' : ''}`}>
                {chat.title}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex items-center gap-1 truncate text-[10px] text-text-helper">
                <Clock className="h-2.5 w-2.5" />
                {new Date(chat.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              {parseTags(chat.tags).map(tag => (
                <span key={tag} className="bg-interactive/10 px-1 py-0.5 text-[9px] text-interactive">
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
          className="p-1 text-text-helper transition-colors hover:text-support-warning"
          title={chat.is_pinned ? 'Unpin' : 'Pin'}
        >
          <Star className={`h-3 w-3 ${chat.is_pinned ? 'fill-support-warning text-support-warning' : ''}`} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            startEdit(chat)
          }}
          className="p-1 text-text-helper transition-colors hover:text-interactive"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => toggleArchive(chat, e)}
          className="p-1 text-text-helper transition-colors hover:text-link-primary"
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
          className="p-1 text-text-helper transition-colors hover:text-support-error"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-2.5 py-1.5 text-[11px] text-support-error">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Chat Button */}
      <button
        onClick={() => {
          if (!selectedModel.providerId) {
            showError('Please select a model from the dropdown first')
            return
          }
          createChat.mutate(selectedModel)
        }}
        disabled={createChat.isPending}
        className="flex w-full items-center justify-center gap-2 border border-border-subtle bg-layer py-2 text-sm text-text-primary transition-colors hover:border-border-strong hover:bg-layer-hover disabled:opacity-50"
      >
        <Plus className="h-4 w-4 text-interactive" />
        New Chat
      </button>

      {/* Pinned Chats */}
      {pinnedChats.length > 0 && (
        <div className="space-y-px">
          <div className="flex items-center gap-1.5 px-2.5 py-1">
            <Pin className="h-3 w-3 text-support-warning" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">Pinned</span>
          </div>
          {pinnedChats.map(renderChatItem)}
        </div>
      )}

      {/* Folder Groups */}
      <div className="space-y-px">
        {Object.entries(folderGroups).map(([folder, folderChats]) => (
          <div key={folder}>
            <button
              onClick={() => toggleFolder(folder)}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left"
            >
              {expandedFolders.has(folder) ? (
                <ChevronDown className="h-3 w-3 text-text-helper" />
              ) : (
                <ChevronRight className="h-3 w-3 text-text-helper" />
              )}
              <Folder className="h-3 w-3 text-text-helper" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                {folder === 'default' ? 'Chats' : folder}
              </span>
              <span className="ml-auto text-[10px] text-text-helper">{folderChats.length}</span>
            </button>
            <AnimatePresence>
              {expandedFolders.has(folder) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-px overflow-hidden"
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
            className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left"
          >
            {showArchived ? (
              <ChevronDown className="h-3 w-3 text-text-helper" />
            ) : (
              <ChevronRight className="h-3 w-3 text-text-helper" />
            )}
            <Archive className="h-3 w-3 text-text-helper" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">Archived</span>
            <span className="ml-auto text-[10px] text-text-helper">{archivedChats.length}</span>
          </button>
          <AnimatePresence>
            {showArchived && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-px overflow-hidden opacity-60"
              >
                {archivedChats.map(renderChatItem)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {(!chats || chats.length === 0) && (
        <div className="py-8 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-border-subtle" />
          <p className="text-xs text-text-helper">No chats yet</p>
          <p className="mt-1 text-[10px] text-text-helper/70">Click &quot;New Chat&quot; to start</p>
        </div>
      )}
    </div>
  )
}
