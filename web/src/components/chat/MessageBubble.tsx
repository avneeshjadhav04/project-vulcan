import React, { useState, useCallback } from 'react'
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
  ThumbsUp,
  ThumbsDown,
  FileText,
} from 'lucide-react'
import { markdownComponents } from './markdownComponents'
import { useRelativeTime } from '../../hooks/useRelativeTime'
import ToolExecutionCard from './ToolExecutionCard'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
  tool_name?: string
  tool_call_id?: string
  attachments?: string
}

interface MessageBubbleProps {
  msg: MessageItem
  chatId?: string
  onRegenerate?: () => void
  onEdit?: (id: string, content: string) => void
  onReact?: (id: string, reaction: string) => void
  messageMeta?: { provider: string; model: string; durationMs: number }
  animateMount?: boolean
  isStreamingReplacement?: boolean
}

function MessageBubble({
  msg,
  onRegenerate,
  onEdit,
  onReact,
  messageMeta,
  animateMount = true,
  isStreamingReplacement = false,
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

  const [userReaction, setUserReaction] = useState<string | null>(null)

  const handleSave = useCallback(() => {
    if (editContent.trim() && editContent !== msg.content && onEdit) {
      onEdit(msg.id, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, msg.content, msg.id, onEdit])

  const handleReact = useCallback((reaction: string) => {
    setUserReaction((prev) => (prev === reaction ? null : reaction))
    onReact?.(msg.id, reaction)
  }, [msg.id, onReact])

  // Skip empty assistant placeholders used for tool-call context
  if (
    msg.role === 'assistant' &&
    msg.tool_name === 'tool_calls_init' &&
    !msg.content.trim()
  ) {
    return null
  }

  if (msg.role === 'tool') {
    let parsed: any = {}
    try {
      parsed = JSON.parse(msg.content)
    } catch {
      parsed = { stdout: msg.content, status: 'success' }
    }
    
    const toolResult = {
      tool_name: msg.tool_name || parsed.tool_name || 'unknown_tool',
      tool_id: msg.tool_call_id || parsed.tool_id || '',
      status: parsed.status || (parsed.error ? 'error' : 'success'),
      ...parsed
    }
    
    return (
      <div className="mx-auto max-w-3xl w-full">
        <ToolExecutionCard tool={toolResult} />
      </div>
    )
  }

  return (
    <motion.div
      id={`msg-${msg.id}`}
      data-message-role={msg.role}
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
              : `border border-border-subtle bg-layer/60 backdrop-blur-md rounded-2xl rounded-tl-sm px-5 py-3 text-text-primary ${isStreamingReplacement ? 'opacity-60' : ''}`
          }`}
        >
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[80px] rounded-carbon border border-border-subtle bg-background p-2 text-sm text-text-primary focus:border-interactive focus:outline-none focus:ring-1 focus:ring-focus"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setEditContent(msg.content)
                    setIsEditing(false)
                  }}
                  className="px-2 py-1 text-xs text-text-helper hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="rounded-carbon bg-interactive px-2 py-1 text-xs text-white hover:bg-interactive-hover"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {msg.content}
              </ReactMarkdown>
            </div>
          )}

          {msg.attachments && (
            <div className={`mt-2 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {(() => {
                try {
                  const parsed = JSON.parse(msg.attachments)
                  if (!Array.isArray(parsed)) return null
                  return parsed.map((name: string, i: number) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-carbon border border-border-subtle bg-background/50 px-2 py-1 text-[10px] text-text-secondary"
                    >
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      {name}
                    </span>
                  ))
                } catch {
                  return null
                }
              })()}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className={`mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {isAssistant && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label={copied ? 'Copied' : 'Copy response'}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label="Regenerate response"
                >
                  <RotateCcw className="h-3 w-3" />
                  Regenerate
                </button>
                <button
                  onClick={() => {
                    setEditContent(msg.content)
                    setIsEditing(true)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label="Edit response"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleReact('up')}
                  className={`p-1 transition-colors focus:outline-none focus:ring-1 focus:ring-focus ${
                    userReaction === 'up' ? 'text-interactive' : 'text-text-helper hover:text-text-primary'
                  }`}
                  aria-label="Thumbs up"
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleReact('down')}
                  className={`p-1 transition-colors focus:outline-none focus:ring-1 focus:ring-focus ${
                    userReaction === 'down' ? 'text-support-error' : 'text-text-helper hover:text-text-primary'
                  }`}
                  aria-label="Thumbs down"
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
              </>
            )}
            {isUser && (
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
        )}

        {/* Message meta */}
        {messageMeta && (
          <div className={`mt-1 flex items-center gap-2 text-[10px] text-text-helper ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" aria-hidden="true" />
              {messageMeta.provider || 'Unknown'} / {messageMeta.model || 'Unknown'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {messageMeta.durationMs}ms
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default React.memo(MessageBubble)
