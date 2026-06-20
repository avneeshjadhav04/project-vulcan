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
  const responseAreaRef = useRef<HTMLDivElement>(null)
  const [focusedExchange, setFocusedExchange] = useState(false)
  const [responseMinHeight, setResponseMinHeight] = useState(0)

  const performSnapToLatestUserMessage = useCallback(() => {
    snapLockRef.current = true
    setFocusedExchange(true)
    // Treat the user as no longer near the bottom after the snap
    wasNearBottomRef.current = false
  }, [wasNearBottomRef])

  // Compute the min-height the response area should occupy so its bottom
  // aligns exactly with the viewport bottom (minus the inner wrapper's pb-4).
  // Uses CONTENT coordinates (scroll-invariant) rather than viewport
  // coordinates so the result is stable across scroll-position changes — this
  // avoids a feedback loop where shrinking the fill would clamp scrollTop
  // upward and unpin the user message.
  //
  // During streaming the persisted assistant message isn't rendered yet, so
  // the gap above the fill is 0 and this matches the working "fill below the
  // user message" behavior. After stream-end the assistant message persists
  // above the fill, so the gap grows by its height and the fill shrinks
  // accordingly — keeping the fill bottom at the viewport bottom (no
  // scroll-down blank) without shifting the user message off the top.
  // Falls back to the last user message's content bottom when the fill div
  // isn't mounted yet (first snap commit).
  const computeResponseMinHeight = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const toContentY = (el: HTMLElement) => el.getBoundingClientRect().top - containerRect.top + container.scrollTop
    const userMessages = container.querySelectorAll('[data-message-role="user"]')
    const lastUserElement = userMessages[userMessages.length - 1] as HTMLElement | undefined
    if (!lastUserElement) {
      setResponseMinHeight(container.clientHeight)
      return
    }
    // Intrinsic, scroll-invariant measurements (content coordinates):
    const userMsgHeight = lastUserElement.getBoundingClientRect().height
    const userBottomContentY = lastUserElement.getBoundingClientRect().bottom - containerRect.top + container.scrollTop
    const fillTopContentY = responseAreaRef.current ? toContentY(responseAreaRef.current) : userBottomContentY
    const gapBelowUserMsg = Math.max(0, fillTopContentY - userBottomContentY)
    // Subtract 16 to account for the inner wrapper's pb-4 padding so the
    // fill bottom + padding = container bottom (no scrollable overflow).
    const availableHeight = Math.max(0, container.clientHeight - userMsgHeight - gapBelowUserMsg - 16)
    setResponseMinHeight(availableHeight)
  }, [scrollContainerRef])

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
          // Compute the response fill height after the scroll lands so the
          // pinned user message sits at the top and the streaming area fills below.
          computeResponseMinHeight()
        }
      } else {
        // New message appeared without an explicit snap request (e.g. switching chats or receiving a response).
        // If streaming is active, this is the optimistic temp message being replaced by the real
        // server message — keep the focused exchange intact so the streaming area stays anchored,
        // but recompute the fill height in case the real message renders at a slightly different size.
        if (!streaming) {
          setFocusedExchange(false)
          setResponseMinHeight(0)
        } else if (focusedExchange) {
          computeResponseMinHeight()
        }
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

    // When stream ends, keep focused exchange so short responses don't reveal
    // previous content, but recompute the fill height — the persisted assistant
    // message is about to render above the fill div, which lowers its top and
    // must shrink the fill to keep its bottom aligned with the viewport bottom.
    if (wasStreaming && !streaming) {
      prevEventTypeRef.current = null
      computeResponseMinHeight()
      return
    }

    if (!streaming) return

    // If a snap is still pending (message not yet rendered), don't let stream
    // chunks move the scroll before the snap has a chance to fire.
    if (pendingSnapRef.current) return

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
  }, [visibleMessages.length, streamedContent, toolExecutions.length, streaming, scrollContainerRef, wasNearBottomRef, lastUserMessageIndex, visibleMessages, scrollToLatestResponse, scrollToElement, performSnapToLatestUserMessage, computeResponseMinHeight, focusedExchange])

  // Recalculate response min-height when the container resizes while focused
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !focusedExchange) return

    const updateHeight = () => computeResponseMinHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(container)
    // Observe the inner content wrapper too, so a change in message count /
    // streaming content (which grows the inner wrapper) triggers a recompute
    // even when the scroll container itself doesn't resize.
    const inner = container.firstElementChild as HTMLElement | null
    if (inner) observer.observe(inner)
    return () => observer.disconnect()
  }, [focusedExchange, scrollContainerRef, computeResponseMinHeight])

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="relative flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-4">
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

            {(focusedExchange || streaming) && responseMinHeight > 0 && (
              <div ref={responseAreaRef} className="flex flex-col" style={{ minHeight: responseMinHeight }}>
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
