import { useRef, useState, useCallback, useLayoutEffect } from 'react'

const SCROLL_THRESHOLD = 150

export function useChatScroll(chatId?: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const wasNearBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD
    wasNearBottomRef.current = nearBottom
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    setShowScrollBtn(false)
    wasNearBottomRef.current = true
  }, [])

  const forceScrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
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
    showScrollBtn,
    setShowScrollBtn,
    handleScroll,
    scrollToBottom,
    forceScrollToBottom,
    wasNearBottomRef,
  }
}
