import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion } from 'framer-motion'
import {
  Copy,
  Check,
  RotateCcw,
  Pencil,
  Cpu,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { markdownComponents } from './markdownComponents'
import ToolExecutionCard from './ToolExecutionCard'
import { useThemeStore } from '../../stores/themeStore'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
  tool_name?: string
  tool_call_id?: string
  attachments?: string
  streaming?: boolean
}

interface MessageBubbleProps {
  msg: MessageItem
  chatId?: string
  onRegenerate?: (assistantMsgId?: string) => void
  onEdit?: (id: string, content: string) => void
  onActivateVariant?: (msgId: string) => void
  messageMeta?: { provider: string; model: string; durationMs: number }
  animateMount?: boolean
  isStreamingReplacement?: boolean
  streaming?: boolean
  variantInfo?: { total: number; activeIndex: number; siblingIds: string[] }
}

function MessageBubble({
  msg,
  onRegenerate,
  onEdit,
  onActivateVariant,
  messageMeta,
  animateMount = true,
  isStreamingReplacement = false,
  streaming = false,
  variantInfo,
}: MessageBubbleProps) {
  const isAssistant = msg.role === 'assistant'
  const isUser = msg.role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(msg.content)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [msg.content])

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)

  const handleSave = useCallback(() => {
    if (editContent.trim() && editContent !== msg.content && onEdit) {
      onEdit(msg.id, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, msg.content, msg.id, onEdit])

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
      className={`group py-3 ${isUser ? 'flex flex-row-reverse' : ''}`}
    >
      {/* Content */}
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div className={`mb-1 flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-[11px] font-semibold text-text-primary">
            {isAssistant ? 'AI' : 'You'}
          </span>
        </div>

        <div
          className={`inline-block text-left shadow-sm ${
            isUser
              ? 'bg-interactive text-on-interactive rounded-2xl rounded-tr-sm px-5 py-3'
              : `border border-border-subtle bg-layer/60 backdrop-blur-md rounded-2xl rounded-tl-sm px-5 py-3 text-text-primary ${isStreamingReplacement ? 'opacity-60' : ''}`
          }`}
        >
          {streaming && (
            <div className="mb-2 flex items-center gap-1.5 text-[10px] text-text-helper">
              <div className="h-2 w-2 animate-pulse rounded-full bg-interactive" />
              Writing…
            </div>
          )}
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
                  className="rounded-carbon bg-interactive px-2 py-1 text-xs text-on-interactive hover:bg-interactive-hover"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className={`prose prose-sm max-w-none ${resolvedTheme === 'light' ? 'prose-slate' : 'prose-invert'}`}>
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
                {variantInfo && variantInfo.total > 1 && (
                  <div className="flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => {
                        const prevIndex = variantInfo.activeIndex - 1
                        if (prevIndex >= 0 && onActivateVariant) {
                          onActivateVariant(variantInfo.siblingIds[prevIndex])
                        }
                      }}
                      disabled={variantInfo.activeIndex <= 0}
                      className="p-1 text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Previous variant"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="px-1 text-[11px] text-text-helper select-none tabular-nums">
                      {variantInfo.activeIndex + 1}/{variantInfo.total}
                    </span>
                    <button
                      onClick={() => {
                        const nextIndex = variantInfo.activeIndex + 1
                        if (nextIndex < variantInfo.total && onActivateVariant) {
                          onActivateVariant(variantInfo.siblingIds[nextIndex])
                        }
                      }}
                      disabled={variantInfo.activeIndex >= variantInfo.total - 1}
                      className="p-1 text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Next variant"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => onRegenerate?.(msg.id)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label="Regenerate response"
                >
                  <RotateCcw className="h-3 w-3" />
                  Regenerate
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label={copied ? 'Copied' : 'Copy response'}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {msg.tokens_used != null && (
                  <span className="px-2 py-1 text-[11px] text-text-helper select-none">
                    Tokens: {msg.tokens_used.toLocaleString()}
                  </span>
                )}
              </>
            )}
            {isUser && (
              <>
                {variantInfo && variantInfo.total > 1 && (
                  <div className="flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => {
                        const prevIndex = variantInfo.activeIndex - 1
                        if (prevIndex >= 0 && onActivateVariant) {
                          onActivateVariant(variantInfo.siblingIds[prevIndex])
                        }
                      }}
                      disabled={variantInfo.activeIndex <= 0}
                      className="p-1 text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Previous variant"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="px-1 text-[11px] text-text-helper select-none tabular-nums">
                      {variantInfo.activeIndex + 1}/{variantInfo.total}
                    </span>
                    <button
                      onClick={() => {
                        const nextIndex = variantInfo.activeIndex + 1
                        if (nextIndex < variantInfo.total && onActivateVariant) {
                          onActivateVariant(variantInfo.siblingIds[nextIndex])
                        }
                      }}
                      disabled={variantInfo.activeIndex >= variantInfo.total - 1}
                      className="p-1 text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Next variant"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
                  aria-label={copied ? 'Copied' : 'Copy message'}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
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
              </>
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
