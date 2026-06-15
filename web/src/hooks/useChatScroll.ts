import { useRef, useState, useCallback, useEffect } from 'react'

const SCROLL_THRESHOLD = 150

export function useChatScroll(chatId?: string) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isAutoScrollingRef = useRef(false)
  const observerRef = useRef<MutationObserver | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD
    setShowScrollBtn(!nearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    isAutoScrollingRef.current = true
    messagesEndRef.current?.scrollIntoView({ behavior })
    
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    
    debounceTimerRef.current = setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 500)
  }, [])

  // Reset scroll position when switching chats
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      // Use requestAnimationFrame to ensure DOM is fully updated
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
        setShowScrollBtn(false)
      })
    }
  }, [chatId])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleMutation = () => {
      if (isAutoScrollingRef.current) return
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const nearBottom = distanceFromBottom < SCROLL_THRESHOLD
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
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
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
