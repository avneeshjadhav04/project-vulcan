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
  Cpu,
  Clock,
  FileJson,
  FileText,
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

/* Code Block */
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
    <div className="my-3 overflow-hidden border border-border-subtle bg-background">
      <div className="flex items-center justify-between border-b border-border-subtle bg-layer px-3 py-1.5">
        <span className="text-[11px] font-mono text-text-helper">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary"
        >
          {copied ? <Check className="h-3 w-3 text-support-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className="font-mono text-sm leading-relaxed text-text-secondary">{children}</code>
      </pre>
    </div>
  )
}

/* Inline Code */
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-layer px-1 py-0.5 font-mono text-sm text-text-secondary border border-border-subtle">
      {children}
    </code>
  )
}

/* Shared Markdown components */
const markdownComponents = {
  code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const isInline = !className
    if (isInline) {
      return <InlineCode>{children}</InlineCode>
    }
    return <CodeBlock className={className}>{String(children)}</CodeBlock>
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="mb-2 list-disc pl-5 space-y-0.5">{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="mb-2 list-decimal pl-5 space-y-0.5">{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="leading-relaxed">{children}</li>
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="mb-2 text-base font-semibold text-text-primary">{children}</h1>
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="mb-2 text-sm font-semibold text-text-primary">{children}</h2>
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="mb-1 text-xs font-semibold text-text-primary">{children}</h3>
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className="mb-2 border-l-2 border-interactive pl-3 italic text-text-secondary">
        {children}
      </blockquote>
    )
  },
  a({ children, href }: { children?: React.ReactNode; href?: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link-primary underline underline-offset-2 transition-colors hover:text-link-hover"
      >
        {children}
      </a>
    )
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="mb-2 overflow-x-auto border border-border-subtle">
        <table className="w-full text-sm">{children}</table>
      </div>
    )
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead className="bg-layer">{children}</thead>
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="border-b border-border-subtle px-3 py-2 text-left text-[11px] font-semibold text-text-secondary">{children}</th>
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="border-b border-border-subtle px-3 py-2 text-text-secondary">{children}</td>
  },
  hr() {
    return <hr className="my-3 border-border-subtle" />
  },
}

/* Time Ago */
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

/* Message Bubble */
function MessageBubble({
  msg,
  onRegenerate,
  onEdit,
  messageMeta,
}: {
  msg: MessageItem
  onRegenerate?: () => void
  onEdit?: (id: string, content: string) => void
  messageMeta?: { model: string; durationMs: number }
}) {
  const isAssistant = msg.role === 'assistant'
  const isUser = msg.role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(msg.content)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleSave = () => {
    if (editContent.trim() && editContent !== msg.content && onEdit) {
      onEdit(msg.id, editContent.trim())
    }
    setIsEditing(false)
  }

  return (
    <div
      className={`group flex gap-3 py-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div
          className={`flex h-7 w-7 items-center justify-center border ${
            isAssistant
              ? 'border-border-subtle bg-interactive'
              : 'border-border-subtle bg-layer'
          }`}
        >
          {isAssistant ? (
            <Sparkles className="h-3.5 w-3.5 text-white" />
          ) : (
            <User className="h-3.5 w-3.5 text-text-secondary" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`min-w-0 max-w-[85%] flex-1 ${isUser ? 'text-right' : ''}`}>
        <div className={`mb-1 flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-[11px] font-semibold text-text-primary">
            {isAssistant ? 'AI' : 'You'}
          </span>
          <span className="text-[10px] text-text-helper">{timeAgo(msg.created_at)}</span>
          {msg.tokens_used && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-helper">
              <Hash className="h-2.5 w-2.5" />
              {msg.tokens_used}
            </span>
          )}
        </div>

        <div
          className={`inline-block text-left ${
            isUser
              ? 'bg-interactive px-4 py-2.5 text-white'
              : 'border border-border-subtle bg-layer px-4 py-2.5 text-text-primary'
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
                className="w-full resize-none border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none"
                rows={3}
                autoFocus
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setEditContent(msg.content)
                  }}
                  className="px-3 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="bg-interactive px-3 py-1 text-[11px] text-white transition-colors hover:bg-interactive-hover"
                >
                  Save & Regenerate
                </button>
              </div>
            </div>
          ) : isAssistant ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
          )}
        </div>

        {/* Footer: model info (bottom-left) + actions (bottom-right) */}
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAssistant && messageMeta && (
              <div className="flex items-center gap-1.5 text-[10px] text-text-helper">
                <Cpu className="h-2.5 w-2.5" />
                <span className="truncate max-w-[150px]" title={messageMeta.model}>{messageMeta.model}</span>
                <span>·</span>
                <Clock className="h-2.5 w-2.5" />
                <span>{(messageMeta.durationMs / 1000).toFixed(1)}s</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary"
              title="Copy message"
            >
              {copied ? <Check className="h-3 w-3 text-support-success" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isAssistant && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary"
                title="Regenerate response"
              >
                <RotateCcw className="h-3 w-3" />
                Regenerate
              </button>
            )}
            {isUser && onEdit && !isEditing && (
              <button
                onClick={() => {
                  setEditContent(msg.content)
                  setIsEditing(true)
                }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary"
                title="Edit message"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* Streaming Message */
function StreamingMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 py-3"
    >
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-7 w-7 items-center justify-center border border-border-subtle bg-interactive">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-primary">AI</span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-interactive">
              <Zap className="h-2.5 w-2.5" />
              Generating...
            </span>
          )}
        </div>
        <div className="inline-block border border-border-subtle bg-layer px-4 py-2.5">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 bg-interactive" />
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* Typing Indicator */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 py-3"
    >
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-7 w-7 items-center justify-center border border-border-subtle bg-interactive">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <div className="flex items-center">
        <div className="flex items-center gap-1.5 border border-border-subtle bg-layer px-3 py-2">
          <div className="h-1.5 w-1.5 bg-interactive" />
          <div className="h-1.5 w-1.5 bg-interactive" />
          <div className="h-1.5 w-1.5 bg-interactive" />
        </div>
      </div>
    </motion.div>
  )
}

/* Tool Execution Card */
function ToolExecutionCard({ tool }: { tool: { command: string; stdout: string; stderr: string; status: string } }) {
  const [expanded, setExpanded] = useState(true)
  const isSuccess = tool.status === 'success'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 overflow-hidden border border-border-subtle bg-layer"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <div className={`flex h-5 w-5 items-center justify-center ${isSuccess ? 'bg-support-success/10' : 'bg-support-error/10'}`}>
            {isSuccess ? (
              <CheckCircle2 className="h-3 w-3 text-support-success" />
            ) : (
              <XCircle className="h-3 w-3 text-support-error" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3 w-3 text-text-helper" />
            <span className="truncate font-mono text-[11px] text-text-secondary">{tool.command}</span>
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${isSuccess ? 'text-support-success' : 'text-support-error'}`}>
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
            <div className="border-t border-border-subtle">
              {tool.stdout && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Output</p>
                  <pre className="max-h-32 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                    {tool.stdout}
                  </pre>
                </div>
              )}
              {tool.stderr && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Stderr</p>
                  <pre className="max-h-32 overflow-auto bg-background p-2 font-mono text-[11px] text-support-error">
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

/* Empty State */
function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const suggestions = [
    { icon: '>', text: 'List all files in the current directory' },
    { icon: '>', text: 'Write a Python script to fetch weather data' },
    { icon: '>', text: 'Check what version of Node.js is installed' },
    { icon: '>', text: 'Find all .log files and show their sizes' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 flex-col items-center justify-center px-6"
    >
      <div className="mb-6 flex h-14 w-14 items-center justify-center border border-border-subtle bg-layer">
        <Bot className="h-7 w-7 text-interactive" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-text-primary">Just Ask.</h2>
      <p className="mb-6 max-w-md text-center text-xs text-text-helper">
        I can write code, analyze data, answer questions, help with creative projects, and much more.
      </p>
      <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05 }}
            onClick={() => onSuggestion(s.text)}
            className="flex items-start gap-2 border border-border-subtle bg-layer p-3 text-left transition-colors hover:border-border-strong hover:bg-layer-hover"
          >
            <span className="mt-0.5 text-xs text-interactive">{s.icon}</span>
            <span className="text-xs text-text-secondary">{s.text}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

/* Scroll to Bottom Button */
function ScrollToBottom({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClick}
          className="absolute bottom-20 left-1/2 z-10 flex h-7 w-7 -translate-x-1/2 items-center justify-center border border-border-subtle bg-layer text-text-helper transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/* Main Component */
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
  const [optimisticTitle, setOptimisticTitle] = useState<string>()
  const [messageMeta, setMessageMeta] = useState<Record<string, { model: string; durationMs: number }>>({})
  const pendingMetaRef = useRef<{ model: string; durationMs: number } | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startTimeRef = useRef<number>(0)
  const exportRef = useRef<HTMLDivElement>(null)

  const navigate = useNavigate()

  useEffect(() => {
    setEffectiveChatId(chatId)
    setOptimisticTitle(undefined)
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
    setMessageMeta({})
    pendingMetaRef.current = null
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

  // Close export menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Smart auto-scroll
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
  const voiceTimerRef = useRef<any>(null)

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    if (isListening && voiceRef.current) {
      try { voiceRef.current.stop() } catch {}
      voiceRef.current = null
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    voiceRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalTranscript = ''

    recognition.onstart = () => {
      setIsListening(true)
      setSendError('')
    }

    recognition.onend = () => {
      setIsListening(false)
      voiceRef.current = null
      if (finalTranscript.trim()) {
        voiceTimerRef.current = setTimeout(() => {
          handleSend(finalTranscript.trim())
        }, 600)
      }
    }

    recognition.onerror = (e: any) => {
      const errorMessages: Record<string, string> = {
        'network': 'Speech recognition network error. Please check your internet connection and try again.',
        'not-allowed': 'Microphone access denied. Please allow microphone permissions in your browser.',
        'audio-capture': 'No microphone found. Please connect a microphone and try again.',
        'service-not-allowed': 'Speech recognition service is not allowed.',
      }
      if (e.error === 'network') {
        // Retry once on network error
        setSendError('Speech recognition network error. Retrying...')
        setTimeout(() => {
          if (!voiceRef.current) {
            toggleVoiceInput()
          }
        }, 500)
        return
      }
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setSendError(errorMessages[e.error] || `Voice error: ${e.error}`)
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

    try {
      recognition.start()
    } catch (e) {
      setSendError('Could not start voice input')
      setIsListening(false)
    }
  }

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || input.trim()
    if (!text || streaming) return

    if (!textOverride) setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    setStreaming(true)
    setStreamedContent('')
    setSendError('')
    pendingMetaRef.current = null
    startTimeRef.current = Date.now()

    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      let currentChatId = effectiveChatId
      if (!currentChatId) {
        setCreatingChat(true)
        const createRes = await api.post('/chats', { title: text.slice(0, 50), model_id: selectedModel })
        currentChatId = createRes.data.id
        setEffectiveChatId(currentChatId)
        setOptimisticTitle(text.slice(0, 50))
        window.history.replaceState({}, '', `/chat/${currentChatId}`)
        setCreatingChat(false)
      }

      let messageContent = text
      if (attachedFiles.length > 0) {
        const fileContexts = attachedFiles.map(f => {
          if (f.extracted_text) {
            return `[File: ${f.filename}]\n\`\`\`\n${f.extracted_text}\n\`\`\``
          }
          return `[File: ${f.filename}]`
        }).join('\n\n')
        messageContent = `${fileContexts}\n\n${text}`
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

        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)
            if (!raw.trim()) continue

            if (raw === '[DONE]') {
              setToolExecution(null)
              setAttachedFiles([])
              const duration = Date.now() - startTimeRef.current
              pendingMetaRef.current = { model: selectedModel, durationMs: duration }
              setStreaming(false)
              refetch()
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
              } catch {}
              continue
            }
            setStreamedContent((prev) => prev + raw)
          }
        }
      }

      // Stream ended without [DONE] marker
      setToolExecution(null)
      setAttachedFiles([])
      const duration = Date.now() - startTimeRef.current
      pendingMetaRef.current = { model: selectedModel, durationMs: duration }
      setStreaming(false)
      refetch()
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        pendingMetaRef.current = null
        return
      }
      setSendError(err.message || 'Failed to send message')
      setStreaming(false)
      pendingMetaRef.current = null
    } finally {
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
    pendingMetaRef.current = null
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

      const deleteRes = await fetch(`/api/chats/${effectiveChatId}/messages/${msgId}/after`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
      })
      if (!deleteRes.ok) throw new Error('Failed to clear subsequent messages')

      await refetch()
      handleSend(newContent)
    } catch (err: any) {
      setSendError(err.message || 'Failed to edit message')
    }
  }

  const messages = chatData?.messages || []

  // Clear streamed content once the assistant message is persisted
  useEffect(() => {
    if (!streaming && streamedContent && messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'assistant') {
        setStreamedContent('')
      }
    }
  }, [messages, streaming, streamedContent])

  // Assign pending meta to the last assistant message once it appears
  useEffect(() => {
    if (pendingMetaRef.current && messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'assistant') {
        setMessageMeta(prev => ({ ...prev, [lastMsg.id]: pendingMetaRef.current! }))
        pendingMetaRef.current = null
      }
    }
  }, [messages])

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-text-helper">
        <AlertCircle className="mb-3 h-10 w-10 text-support-error" />
        <p className="mb-1 text-base font-medium text-text-primary">Chat not found</p>
        <p className="mb-4 text-xs text-text-helper">This chat may have been deleted or you don&apos;t have access.</p>
        <button
          onClick={() => window.location.reload()}
          className="carbon-btn-primary"
        >
          Refresh Page
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-background px-5 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="max-w-[300px] truncate text-xs font-semibold text-text-primary">
            {chatData?.chat.title || optimisticTitle || 'New Chat'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {effectiveChatId && (
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary"
                title="Export chat"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              <AnimatePresence>
                {showExportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 top-full z-50 mt-1 w-36 border border-border-subtle bg-layer shadow-lg"
                  >
                    <button
                      onClick={() => {
                        window.open(`/api/chats/${effectiveChatId}/export?format=markdown`, '_blank')
                        setShowExportMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Markdown
                    </button>
                    <button
                      onClick={() => {
                        window.open(`/api/chats/${effectiveChatId}/export?format=json`, '_blank')
                        setShowExportMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-layer-hover hover:text-text-primary"
                    >
                      <FileJson className="h-3.5 w-3.5" />
                      JSON
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mx-4 max-w-sm border border-border-subtle bg-layer p-8 text-center"
            >
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center border border-border-subtle bg-background">
                <Key className="h-6 w-6 text-interactive" />
              </div>
              <h2 className="mb-2 text-base font-semibold text-text-primary">NVIDIA NIM API Key Required</h2>
              <p className="mb-5 text-xs text-text-helper">
                To use Project Vulcan, you need to add a valid NVIDIA NIM API key. 
                You can get one for free from NVIDIA&apos;s website.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigate('/settings')}
                  className="carbon-btn-primary"
                >
                  <Settings className="h-4 w-4" />
                  Go to Settings
                </button>
                <a
                  href="https://build.nvidia.com/explore/discover"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="carbon-btn-secondary"
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
            className="overflow-hidden border-b border-border-subtle bg-layer px-5 py-1.5"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-[11px] text-text-helper">
              <div className="h-3 w-3 animate-spin border-2 border-border-subtle border-t-interactive" />
              Checking model availability...
            </div>
          </motion.div>
        )}
        {modelValidation && !modelValidation.valid && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-support-warning/30 bg-support-warning/10 px-5 py-2.5"
          >
            <div className="mx-auto flex max-w-3xl items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-support-warning">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modelValidation.error || `Model '${modelValidation.model_id}' is not available`}</span>
              </div>
              <button
                onClick={() => {
                  const csrf = getCsrfToken()
                  fetch(`/api/chats/${effectiveChatId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
                    credentials: 'include',
                    body: JSON.stringify({ title: chatData?.chat.title, model_id: 'meta/llama-3.1-8b-instruct' })
                  }).then(() => refetch())
                }}
                className="border border-support-warning/30 px-3 py-1 text-[11px] text-support-warning transition-colors hover:bg-support-warning/20"
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
              <div className="h-5 w-5 animate-spin border-2 border-interactive border-t-transparent" />
              <p className="mt-3 text-xs text-text-helper">Creating chat...</p>
            </div>
          ) : messages.length === 0 && !streaming ? (
            <EmptyState onSuggestion={handleSend} />
          ) : (
            <>
              {messages.map((msg, index) => {
                // Skip rendering the last assistant message while streaming its content
                if (streamedContent && msg.role === 'assistant' && index === messages.length - 1) {
                  return null
                }
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onRegenerate={index === messages.length - 1 && msg.role === 'assistant' ? handleRegenerate : undefined}
                    onEdit={msg.role === 'user' ? handleEditMessage : undefined}
                    messageMeta={messageMeta[msg.id]}
                  />
                )
              })}

              {toolExecution && streaming && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  <ToolExecutionCard tool={toolExecution} />
                </motion.div>
              )}

              {streamedContent && (
                <StreamingMessage content={streamedContent} isStreaming={streaming} />
              )}

              {streaming && !streamedContent && !toolExecution && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
      </div>

      {/* Input */}
      <div className="border-t border-border-subtle bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {sendError && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-2 flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-[11px] text-support-error"
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
            className="relative flex items-end gap-2 border border-border-subtle bg-layer p-2 transition-colors focus-within:border-focus focus-within:ring-1 focus-within:ring-focus"
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
              placeholder="Message AI..."
              rows={2}
              disabled={streaming}
              className="max-h-[200px] min-h-[48px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-50"
            />

            <div className="w-52 shrink-0">
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
              className={`flex h-7 w-7 shrink-0 items-center justify-center transition-colors ${
                userData?.tools_enabled
                  ? 'bg-support-success/20 text-support-success'
                  : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
              }`}
              title={userData?.tools_enabled ? 'Tools Enabled — Click to Disable' : 'Tools Disabled — Click to Enable'}
            >
              <Wrench className="h-4 w-4" />
            </button>

            {voiceSupported && (
              <button
                onClick={toggleVoiceInput}
                className={`relative flex h-7 w-7 shrink-0 items-center justify-center transition-colors ${
                  isListening
                    ? 'bg-support-error/20 text-support-error'
                    : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
                }`}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                {isListening ? (
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping bg-support-error/40" />
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
                className="flex h-8 w-8 shrink-0 items-center justify-center bg-support-error/10 text-support-error transition-colors hover:bg-support-error/20"
                title="Stop generating"
              >
                <StopCircle className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center bg-interactive text-white transition-colors hover:bg-interactive-hover disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-2">
            {isListening ? (
              <>
                <span className="flex h-1.5 w-1.5 bg-support-error animate-pulse" />
                <span className="text-[10px] text-support-error">Listening... speak now</span>
              </>
            ) : (
              <span className="text-[10px] text-text-helper">
                {userData?.tools_enabled ? 'Tools On — AI can run commands, create files, and search the web.' : 'Tools Off — AI will not use any tools.'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
