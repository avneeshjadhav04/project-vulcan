import { useMemo, useLayoutEffect, useCallback, useRef, useState, forwardRef, useImperativeHandle } from 'react'
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

export interface ChatMessagesRef {
  requestSnapToLatestUserMessage: () => void
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

function ChatMessagesInner({
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
}: ChatMessagesProps, ref: React.ForwardedRef<ChatMessagesRef>) {
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
  const pendingSnapRef = useRef(false)
  const snapLockRef = useRef(false)
  const [focusedExchange, setFocusedExchange] = useState(false)

  const performSnapToLatestUserMessage = useCallback(() => {
    snapLockRef.current = true
    setFocusedExchange(true)
    // Treat the user as no longer near the bottom after the snap
    wasNearBottomRef.current = false
  }, [wasNearBottomRef])

  useImperativeHandle(ref, () => ({
    requestSnapToLatestUserMessage: () => {
      pendingSnapRef.current = true
    },
  }))

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

    // Track latest user message id for the IntersectionObserver button
    if (lastUserMessageId && lastUserMessageId !== lastUserMessageIdRef.current) {
      lastUserMessageIdRef.current = lastUserMessageId
      prevStreamingRef.current = streaming
      prevToolCountRef.current = toolExecutions.length
      prevStreamedLenRef.current = streamedContent.length
      prevEventTypeRef.current = null

      // If a snap was explicitly requested (e.g. send/regenerate/edit), perform it now that the message exists
      if (pendingSnapRef.current) {
        pendingSnapRef.current = false
        performSnapToLatestUserMessage()

        const element = document.getElementById(`msg-${lastUserMessageId}`)
        if (container && element) {
          const top = element.offsetTop - 16
          container.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
        }
      } else {
        // New message appeared without an explicit snap request (e.g. switching chats or receiving a response)
        setFocusedExchange(false)
      }
      return
    }

    const wasStreaming = prevStreamingRef.current
    const prevToolCount = prevToolCountRef.current
    const prevStreamedLen = prevStreamedLenRef.current

    // Update refs after reading previous values
    prevStreamingRef.current = streaming
    prevToolCountRef.current = toolExecutions.length
    prevStreamedLenRef.current = streamedContent.length

    // When stream ends, keep focused exchange so short responses don't reveal previous content
    if (wasStreaming && !streaming) {
      prevEventTypeRef.current = null
      return
    }

    if (!streaming) return

    const toolCountIncreased = toolExecutions.length > prevToolCount
    const streamedLenIncreased = streamedContent.length > prevStreamedLen

    if (toolCountIncreased) {
      prevEventTypeRef.current = 'tool'
      // On the first tool event after a snap, unlock and skip auto-follow so the user message stays pinned
      if (snapLockRef.current) {
        snapLockRef.current = false
        return
      }
      // Follow the tool chain only if user is already near the bottom
      if (wasNearBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      }
      return
    }

    if (streamedLenIncreased) {
      const prevEventType = prevEventTypeRef.current
      prevEventTypeRef.current = 'text'
      // Clear snap lock once response content begins
      snapLockRef.current = false

      // Only jump back when the first text chunk arrives after tools, and only if user is near the bottom
      if (prevEventType === 'tool' && wasNearBottomRef.current) {
        scrollToElement('msg-streaming')
      }
      return
    }
  }, [visibleMessages.length, streamedContent, toolExecutions.length, streaming, scrollContainerRef, wasNearBottomRef, lastUserMessageIndex, visibleMessages, scrollToLatestResponse, scrollToElement, performSnapToLatestUserMessage])

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

            {(focusedExchange || streaming) && (
              <div className="min-h-[100vh]">
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

                {streaming && !streamedContent && toolExecutions.length === 0 && (
                  <TypingIndicator />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ScrollToBottom onClick={scrollToLatestResponse} visible={showScrollBtn} />
    </div>
  )
}

const ChatMessages = forwardRef(ChatMessagesInner)
export default ChatMessages
