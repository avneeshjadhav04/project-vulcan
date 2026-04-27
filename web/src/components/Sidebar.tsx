import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Plus, Trash2, MessageSquare, Clock, Pencil, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ChatItem {
  id: string
  title: string
  model_id: string
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

  const renameChat = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await api.patch(`/chats/${id}`, { title })
      return res.data as ChatItem
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      setEditingId(null)
      setEditTitle('')
    },
    onError: (err: any) => {
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to rename chat')
      setEditingId(null)
    },
  })

  const startEdit = (chat: ChatItem) => {
    setEditingId(chat.id)
    setEditTitle(chat.title)
  }

  const submitRename = () => {
    if (editingId && editTitle.trim()) {
      renameChat.mutate({ id: editingId, title: editTitle.trim() })
    } else {
      setEditingId(null)
    }
  }

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

      {/* Chat List */}
      <div className="space-y-0.5">
        {chats?.map((chat, index) => (
          <motion.div
            key={chat.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.03 }}
            onClick={() => navigate(`/chat/${chat.id}`)}
            className={`group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all ${
              activeChatId === chat.id
                ? 'bg-gradient-to-r from-[#0f62fe]/15 to-transparent border border-[#0f62fe]/20'
                : 'text-[#525252] hover:bg-[#1a1a1a] hover:text-white'
            }`}
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
                  <p className={`truncate text-xs font-medium ${activeChatId === chat.id ? 'text-white' : ''}`}>
                    {chat.title}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[10px] text-[#525252]">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(chat.updated_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
        ))}

        {(!chats || chats.length === 0) && (
          <div className="py-8 text-center">
            <MessageSquare className="mx-auto mb-3 h-10 w-10 text-[#2a2a2a]" />
            <p className="text-xs text-[#525252]">No chats yet</p>
            <p className="mt-1 text-[10px] text-[#525252]/70">Click "New Chat" to start</p>
          </div>
        )}
      </div>
    </div>
  )
}
