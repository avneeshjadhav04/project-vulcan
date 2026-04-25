import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Plus, Trash2, MessageSquare, Clock } from 'lucide-react'
import { motion } from 'framer-motion'

interface ChatItem {
  id: string
  title: string
  model_id: string
  updated_at: string
}

export default function Sidebar({
  activeChatId,
  onSelect,
  selectedModel,
}: {
  activeChatId: string | null
  onSelect: (id: string) => void
  selectedModel: string
}) {
  const queryClient = useQueryClient()

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
      onSelect(data.id)
    },
  })

  const deleteChat = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chats/${id}`)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  })

  return (
    <div className="space-y-3">
      <button
        onClick={() => createChat.mutate(selectedModel)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background py-2.5 text-sm font-medium text-text-primary transition-all hover:border-accent/50 hover:bg-surface-hover"
      >
        <Plus className="h-4 w-4" />
        New Chat
      </button>

      <div className="space-y-0.5">
        {chats?.map((chat, index) => (
          <motion.div
            key={chat.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onSelect(chat.id)}
            className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all ${
              activeChatId === chat.id
                ? 'bg-accent/10 text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${activeChatId === chat.id ? 'text-accent' : ''}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{chat.title}</p>
              <p className="flex items-center gap-1 truncate text-[10px] text-text-secondary/70">
                <Clock className="h-2.5 w-2.5" />
                {new Date(chat.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteChat.mutate(chat.id)
              }}
              className="opacity-0 rounded p-1 text-text-secondary transition-all hover:bg-error/10 hover:text-error group-hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </motion.div>
        ))}

        {(!chats || chats.length === 0) && (
          <div className="py-8 text-center text-xs text-text-secondary">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-20" />
            No chats yet
          </div>
        )}
      </div>
    </div>
  )
}
