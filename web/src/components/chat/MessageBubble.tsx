import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion } from 'framer-motion'
import {
  Copy,
  Check,
  RotateCcw,
  Pencil,
  Sparkles,
  User,
  Hash,
  Cpu,
  Clock,
} from 'lucide-react'
import { markdownComponents, extractArtifacts, stripArtifacts, ArtifactCard } from './markdownComponents'
import { useRelativeTime } from '../../hooks/useRelativeTime'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
}

interface MessageBubbleProps {
  msg: MessageItem
  onRegenerate?: () => void
  onEdit?: (id: string, content: string) => void
  messageMeta?: { provider: string; model: string; durationMs: number }
  animateMount?: boolean
}

export default function MessageBubble({
  msg,
  onRegenerate,
  onEdit,
  messageMeta,
  animateMount = true,
}: MessageBubbleProps) {
  const isAssistant = msg.role === 'assistant'
  const isUser = msg.role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(msg.content)
  const [copied, setCopied] = useState(false)
  const relativeTime = useRelativeTime(msg.created_at)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [msg.content])

  const handleSave = useCallback(() => {
    if (editContent.trim() && editContent !== msg.content && onEdit) {
      onEdit(msg.id, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, msg.content, msg.id, onEdit])

  return (
    <motion.div
      id={`msg-${msg.id}`}
      initial={animateMount ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`group flex gap-3 py-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full shadow-sm ${
            isAssistant
              ? 'bg-vibrant-gradient'
              : 'border border-border-subtle bg-layer'
          }`}
        >
          {isAssistant ? (
            <Sparkles className="h-4 w-4 text-white" aria-hidden="true" />
          ) : (
            <User className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`min-w-0 max-w-[85%] flex-1 ${isUser ? 'text-right' : ''}`}>
        <div className={`mb-1 flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-[11px] font-semibold text-text-primary">
            {isAssistant ? 'AI' : 'You'}
          </span>
          <time
            className="text-[10px] text-text-helper"
            dateTime={msg.created_at}
            title={new Date(msg.created_at).toLocaleString()}
          >
            {relativeTime}
          </time>
          {msg.tokens_used && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-helper">
              <Hash className="h-2.5 w-2.5" aria-hidden="true" />
              {msg.tokens_used}
            </span>
          )}
        </div>

        <div
          className={`inline-block text-left shadow-sm ${
            isUser
              ? 'bg-interactive text-white rounded-2xl rounded-tr-sm px-5 py-3'
              : 'border border-white/5 bg-layer/60 backdrop-blur-md rounded-2xl rounded-tl-sm px-5 py-3 text-text-primary'
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
                onBlur={handleSave}
                className="w-full resize-none border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                rows={3}
                autoFocus
                aria-label="Edit message"
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
          ) : msg.role === 'tool' ? (
            <div className="rounded border border-white/5 bg-background/50 px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Tool Result</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
                {msg.content}
              </pre>
            </div>
          ) : isAssistant ? (
            <div className="prose prose-invert prose-sm max-w-none">
              {(() => {
                const artifacts = extractArtifacts(msg.content)
                const cleanContent = stripArtifacts(msg.content)
                return (
                  <>
                    {artifacts.map((artifact) => (
                      <ArtifactCard key={artifact.title + artifact.type} title={artifact.title} type={artifact.type} content={artifact.content} />
                    ))}
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {cleanContent}
                    </ReactMarkdown>
                  </>
                )
              })()}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
          )}
        </div>

        {/* Footer: model info + actions */}
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAssistant && messageMeta && (
              <div className="flex items-center gap-1.5 text-[10px] text-text-helper">
                <Cpu className="h-2.5 w-2.5" aria-hidden="true" />
                <span className="truncate max-w-[80px]" title={messageMeta.provider}>{messageMeta.provider}</span>
                <span>/</span>
                <span className="truncate max-w-[100px]" title={messageMeta.model}>{messageMeta.model}</span>
                <span>·</span>
                <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                <span>{(messageMeta.durationMs / 1000).toFixed(1)}s</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              aria-label="Copy message"
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
            >
              {copied ? <Check className="h-3 w-3 text-support-success" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isAssistant && onRegenerate && (
              <button
                onClick={onRegenerate}
                aria-label="Regenerate response"
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
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
                aria-label="Edit message"
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
