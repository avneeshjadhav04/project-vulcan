import { useMemo, useLayoutEffect } from 'react'
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
  onScroll: () => void
  onScrollToBottom: () => void
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
  onScroll,
  onScrollToBottom,
  onRegenerate,
  onEditMessage,
  onSuggestion,
}: ChatMessagesProps) {
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  }, [messages])

  // Auto-scroll when new content arrives (after DOM commit, before paint)
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    if (wasNearBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
    }
  }, [messages.length, streamedContent, toolExecutions.length, scrollContainerRef, wasNearBottomRef])

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
            {messages.map((msg, index) => {
              const isLastAssistant = msg.role === 'assistant' && index === messages.length - 1
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

      <ScrollToBottom onClick={onScrollToBottom} visible={showScrollBtn} />
    </div>
  )
}
