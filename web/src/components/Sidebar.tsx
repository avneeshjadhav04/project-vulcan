import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Plus, Trash2 } from 'lucide-react'

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  })

  const deleteChat = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chats/${id}`)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  })

  return (
    <div className="space-y-2">
      <button
        onClick={() => createChat.mutate(selectedModel)}
        className="flex w-full items-center justify-center gap-2 border border-border bg-background py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
      >
        <Plus className="h-4 w-4" />
        New Chat
      </button>

      <div className="space-y-1">
        {chats?.map((chat) => (
          <div
            key={chat.id}
            onClick={() => onSelect(chat.id)}
            className={`group flex cursor-pointer items-center justify-between border-l-2 px-3 py-2 text-sm transition-colors ${
              activeChatId === chat.id
                ? 'border-accent bg-surface-hover text-text-primary'
                : 'border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <span className="truncate">{chat.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteChat.mutate(chat.id)
              }}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5 text-error" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
