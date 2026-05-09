import { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import {
  Send,
  Bot,
  User,
  Copy,
  Check,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Zap,
  ChevronDown,
  StopCircle,
  Terminal,
  CheckCircle2,
  XCircle,
  Pencil,
  Download,
  Mic,
  MicOff,
  Hash,
  Key,
  Settings,
  ExternalLink,
  Wrench,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import FileUpload, { UploadedFile } from './FileUpload'
import ModelSelector from './ModelSelector'

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : null
}

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
}

/* ─── Code Block ─── */
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || 'text'

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] shadow-lg">
      <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[#da1e28]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#f1c21b]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#24a148]" />
          </div>
          <span className="ml-2 text-xs font-mono font-medium text-[#525252]">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-[#24a148]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-sm leading-relaxed text-[#c6c6c6]">{children}</code>
      </pre>
    </div>
  )
}

/* ─── Inline Code ─── */
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-sm text-[#78a9ff] border border-[#2a2a2a]">
      {children}
    </code>
  )
}

/* ─── Message Actions ─── */
function MessageActions({ content, onRegenerate }: { content: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
        title="Copy response"
      >
        {copied ? <Check className="h-3 w-3 text-[#24a148]" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
          title="Regenerate response"
        >
          <RotateCcw className="h-3 w-3" />
          Regenerate
        </button>
      )}
    </div>
  )
}

/* ─── Time Ago ─── */
function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/* ─── Message Bubble ─── */
function MessageBubble({ msg, onRegenerate, onEdit }: { msg: MessageItem; onRegenerate?: () => void; onEdit?: (id: string, content: string) => void }) {
  const isAssistant = msg.role === 'assistant'
  const isUser = msg.role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(msg.content)

  const handleSave = () => {
    if (editContent.trim() && editContent !== msg.content && onEdit) {
      onEdit(msg.id, editContent.trim())
    }
    setIsEditing(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`group flex gap-4 py-5 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className="flex shrink-0 flex-col items-center pt-1">
        <motion.div
          whileHover={{ scale: 1.05 }}
          className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-lg ${
            isAssistant
              ? 'bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-[#0f62fe]/20'
              : 'bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] border border-[#2a2a2a]'
          }`}
        >
          {isAssistant ? (
            <Sparkles className="h-4 w-4 text-white" />
          ) : (
            <User className="h-4 w-4 text-[#c6c6c6]" />
          )}
        </motion.div>
      </div>

      {/* Content */}
      <div className={`min-w-0 max-w-[85%] flex-1 ${isUser ? 'text-right' : ''}`}>
        <div className={`mb-1.5 flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-xs font-semibold text-white">
            {isAssistant ? 'Carbon AI' : 'You'}
          </span>
          <span className="text-[10px] text-[#525252]">{timeAgo(msg.created_at)}</span>
          {msg.tokens_used && (
            <span className="flex items-center gap-0.5 text-[10px] text-[#525252]">
              <Hash className="h-2.5 w-2.5" />
              {msg.tokens_used}
            </span>
          )}
        </div>

        <div
          className={`inline-block rounded-2xl px-5 py-3.5 text-left shadow-sm ${
            isUser
              ? 'bg-gradient-to-br from-[#0f62fe] to-[#0353e9] text-white'
              : 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#f4f4f4]'
          }`}
        >
          {isEditing ? (
            <div className="min-w-[200px]">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSave()
                  }
                  if (e.key === 'Escape') {
                    setIsEditing(false)
                    setEditContent(msg.content)
                  }
                }}
                className="w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/50"
                rows={3}
                autoFocus
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setEditContent(msg.content)
                  }}
                  className="rounded-lg px-3 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="rounded-lg bg-white/20 px-3 py-1 text-[11px] text-white transition-colors hover:bg-white/30"
                >
                  Save & Regenerate
                </button>
              </div>
            </div>
          ) : isAssistant ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ children, className }) {
                    const isInline = !className
                    if (isInline) {
                      return <InlineCode>{children}</InlineCode>
                    }
                    return <CodeBlock className={className}>{String(children)}</CodeBlock>
                  },
                  p({ children }) {
                    return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
                  },
                  ul({ children }) {
                    return <ul className="mb-3 list-disc pl-5 space-y-1">{children}</ul>
                  },
                  ol({ children }) {
                    return <ol className="mb-3 list-decimal pl-5 space-y-1">{children}</ol>
                  },
                  li({ children }) {
                    return <li className="leading-relaxed">{children}</li>
                  },
                  h1({ children }) {
                    return <h1 className="mb-3 text-lg font-bold text-white">{children}</h1>
                  },
                  h2({ children }) {
                    return <h2 className="mb-2 text-base font-bold text-white">{children}</h2>
                  },
                  h3({ children }) {
                    return <h3 className="mb-2 text-sm font-bold text-white">{children}</h3>
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="mb-3 border-l-2 border-[#0f62fe] pl-4 italic text-[#a8a8a8]">
                        {children}
                      </blockquote>
                    )
                  },
                  a({ children, href }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#78a9ff] underline underline-offset-2 transition-colors hover:text-[#a8c8ff]"
                      >
                        {children}
                      </a>
                    )
                  },
                  table({ children }) {
                    return (
                      <div className="mb-3 overflow-x-auto rounded-lg border border-[#2a2a2a]">
                        <table className="w-full text-sm">{children}</table>
                      </div>
                    )
                  },
                  thead({ children }) {
                    return <thead className="bg-[#1a1a1a]">{children}</thead>
                  },
                  th({ children }) {
                    return <th className="border-b border-[#2a2a2a] px-3 py-2 text-left text-xs font-semibold text-[#c6c6c6]">{children}</th>
                  },
                  td({ children }) {
                    return <td className="border-b border-[#2a2a2a] px-3 py-2 text-[#c6c6c6]">{children}</td>
                  },
                  hr() {
                    return <hr className="my-4 border-[#2a2a2a]" />
                  },
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
          )}
        </div>

        {isAssistant && <MessageActions content={msg.content} onRegenerate={onRegenerate} />}
        {isUser && onEdit && !isEditing && (
          <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => {
                setEditContent(msg.content)
                setIsEditing(true)
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
              title="Edit message"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ─── Streaming Indicator ─── */
function StreamingMessage({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-4 py-5"
    >
      <div className="flex shrink-0 flex-col items-center pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Carbon AI</span>
          <span className="flex items-center gap-1 text-[10px] text-[#0f62fe]">
            <Zap className="h-3 w-3 animate-pulse" />
            Generating...
          </span>
        </div>
        <div className="inline-block rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] px-5 py-3.5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#f4f4f4]">
            {content}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#0f62fe] align-middle" />
          </p>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── Typing Indicator ─── */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-4 py-5"
    >
      <div className="flex shrink-0 flex-col items-center pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] shadow-lg shadow-[#0f62fe]/20">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
      </div>
      <div className="flex items-center">
        <div className="flex items-center gap-1.5 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] px-4 py-3">
          <div className="h-2 w-2 animate-bounce rounded-full bg-[#0f62fe]" style={{ animationDelay: '0ms' }} />
          <div className="h-2 w-2 animate-bounce rounded-full bg-[#0f62fe]" style={{ animationDelay: '150ms' }} />
          <div className="h-2 w-2 animate-bounce rounded-full bg-[#0f62fe]" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </motion.div>
  )
}

/* ─── Tool Execution Card ─── */
function ToolExecutionCard({ tool }: { tool: { command: string; stdout: string; stderr: string; status: string } }) {
  const [expanded, setExpanded] = useState(true)
  const isSuccess = tool.status === 'success'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-3 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5"
      >
        <div className="flex items-center gap-2.5">
          <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${isSuccess ? 'bg-[#24a148]/10' : 'bg-[#da1e28]/10'}`}>
            {isSuccess ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#24a148]" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-[#da1e28]" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-[#525252]" />
            <span className="truncate font-mono text-xs text-[#c6c6c6]">{tool.command}</span>
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${isSuccess ? 'text-[#24a148]' : 'text-[#da1e28]'}`}>
          {tool.status}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#2a2a2a]">
              {tool.stdout && (
                <div className="px-4 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Output</p>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[#0f0f0f] p-3 font-mono text-xs text-[#c6c6c6]">
                    {tool.stdout}
                  </pre>
                </div>
              )}
              {tool.stderr && (
                <div className="px-4 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#525252]">Stderr</p>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[#0f0f0f] p-3 font-mono text-xs text-[#da1e28]">
                    {tool.stderr}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ─── Empty State ─── */
function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const suggestions = [
    { icon: '🖥️', text: 'List all files in the current directory' },
    { icon: '🐍', text: 'Write a Python script to fetch weather data' },
    { icon: '⚡', text: 'Check what version of Node.js is installed' },
    { icon: '🔍', text: 'Find all .log files and show their sizes' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="flex flex-1 flex-col items-center justify-center px-6"
    >
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#0f62fe]/20 to-[#78a9ff]/10 shadow-2xl shadow-[#0f62fe]/10">
        <Bot className="h-10 w-10 text-[#0f62fe]" />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-white">How can I help you today?</h2>
      <p className="mb-8 max-w-md text-center text-sm text-[#525252]">
        I can write code, analyze data, answer questions, help with creative projects, and much more.
      </p>
      <div className="grid w-full max-w-lg gap-3 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            onClick={() => onSuggestion(s.text)}
            className="flex items-start gap-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 text-left transition-all hover:border-[#0f62fe]/50 hover:bg-[#1a1a1a]/80 hover:shadow-lg hover:shadow-[#0f62fe]/5"
          >
            <span className="text-lg">{s.icon}</span>
            <span className="text-sm text-[#c6c6c6]">{s.text}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

/* ─── Scroll to Bottom Button ─── */
function ScrollToBottom({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={onClick}
          className="absolute bottom-24 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#525252] shadow-lg transition-all hover:border-[#0f62fe]/50 hover:text-white"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/* ─── Main Component ─── */
export default function ChatInterface({
  chatId,
  selectedModel,
  onModelChange,
}: {
  chatId?: string
  selectedModel: string
  onModelChange?: (model: string) => void
}) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [sendError, setSendError] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [toolExecution, setToolExecution] = useState<{ command: string; stdout: string; stderr: string; status: string } | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([])
  const [isListening, setIsListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [modelValidation, setModelValidation] = useState<{valid: boolean; error?: string; model_id?: string} | null>(null)
  const [validatingModel, setValidatingModel] = useState(false)
  const [effectiveChatId, setEffectiveChatId] = useState<string | undefined>(chatId)
  const [creatingChat, setCreatingChat] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const navigate = useNavigate()

  useEffect(() => {
    setEffectiveChatId(chatId)
  }, [chatId])

  const { data: chatData, refetch, isError } = useQuery({
    queryKey: ['chat', effectiveChatId],
    queryFn: async () => {
      const res = await api.get(`/chats/${effectiveChatId}`)
      return res.data as { chat: { title: string; model_id: string }; messages: MessageItem[] }
    },
    enabled: !!effectiveChatId,
  })

  const { data: userData, refetch: refetchUser } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/me')
      return res.data as { has_nim_key: boolean; tools_enabled: boolean }
    },
  })

  // Reset state when switching chats
  useEffect(() => {
    setInput('')
    setStreaming(false)
    setStreamedContent('')
    setSendError('')
    setToolExecution(null)
    setAttachedFiles([])
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [chatId])

  // Load attached files for chat
  useEffect(() => {
    if (!effectiveChatId) return
    api.get(`/chats/${effectiveChatId}/files`)
      .then(res => setAttachedFiles(res.data || []))
      .catch(() => setAttachedFiles([]))
  }, [effectiveChatId])

  // Check voice support
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(!!SpeechRecognition)
  }, [])

  // Validate model when chat loads
  useEffect(() => {
    const currentModelId = chatData?.chat.model_id
    if (!currentModelId || !userData?.has_nim_key) {
      setModelValidation(null)
      return
    }

    let cancelled = false
    setValidatingModel(true)
    
    api.get(`/models/validate?model_id=${encodeURIComponent(currentModelId)}`)
      .then(res => {
        if (!cancelled) setModelValidation(res.data)
      })
      .catch(() => {
        if (!cancelled) setModelValidation(null)
      })
      .finally(() => {
        if (!cancelled) setValidatingModel(false)
      })

    return () => { cancelled = true }
  }, [chatData?.chat.model_id, userData?.has_nim_key])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Smart auto-scroll: only scroll if user is near bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    setShowScrollBtn(!nearBottom)
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
    if (nearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatData?.messages, streamedContent])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const voiceRef = useRef<any>(null)

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    if (isListening && voiceRef.current) {
      voiceRef.current.stop()
      voiceRef.current = null
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    voiceRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    let finalTranscript = ''

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => {
      setIsListening(false)
      voiceRef.current = null
    }
    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted') {
        setSendError(`Voice input error: ${e.error}`)
      }
      setIsListening(false)
      voiceRef.current = null
    }
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interim += transcript
        }
      }
      setInput(finalTranscript + interim)
    }

    recognition.start()
  }

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || input.trim()
    if (!text || streaming) return

    if (!textOverride) setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    setStreaming(true)
    setStreamedContent('')
    setSendError('')

    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      // Auto-create chat on first message
      let currentChatId = effectiveChatId
      if (!currentChatId) {
        setCreatingChat(true)
        const createRes = await api.post('/chats', { title: text.slice(0, 50), model_id: selectedModel })
        currentChatId = createRes.data.id
        setEffectiveChatId(currentChatId)
        window.history.replaceState({}, '', `/chat/${currentChatId}`)
        setCreatingChat(false)
      }

      // Build content with file context if files are attached
      let messageContent = text
      if (attachedFiles.length > 0) {
        const fileContext = attachedFiles.map(f => `[File: ${f.filename}]`).join('\n')
        messageContent = `${fileContext}\n\n${text}`
      }

      const endpoint = `/api/chats/${currentChatId}/message`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken() || '',
        },
        credentials: 'include',
        body: JSON.stringify({ content: messageContent }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login'
          return
        }
        if (res.status === 428) {
          throw new Error('Add your NVIDIA NIM API key in Settings to start chatting.')
        }
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (controller.signal.aborted) break
        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE events from buffer
        const events = buffer.split('\n\n')
        buffer = events.pop() || '' // Keep incomplete event in buffer

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)
            if (!raw.trim()) continue

            // Check for markers first
            if (raw === '[DONE]') {
              setStreamedContent('')
              setToolExecution(null)
              refetch()
              setStreaming(false)
              return
            }
            if (raw.startsWith('[ERR]') && raw.endsWith('[/ERR]')) {
              const errorMsg = raw.slice(5, -6)
              setSendError(errorMsg || 'An error occurred')
              setStreaming(false)
              return
            }
            if (raw.startsWith('[TOOL]') && raw.endsWith('[/TOOL]')) {
              try {
                const toolData = JSON.parse(raw.slice(6, -7))
                setToolExecution({
                  command: toolData.command || '',
                  stdout: toolData.stdout || '',
                  stderr: toolData.stderr || '',
                  status: toolData.status || 'error',
                })
              } catch {
                // Ignore malformed tool data
              }
              continue
            }
            // Regular text chunk
            setStreamedContent((prev) => prev + raw)
          }
        }
      }

      setStreamedContent('')
      setToolExecution(null)
      refetch()
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') return
      setSendError(err.message || 'Failed to send message')
    } finally {
      setStreaming(false)
      abortControllerRef.current = null
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setStreamedContent('')
  }

  const handleRegenerate = () => {
    const lastUserMessage = messages.slice().reverse().find((m) => m.role === 'user')
    if (lastUserMessage) {
      handleSend(lastUserMessage.content)
    }
  }

  const handleEditMessage = async (msgId: string, newContent: string) => {
    try {
      const csrfToken = getCsrfToken()
      // Update the message
      const patchRes = await fetch(`/api/chats/${effectiveChatId}/messages/${msgId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        body: JSON.stringify({ content: newContent }),
      })
      if (!patchRes.ok) throw new Error('Failed to edit message')

      // Delete subsequent messages
      const deleteRes = await fetch(`/api/chats/${effectiveChatId}/messages/${msgId}/after`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
      })
      if (!deleteRes.ok) throw new Error('Failed to clear subsequent messages')

      // Refresh chat data
      await refetch()

      // Re-send the edited message to get a new AI response
      handleSend(newContent)
    } catch (err: any) {
      setSendError(err.message || 'Failed to edit message')
    }
  }

  const messages = chatData?.messages || []

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-[#525252]">
        <AlertCircle className="mb-4 h-12 w-12 text-[#da1e28]" />
        <p className="mb-2 text-lg font-medium text-white">Chat not found</p>
        <p className="mb-6 text-sm text-[#525252]">This chat may have been deleted or you don&apos;t have access.</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-[#0f62fe] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0353e9] hover:shadow-lg hover:shadow-[#0f62fe]/25"
        >
          Refresh Page
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0f0f0f]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#0f0f0f]/80 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <h2 className="max-w-[300px] truncate text-sm font-semibold text-white">
            {chatData?.chat.title || 'New Chat'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {effectiveChatId && (
            <button
              onClick={() => {
                const format = confirm('Export as JSON? (Cancel for Markdown)') ? 'json' : 'markdown'
                window.open(`/api/chats/${effectiveChatId}/export?format=${format}`, '_blank')
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white"
              title="Export chat"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          )}
        </div>
      </header>

      {/* API Key Required Overlay */}
      <AnimatePresence>
        {userData && !userData.has_nim_key && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0f0f0f]/95 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mx-4 max-w-md rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-8 text-center shadow-2xl"
            >
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0f62fe]/20 to-[#78a9ff]/10">
                <Key className="h-8 w-8 text-[#0f62fe]" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-white">NVIDIA NIM API Key Required</h2>
              <p className="mb-6 text-sm text-[#525252]">
                To use Carbon AI, you need to add a valid NVIDIA NIM API key. 
                You can get one for free from NVIDIA's website.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => navigate('/settings')}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#0f62fe]/20 transition-all hover:shadow-xl hover:shadow-[#0f62fe]/30"
                >
                  <Settings className="h-4 w-4" />
                  Go to Settings
                </button>
                <a
                  href="https://build.nvidia.com/explore/discover"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] px-6 py-3 text-sm text-[#c6c6c6] transition-all hover:bg-[#2a2a2a] hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  Get Free API Key
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model Validation Warning */}
      <AnimatePresence>
        {validatingModel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[#2a2a2a] bg-[#1a1a1a] px-6 py-2"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-[11px] text-[#525252]">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#525252]/30 border-t-[#0f62fe]" />
              Checking model availability...
            </div>
          </motion.div>
        )}
        {modelValidation && !modelValidation.valid && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[#f1c21b]/30 bg-[#f1c21b]/10 px-6 py-3"
          >
            <div className="mx-auto flex max-w-3xl items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-[#f1c21b]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modelValidation.error || `Model '${modelValidation.model_id}' is not available`}</span>
              </div>
              <button
                onClick={() => {
                  // Update chat to use a default working model
                  const csrf = getCsrfToken()
                  fetch(`/api/chats/${effectiveChatId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
                    credentials: 'include',
                    body: JSON.stringify({ title: chatData?.chat.title, model_id: 'meta/llama-3.1-8b-instruct' })
                  }).then(() => refetch())
                }}
                className="rounded-lg bg-[#f1c21b]/20 px-3 py-1.5 text-[11px] font-medium text-[#f1c21b] transition-colors hover:bg-[#f1c21b]/30"
              >
                Switch to meta/llama-3.1-8b-instruct
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-4 pb-4">
          {creatingChat ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0f62fe] border-t-transparent" />
              <p className="mt-3 text-sm text-[#525252]">Creating chat...</p>
            </div>
          ) : messages.length === 0 && !streaming ? (
            <EmptyState onSuggestion={handleSend} />
          ) : (
            <>
              {messages.map((msg, index) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onRegenerate={index === messages.length - 1 && msg.role === 'assistant' ? handleRegenerate : undefined}
                  onEdit={msg.role === 'user' ? handleEditMessage : undefined}
                />
              ))}

              <AnimatePresence>
                {toolExecution && streaming && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                  >
                    <ToolExecutionCard tool={toolExecution} />
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {streaming && streamedContent && (
                  <StreamingMessage content={streamedContent} />
                )}
              </AnimatePresence>

              {streaming && !streamedContent && !toolExecution && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
      </div>

      {/* Input */}
      <div className="border-t border-[#2a2a2a] bg-[#0f0f0f]/90 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl">
          {sendError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 flex items-center gap-2 rounded-xl border border-[#da1e28]/30 bg-[#da1e28]/10 px-4 py-2.5 text-xs text-[#da1e28]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {sendError}
            </motion.div>
          )}

          <div
            onDrop={(e) => {
              e.preventDefault()
              const files = e.dataTransfer.files
              if (files.length > 0) {
                const input = document.querySelector('input[type="file"]') as HTMLInputElement
                if (input) {
                  const dt = new DataTransfer()
                  for (const f of files) dt.items.add(f)
                  input.files = dt.files
                  input.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            className="relative flex items-end gap-2 rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-2 shadow-lg transition-all focus-within:border-[#0f62fe]/50 focus-within:shadow-[#0f62fe]/5"
          >
            {effectiveChatId && <FileUpload chatId={effectiveChatId} files={attachedFiles} onFilesChange={setAttachedFiles} />}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Message Carbon AI..."
              rows={2}
              disabled={streaming}
              className="max-h-[240px] min-h-[56px] flex-1 resize-none bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-[#525252] disabled:opacity-50"
            />

            <div className="w-32 shrink-0">
              <ModelSelector selected={selectedModel} onSelect={(id) => onModelChange?.(id)} />
            </div>

            <button
              onClick={async () => {
                try {
                  await api.post('/me/tools', { tools_enabled: !userData?.tools_enabled })
                  await refetchUser()
                } catch (err: any) {
                  setSendError(err.response?.data?.error || 'Failed to toggle tools')
                }
              }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
                userData?.tools_enabled
                  ? 'bg-[#24a148]/20 text-[#24a148]'
                  : 'text-[#525252] hover:bg-[#2a2a2a] hover:text-white'
              }`}
              title={userData?.tools_enabled ? 'Tools Enabled — Click to Disable' : 'Tools Disabled — Click to Enable'}
            >
              <Wrench className="h-4 w-4" />
            </button>

            {voiceSupported && (
              <button
                onClick={toggleVoiceInput}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
                  isListening
                    ? 'bg-[#da1e28]/20 text-[#da1e28]'
                    : 'text-[#525252] hover:bg-[#2a2a2a] hover:text-white'
                }`}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                {isListening ? (
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#da1e28]/40" />
                    <MicOff className="relative h-4 w-4" />
                  </span>
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}

            {streaming ? (
              <button
                onClick={handleStop}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#da1e28]/10 text-[#da1e28] transition-all hover:bg-[#da1e28]/20"
                title="Stop generating"
              >
                <StopCircle className="h-5 w-5" />
              </button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0f62fe] to-[#0353e9] text-white shadow-lg shadow-[#0f62fe]/20 transition-all hover:shadow-xl hover:shadow-[#0f62fe]/30 disabled:opacity-30 disabled:shadow-none"
              >
                <Send className="h-4 w-4" />
              </motion.button>
            )}
          </div>

          <p className="mt-2 text-center text-[10px] text-[#525252]">
            {userData?.tools_enabled ? 'Tools On — AI can run commands, create files, and search the web.' : 'Tools Off — AI will not use any tools.'}
          </p>
        </div>
      </div>
    </div>
  )
}
