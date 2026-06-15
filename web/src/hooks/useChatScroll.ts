import { useRef, useState, useCallback, useLayoutEffect } from 'react'

const SCROLL_THRESHOLD = 150

export function useChatScroll(chatId?: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const wasNearBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD
    wasNearBottomRef.current = nearBottom
    setShowScrollBtn(!nearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior })
    setShowScrollBtn(false)
    wasNearBottomRef.current = true
  }, [])

  // Reset scroll position when switching chats
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setShowScrollBtn(false)
      wasNearBottomRef.current = true
    }
  }, [chatId])

  return {
    containerRef,
    endRef,
    showScrollBtn,
    handleScroll,
    scrollToBottom,
    wasNearBottomRef,
  }
}
