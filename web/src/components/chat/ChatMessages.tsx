import { useMemo, useLayoutEffect, useCallback, useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'
import ToolExecutionCard from './ToolExecutionCard'
import EmptyState from './EmptyState'
import ScrollToBottom from './ScrollToBottom'
import type { ToolExecution } from '../../hooks/useChatStream'
import { api } from '../../lib/api'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
  tool_name?: string
  tool_call_id?: string
  parent_id?: string
  streaming?: boolean
}

interface VariantInfo {
  message_id: string
  parent_id: string
  total: number
  role: string
}

export interface ChatMessagesRef {
  requestSnapToLatestUserMessage: () => void
}

interface ChatMessagesProps {
  messages: MessageItem[]
  variants: VariantInfo[]
  streaming: boolean
  streamedContent: string
  toolExecutions: ToolExecution[]
  creatingChat: boolean
  chatId?: string
  navigatedData?: { messages: MessageItem[]; variants: VariantInfo[] } | null
  messageMeta: Record<string, { provider: string; model: string; durationMs: number }>
  showScrollBtn: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement>
  wasNearBottomRef: React.MutableRefObject<boolean>
  setShowScrollBtn: React.Dispatch<React.SetStateAction<boolean>>
  onScroll: () => void
  onRegenerate: (assistantMsgId?: string) => void
  onActivateVariant: (msgId: string) => void
  onEditMessage: (id: string, content: string) => void
  onSuggestion: (text: string) => void
}

function ChatMessagesInner({
  messages,
  variants,
  streaming,
  streamedContent,
  toolExecutions,
  creatingChat,
  chatId,
  navigatedData,
  messageMeta,
  showScrollBtn,
  scrollContainerRef,
  wasNearBottomRef,
  setShowScrollBtn,
  onScroll,
  onRegenerate,
  onActivateVariant,
  onEditMessage,
  onSuggestion,
}: ChatMessagesProps, ref: React.ForwardedRef<ChatMessagesRef>) {
  const activeMessages = navigatedData?.messages ?? messages
  const activeVariants = navigatedData?.variants ?? variants

  const visibleMessages = useMemo(
    () =>
      activeMessages.filter(
        (m) => !(m.role === 'assistant' && m.tool_name === 'tool_calls_init' && !m.content.trim())
      ),
    [activeMessages]
  )

  // Fetch sibling lists for messages that have activeVariants (total > 1).
  // siblingCache: parent_id -> { ids: string[], total: number }
  // total is stored so we can detect when regeneration adds a new sibling
  // (total increases) and refetch the updated id list.
  // activeIndex is computed at render time from the current msg.id.
  const [siblingCache, setSiblingCache] = useState<Record<string, { ids: string[]; total: number }>>({})

  // Clear cache when switching chats
  useEffect(() => {
    setSiblingCache({})
  }, [chatId])

  useEffect(() => {
    if (!chatId || activeVariants.length === 0) return
    // Refetch when: parent_id not in cache, OR cached total differs from
    // variant total (new sibling added by regeneration).
    const toFetch = activeVariants.filter((v) => {
      const cached = siblingCache[v.parent_id]
      return !cached || cached.total !== v.total
    })
    if (toFetch.length === 0) return

    const fetchSiblings = async (pid: string, currentMsgId: string, total: number) => {
      try {
        const res = await api.get(`/chats/${chatId}/messages/${currentMsgId}/siblings`)
        const siblings: Array<{ id: string; is_active: boolean }> = res.data.siblings || []
        const ids = siblings.map((s) => s.id)
        setSiblingCache((prev) => ({ ...prev, [pid]: { ids, total } }))
      } catch {
        // silently fail — navigator just won't show
      }
    }

    for (const v of toFetch) {
      fetchSiblings(v.parent_id, v.message_id, v.total)
    }
  }, [chatId, activeVariants, siblingCache])

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

  useImperativeHandle(ref, () => ({
    requestSnapToLatestUserMessage: () => {},
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

  // Reset tracking refs when switching chats
  useEffect(() => {
    lastUserMessageIdRef.current = null
    prevStreamingRef.current = false
    prevToolCountRef.current = 0
    prevStreamedLenRef.current = 0
    prevEventTypeRef.current = null
  }, [chatId])

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

      // Only jump back when the first text chunk arrives after tools, and only if user is near the bottom
      if (prevEventType === 'tool' && wasNearBottomRef.current) {
        scrollToElement('msg-streaming')
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
              const isLastStreaming = isLastAssistant && (msg.streaming || !!(streaming && streamedContent && index === visibleMessages.length - 1))
              const variantInfo = (msg.role === 'assistant' || msg.role === 'user') && msg.parent_id
                ? activeVariants.find((v) => v.message_id === msg.id)
                : undefined
              const cached = variantInfo && msg.parent_id ? siblingCache[msg.parent_id] : undefined
              const siblingIds = cached?.ids
              const computedVariantInfo = variantInfo && siblingIds
                ? { total: variantInfo.total, activeIndex: Math.max(0, siblingIds.indexOf(msg.id)), siblingIds }
                : variantInfo
                ? { total: variantInfo.total, activeIndex: 0, siblingIds: [msg.id] }
                : undefined
              return (
                <MessageBubble
                  key={msg.id}
                  chatId={chatId}
                  msg={isLastStreaming && streamedContent ? { ...msg, content: streamedContent } : msg}
                  onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
                  onEdit={msg.role === 'user' ? onEditMessage : undefined}
                  onActivateVariant={onActivateVariant}
                  messageMeta={messageMeta[msg.id]}
                  animateMount={!isLastStreaming}
                  isStreamingReplacement={isLastStreaming}
                  streaming={isLastStreaming}
                  variantInfo={computedVariantInfo}
                />
              )
            })}

            {streaming && streamedContent && !visibleMessages.some((m) => m.role === 'assistant' && m.streaming) && (
              <MessageBubble
                chatId={chatId}
                msg={{ id: 'msg-streaming', role: 'assistant', content: streamedContent, created_at: new Date().toISOString() }}
                streaming
                isStreamingReplacement
                animateMount={false}
              />
            )}

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

            {streaming && !streamedContent && toolExecutions.length === 0 && <TypingIndicator />}
          </>
        )}
      </div>

      <ScrollToBottom onClick={scrollToLatestResponse} visible={showScrollBtn} />
    </div>
  )
}

const ChatMessages = forwardRef(ChatMessagesInner)
export default ChatMessages
