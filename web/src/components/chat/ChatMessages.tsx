import { useMemo, useLayoutEffect, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import MessageBubble from './MessageBubble'
import StreamingMessage from './StreamingMessage'
import TypingIndicator from './TypingIndicator'
import ToolExecutionCard from './ToolExecutionCard'
import EmptyState from './EmptyState'
import ScrollToBottom from './ScrollToBottom'
import type { ToolExecution } from '../../hooks/useChatStream'

const LATEST_MESSAGE_TOP_OFFSET = 16

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

  const lastUserMessage = lastUserMessageIndex >= 0 ? visibleMessages[lastUserMessageIndex] : null
  const lastUserMessageId = lastUserMessage?.id || null
  const latestExchangeSpacerRef = useRef<HTMLDivElement>(null)
  const pendingSnapRef = useRef(false)
  const activeAnchorRef = useRef<{ id: string; content: string } | null>(null)
  const userScrolledSinceAnchorRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimeoutRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    requestSnapToLatestUserMessage: () => {
      pendingSnapRef.current = true
      activeAnchorRef.current = null
      userScrolledSinceAnchorRef.current = false
    },
  }))

  const setProgrammaticScrollGuard = useCallback((durationMs = 160) => {
    programmaticScrollRef.current = true
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current)
    }
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false
      programmaticScrollTimeoutRef.current = null
    }, durationMs)
  }, [])

  const clearLatestExchangeSpacer = useCallback(() => {
    if (latestExchangeSpacerRef.current) {
      latestExchangeSpacerRef.current.style.height = '0px'
    }
  }, [])

  const syncLatestExchangeSpacer = useCallback(() => {
    const container = scrollContainerRef.current
    const spacer = latestExchangeSpacerRef.current
    if (!container || !spacer || !lastUserMessageId) return null

    const element = document.getElementById(`msg-${lastUserMessageId}`)
    if (!element) return null

    spacer.style.height = '0px'

    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const targetTop = Math.max(
      0,
      elementRect.top - containerRect.top + container.scrollTop - LATEST_MESSAGE_TOP_OFFSET
    )
    const missingSpace = targetTop + container.clientHeight - container.scrollHeight
    const spacerHeight = Math.max(0, Math.ceil(missingSpace))
    spacer.style.height = `${spacerHeight}px`

    return targetTop
  }, [lastUserMessageId, scrollContainerRef])

  const scrollToLatestUserMessage = useCallback(
    (behavior: ScrollBehavior) => {
      const container = scrollContainerRef.current
      if (!container || !lastUserMessage) return false

      const targetTop = syncLatestExchangeSpacer()
      if (targetTop === null) return false

      setProgrammaticScrollGuard(behavior === 'smooth' ? 500 : 160)
      container.scrollTo({ top: targetTop, behavior })
      setShowScrollBtn(false)
      return true
    },
    [
      lastUserMessage,
      scrollContainerRef,
      setProgrammaticScrollGuard,
      setShowScrollBtn,
      syncLatestExchangeSpacer,
    ]
  )

  const scrollToLatestResponse = useCallback(() => {
    if (lastUserMessage) {
      activeAnchorRef.current = {
        id: lastUserMessage.id,
        content: lastUserMessage.content,
      }
      userScrolledSinceAnchorRef.current = false
      if (scrollToLatestUserMessage('smooth')) return
    }

    const container = scrollContainerRef.current
    if (!container) return
    setProgrammaticScrollGuard(500)
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [lastUserMessage, scrollContainerRef, scrollToLatestUserMessage, setProgrammaticScrollGuard])

  const handleMessagesScroll = useCallback(() => {
    onScroll()
    if (!programmaticScrollRef.current) {
      userScrolledSinceAnchorRef.current = true
    }
  }, [onScroll])

  // Reset active exchange bookkeeping when switching chats. A pending snap can
  // intentionally survive this transition for newly-created chats.
  useEffect(() => {
    activeAnchorRef.current = null
    userScrolledSinceAnchorRef.current = false
    programmaticScrollRef.current = false
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current)
      programmaticScrollTimeoutRef.current = null
    }
    clearLatestExchangeSpacer()
  }, [chatId, clearLatestExchangeSpacer])

  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current)
      }
    }
  }, [])

  // IntersectionObserver to show/hide scroll button based on latest user message visibility
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !lastUserMessage) {
      setShowScrollBtn(false)
      return
    }

    const element = document.getElementById(`msg-${lastUserMessage.id}`)
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
  }, [lastUserMessage, scrollContainerRef, setShowScrollBtn])

  // Keep the latest exchange anchor scrollable, then snap only for explicit sends/regenerations.
  useLayoutEffect(() => {
    if (!lastUserMessage) {
      clearLatestExchangeSpacer()
      return
    }

    if (pendingSnapRef.current) {
      if (scrollToLatestUserMessage('auto')) {
        pendingSnapRef.current = false
        activeAnchorRef.current = {
          id: lastUserMessage.id,
          content: lastUserMessage.content,
        }
      }
      return
    }

    const activeAnchor = activeAnchorRef.current
    if (activeAnchor?.content === lastUserMessage.content) {
      const targetTop = syncLatestExchangeSpacer()
      const serverReplacedOptimisticMessage = activeAnchor.id !== lastUserMessage.id

      if (
        targetTop !== null &&
        serverReplacedOptimisticMessage &&
        !userScrolledSinceAnchorRef.current
      ) {
        setProgrammaticScrollGuard()
        scrollContainerRef.current?.scrollTo({ top: targetTop, behavior: 'auto' })
        activeAnchorRef.current = {
          id: lastUserMessage.id,
          content: lastUserMessage.content,
        }
      }
      return
    }

    clearLatestExchangeSpacer()
  }, [
    lastUserMessage,
    streamedContent,
    toolExecutions.length,
    streaming,
    scrollContainerRef,
    scrollToLatestUserMessage,
    setProgrammaticScrollGuard,
    syncLatestExchangeSpacer,
    clearLatestExchangeSpacer,
  ])

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleMessagesScroll}
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
              const isLatestUserMessage = msg.role === 'user' && index === lastUserMessageIndex
              const isActiveLatestUserMessage =
                isLatestUserMessage &&
                (pendingSnapRef.current || activeAnchorRef.current?.content === msg.content)
              return (
                <MessageBubble
                  key={msg.id}
                  chatId={chatId}
                  msg={msg}
                  onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
                  onEdit={msg.role === 'user' ? onEditMessage : undefined}
                  messageMeta={messageMeta[msg.id]}
                  animateMount={!isActiveLatestUserMessage && !(isLastAssistant && !streamedContent)}
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

            <div ref={latestExchangeSpacerRef} aria-hidden="true" className="shrink-0" />
          </>
        )}
      </div>

      <ScrollToBottom onClick={scrollToLatestResponse} visible={showScrollBtn} />
    </div>
  )
}

const ChatMessages = forwardRef(ChatMessagesInner)
export default ChatMessages
