import { useRef, useState, useCallback, useEffect } from 'react'

export function useChatScroll({
  streamedContent,
  messages,
}: {
  streamedContent: string
  messages: any[]
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isAutoScrollingRef = useRef(false)
  const scrollDebounceRef = useRef<any>(null)

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    setShowScrollBtn(!nearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Smart auto-scroll: only scroll if user is near bottom
  useEffect(() => {
    if (scrollDebounceRef.current) {
      cancelAnimationFrame(scrollDebounceRef.current)
    }
    scrollDebounceRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (!container) return
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
      if (nearBottom && !isAutoScrollingRef.current) {
        isAutoScrollingRef.current = true

        let targetElement: Element | null = null
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            targetElement = document.getElementById(`msg-${messages[i].id}`)
            break
          }
        }

        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }

        setTimeout(() => {
          isAutoScrollingRef.current = false
        }, 300)
      }
    })

    return () => {
      if (scrollDebounceRef.current) {
        cancelAnimationFrame(scrollDebounceRef.current)
      }
    }
  }, [messages]) // Removed streamedContent so it doesn't constantly yank scroll down while reading

  // Reset scroll position when switching chats
  const chatContextId = messages.length === 0 ? 'empty' : messages[0]?.chat_id
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
    setShowScrollBtn(false)
  }, [chatContextId])

  return {
    messagesEndRef,
    scrollContainerRef,
    showScrollBtn,
    handleScroll,
    scrollToBottom,
  }
}
