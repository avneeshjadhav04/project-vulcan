import { useState, useEffect } from 'react'

export function useRelativeTime(dateString: string): string {
  const [relative, setRelative] = useState(() => computeTimeAgo(dateString))

  useEffect(() => {
    setRelative(computeTimeAgo(dateString))
    const interval = setInterval(() => {
      setRelative(computeTimeAgo(dateString))
    }, 60000)
    return () => clearInterval(interval)
  }, [dateString])

  return relative
}

function computeTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
