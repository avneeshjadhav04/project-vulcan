import { useRef, useState, useCallback, useLayoutEffect } from 'react'

const SCROLL_THRESHOLD = 150

export function useChatScroll(
  chatId?: string,
  options?: { suppressResetRef?: React.MutableRefObject<boolean> }
) {
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

  // Reset scroll position when switching chats. When a new chat is being
  // created, a snap-to-latest-user-message is pending, so we must not override
  // it by scrolling to the bottom.
  useLayoutEffect(() => {
    if (options?.suppressResetRef?.current) {
      options.suppressResetRef.current = false
      return
    }

    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setShowScrollBtn(false)
      wasNearBottomRef.current = true
    }
  }, [chatId, options])

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
