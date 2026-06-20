import { useMemo, useLayoutEffect, useCallback, useRef } from 'react'
import MessageBubble from './MessageBubble'
import StreamingMessage from './StreamingMessage'
import TypingIndicator from './TypingIndicator'
import ToolExecutionCard from './ToolExecutionCard'
import EmptyState from './EmptyState'
import ScrollToBottom from './ScrollToBottom'
import type { ToolExecution } from '../../hooks/useChatStream'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
  tool_name?: string
}

interface ChatMessagesProps {
  messages: MessageItem[]
  streaming: boolean
  streamedContent: string
  toolExecutions: ToolExecution[]
  creatingChat: boolean
  chatId?: string
  messageMeta: Record<string, { provider: string; model: string; durationMs: number }>
  showScrollBtn: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement>
  wasNearBottomRef: React.MutableRefObject<boolean>
  setShowScrollBtn: React.Dispatch<React.SetStateAction<boolean>>
  onScroll: () => void
  onRegenerate: () => void
  onEditMessage: (id: string, content: string) => void
  onSuggestion: (text: string) => void
}

export default function ChatMessages({
  messages,
  streaming,
  streamedContent,
  toolExecutions,
  creatingChat,
  chatId,
  messageMeta,
  showScrollBtn,
  scrollContainerRef,
  wasNearBottomRef,
  setShowScrollBtn,
  onScroll,
  onRegenerate,
  onEditMessage,
  onSuggestion,
}: ChatMessagesProps) {
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !(m.role === 'assistant' && m.tool_name === 'tool_calls_init' && !m.content.trim())
      ),
    [messages]
  )

  const lastAssistantIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'assistant') return i
    }
    return -1
  }, [visibleMessages])

  const lastUserMessageIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'user') return i
    }
    return -1
  }, [visibleMessages])

  const lastUserMessageIdRef = useRef<string | null>(null)
  const prevStreamingRef = useRef(streaming)
  const prevToolCountRef = useRef(toolExecutions.length)
  const prevStreamedLenRef = useRef(streamedContent.length)
  const prevEventTypeRef = useRef<'text' | 'tool' | null>(null)

  const scrollToLatestResponse = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const lastUserMsg = lastUserMessageIndex >= 0 ? visibleMessages[lastUserMessageIndex] : null
    const element = lastUserMsg ? document.getElementById(`msg-${lastUserMsg.id}`) : null

    if (element) {
      const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [lastUserMessageIndex, visibleMessages, scrollContainerRef])

  const scrollToElement = useCallback((id: string) => {
    const container = scrollContainerRef.current
    if (!container) return
    const element = document.getElementById(id)
    if (!element) return
    const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [scrollContainerRef])

  // IntersectionObserver to show/hide scroll button based on latest user message visibility
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    const lastUserMsg = lastUserMessageIndex >= 0 ? visibleMessages[lastUserMessageIndex] : null
    if (!container || !lastUserMsg) {
      setShowScrollBtn(false)
      return
    }

    const element = document.getElementById(`msg-${lastUserMsg.id}`)
    if (!element) {
      setShowScrollBtn(false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollBtn(!entry.isIntersecting)
      },
      { root: container, threshold: 0 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [lastUserMessageIndex, visibleMessages, scrollContainerRef, setShowScrollBtn])

  // Auto-scroll when new content arrives (after DOM commit, before paint)
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const lastUserMessage = lastUserMessageIndex >= 0 ? visibleMessages[lastUserMessageIndex] : null
    const lastUserMessageId = lastUserMessage?.id || null

    // If a new user message was just added, smooth-scroll to it
    if (lastUserMessageId && lastUserMessageId !== lastUserMessageIdRef.current) {
      scrollToLatestResponse()
      lastUserMessageIdRef.current = lastUserMessageId
      prevStreamingRef.current = streaming
      prevToolCountRef.current = toolExecutions.length
      prevStreamedLenRef.current = streamedContent.length
      prevEventTypeRef.current = null
      return
    }

    const wasStreaming = prevStreamingRef.current
    const prevToolCount = prevToolCountRef.current
    const prevStreamedLen = prevStreamedLenRef.current

    // Update refs after reading previous values
    prevStreamingRef.current = streaming
    prevToolCountRef.current = toolExecutions.length
    prevStreamedLenRef.current = streamedContent.length

    // When stream ends, do nothing
    if (wasStreaming && !streaming) {
      prevEventTypeRef.current = null
      return
    }

    if (!streaming) return

    const toolCountIncreased = toolExecutions.length > prevToolCount
    const streamedLenIncreased = streamedContent.length > prevStreamedLen

    if (toolCountIncreased) {
      prevEventTypeRef.current = 'tool'
      // Follow the tool chain only if user is already near the bottom
      if (wasNearBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      }
      return
    }

    if (streamedLenIncreased) {
      const prevEventType = prevEventTypeRef.current
      prevEventTypeRef.current = 'text'

      // Only scroll for the first text chunk of this response, and only if user is near the bottom
      if (prevEventType !== 'text' && wasNearBottomRef.current) {
        if (prevEventType === 'tool') {
          // First text after tools: jump back to the start of the streaming response
          scrollToElement('msg-streaming')
        } else {
          // First text of a new response (no preceding tools): anchor at user message
          scrollToLatestResponse()
        }
      }
      return
    }
  }, [visibleMessages.length, streamedContent, toolExecutions.length, streaming, scrollContainerRef, wasNearBottomRef, lastUserMessageIndex, visibleMessages, scrollToLatestResponse, scrollToElement])

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="relative flex-1 overflow-y-auto"
    >
      <div className="mx-auto max-w-3xl px-4 pb-4">
        {creatingChat ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin border-2 border-interactive border-t-transparent" />
            <p className="mt-3 text-xs text-text-helper">Creating chat...</p>
          </div>
        ) : messages.length === 0 && !streaming && !streamedContent ? (
          <EmptyState onSuggestion={onSuggestion} />
        ) : (
          <>
            {visibleMessages.map((msg, index) => {
              const isLastAssistant = msg.role === 'assistant' && index === visibleMessages.length - 1
              return (
                <MessageBubble
                  key={msg.id}
                  chatId={chatId}
                  msg={msg}
                  onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
                  onEdit={msg.role === 'user' ? onEditMessage : undefined}
                  messageMeta={messageMeta[msg.id]}
                  animateMount={!(isLastAssistant && !streamedContent)}
                  isStreamingReplacement={isLastAssistant && !!streamedContent}
                />
              )
            })}

            {toolExecutions.length > 0 && streaming && (
              <div className="space-y-2">
                {toolExecutions.map((tool, index) => (
                  <ToolExecutionCard
                    key={`${tool.tool_id}-${index}`}
                    tool={tool}
                    chatId={chatId}
                    defaultExpanded={index === toolExecutions.length - 1}
                  />
                ))}
              </div>
            )}

            {streamedContent && (
              <StreamingMessage content={streamedContent} isStreaming={streaming} />
            )}

            {streaming && !streamedContent && toolExecutions.length === 0 && <TypingIndicator />}
          </>
        )}
      </div>

      <ScrollToBottom onClick={scrollToLatestResponse} visible={showScrollBtn} />
    </div>
  )
}
