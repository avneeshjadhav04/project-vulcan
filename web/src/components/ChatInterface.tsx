import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { Send, Bot, User, Loader2, Copy, Check } from 'lucide-react'

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
      className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent/50"
    />
  )
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || 'text'

  const handleCopy = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-background px-3 py-1.5">
        <span className="text-xs font-mono text-text-secondary">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-background p-3">
        <code className="font-mono text-sm text-text-primary">{children}</code>
      </pre>
    </div>
  )
}

function MessageBubble({ msg }: { msg: MessageItem }) {
  const isAssistant = msg.role === 'assistant'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-4 py-4 ${isAssistant ? 'bg-surface/30' : ''}`}
    >
      <div className="flex shrink-0 flex-col items-center">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isAssistant ? 'bg-accent/10' : 'bg-surface'
          }`}
        >
          {isAssistant ? (
            <Bot className="h-4 w-4 text-accent" />
          ) : (
            <User className="h-4 w-4 text-text-secondary" />
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">
            {isAssistant ? 'Carbon AI' : 'You'}
          </span>
        </div>
        {isAssistant ? (
          <div className="prose prose-invert prose-sm max-w-none text-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ children, className }) {
                  return <CodeBlock className={className}>{String(children)}</CodeBlock>
                },
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-text-primary">{msg.content}</p>
        )}
      </div>
    </motion.div>
  )
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex gap-4 py-4"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
        <Bot className="h-4 w-4 text-accent" />
      </div>
      <div className="flex items-center gap-1">
        <div className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
      </div>
    </motion.div>
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
      <header className="flex items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <h2 className="text-sm font-medium text-text-primary">
          {chatData?.chat.title || 'Chat'}
        </h2>
        <span className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-text-secondary">
          {chatData?.chat.model_id || selectedModel}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          <AnimatePresence>
            {streaming && streamedContent && (
              <MessageBubble
                msg={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamedContent,
                  created_at: new Date().toISOString(),
                }}
              />
            )}
          </AnimatePresence>

          {streaming && !streamedContent && <TypingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background/80 px-6 py-4 backdrop-blur">
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
            className="flex shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-white transition-all hover:bg-accent-hover disabled:opacity-50"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
