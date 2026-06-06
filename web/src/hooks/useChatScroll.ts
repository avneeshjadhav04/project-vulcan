import { useRef, useState, useCallback, useEffect } from 'react'

export function useChatScroll(chatId?: string) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isAutoScrollingRef = useRef(false)
  const observerRef = useRef<MutationObserver | null>(null)

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    setShowScrollBtn(!nearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    isAutoScrollingRef.current = true
    messagesEndRef.current?.scrollIntoView({ behavior })
    setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 300)
  }, [])

  // Reset scroll position when switching chats
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
    setShowScrollBtn(false)
  }, [chatId])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleMutation = () => {
      if (isAutoScrollingRef.current) return
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 250
      if (nearBottom) {
        // Use 'auto' behavior during fast streaming to avoid jumpy smooth scrolling animations
        scrollToBottom('auto')
      }
    }

    observerRef.current = new MutationObserver(handleMutation)
    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [scrollToBottom])

  return {
    messagesEndRef,
    scrollContainerRef,
    showScrollBtn,
    handleScroll,
    scrollToBottom,
  }
}
