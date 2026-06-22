import { useState, useCallback } from 'react'

export function useChatExport(chatId?: string) {
  const [exporting, setExporting] = useState<string | null>(null)

  const exportChat = useCallback(
    async (format: string) => {
      if (!chatId) return
      setExporting(format)

      try {
        const res = await fetch(`/api/chats/${chatId}/export?format=${format}`, {
          credentials: 'include',
        })

        if (!res.ok) {
          throw new Error(`Export failed: ${res.status}`)
        }

        const blob = await res.blob()
        const contentType = res.headers.get('content-type') || 'text/plain'
        const contentDisposition = res.headers.get('content-disposition')
        let filename = `chat-export.${format === 'json' ? 'json' : 'md'}`

        if (contentDisposition) {
          const match = contentDisposition.match(/filename="([^"]+)"/)
          if (match) {
            filename = match[1]
          }
        }

        const url = window.URL.createObjectURL(new Blob([blob], { type: contentType }))
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      } catch (err) {
        console.error('Export failed:', err)
        alert('Export failed. Please try again.')
      } finally {
        setExporting(null)
      }
    },
    [chatId]
  )

  return { exporting, exportChat }
}
