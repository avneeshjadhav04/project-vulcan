import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Send, Bot, User } from 'lucide-react'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
}

function AutoResizeTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 128)}px`
    }
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      className="max-h-32 min-h-[44px] flex-1 resize-none border border-border bg-surface px-4 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
    />
  )
}

export default function ChatInterface({
  chatId,
  selectedModel,
}: {
  chatId: string
  selectedModel: string
}) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: chatData, refetch } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: async () => {
      const res = await api.get(`/chats/${chatId}`)
      return res.data as { chat: { title: string; model_id: string }; messages: MessageItem[] }
    },
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatData?.messages, streamedContent])

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')
    setStreaming(true)
    setStreamedContent('')

    try {
      const res = await fetch(`/api/chats/${chatId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      })

      if (!res.ok) {
        throw new Error(await res.text())
      }

      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              setStreamedContent('')
              refetch()
              setStreaming(false)
              return
            }
            if (data === '[ERROR]') {
              setStreaming(false)
              return
            }
            setStreamedContent((prev) => prev + data)
          }
        }
      }

      setStreamedContent('')
      refetch()
    } catch (err) {
      alert((err as any).message || 'Failed to send message')
    } finally {
      setStreaming(false)
    }
  }

  const messages = chatData?.messages || []

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h2 className="text-sm font-medium text-text-primary">
          {chatData?.chat.title || 'Chat'}
        </h2>
        <span className="font-mono text-xs text-text-secondary">{chatData?.chat.model_id || selectedModel}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="flex gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center bg-surface">
                {msg.role === 'assistant' ? (
                  <Bot className="h-4 w-4 text-accent" />
                ) : (
                  <User className="h-4 w-4 text-text-secondary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {msg.role === 'assistant' ? (
                  <div className="prose prose-invert prose-sm max-w-none text-text-primary">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-text-primary">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {streaming && streamedContent && (
            <div className="flex gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center bg-surface">
                <Bot className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="prose prose-invert prose-sm max-w-none text-text-primary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamedContent}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <AutoResizeTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Message Carbon AI..."
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="flex items-center justify-center border border-transparent bg-accent px-4 text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
