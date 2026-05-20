import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { SelectedModel } from '../components/ProviderModelSelector'

export interface StreamState {
  streaming: boolean
  streamedContent: string
  sendError: string
  toolExecution: { command: string; stdout: string; stderr: string; status: string } | null
  creatingChat: boolean
}

export interface StreamActions {
  startStream: (text: string, options: StreamOptions) => Promise<void>
  stopStream: () => void
  clearStreamedContent: () => void
}

export interface StreamOptions {
  effectiveChatId?: string
  selectedModel: SelectedModel
  setEffectiveChatId: (id: string) => void
  setOptimisticTitle: (title: string) => void
  attachedFiles: any[]
  onStreamDone?: (meta: { provider: string; model: string; durationMs: number }) => void
  onStreamError?: (error: string) => void
  refetchChat: () => Promise<any>
  windowHistoryReplace: (chatId: string) => void
  onChatCreated?: () => void
}

export function useChatStream(): [StreamState, StreamActions] {
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [sendError, setSendError] = useState('')
  const [toolExecution, setToolExecution] = useState<{ command: string; stdout: string; stderr: string; status: string } | null>(null)
  const [creatingChat, setCreatingChat] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setStreamedContent('')
    setToolExecution(null)
  }, [])

  const clearStreamedContent = useCallback(() => {
    setStreamedContent('')
    setToolExecution(null)
  }, [])

  const startStream = useCallback(async (text: string, options: StreamOptions) => {
    const {
      effectiveChatId,
      selectedModel,
      setEffectiveChatId,
      setOptimisticTitle,
      attachedFiles,
      onStreamDone,
      onStreamError,
      refetchChat,
      windowHistoryReplace,
      onChatCreated,
    } = options

    setStreaming(true)
    setStreamedContent('')
    setSendError('')
    setToolExecution(null)
    startTimeRef.current = Date.now()

    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      let currentChatId = effectiveChatId

      if (!currentChatId) {
        setCreatingChat(true)
        const createRes = await api.post('/chats', {
          title: text.slice(0, 50),
          model_id: selectedModel.modelId,
          provider_id: selectedModel.providerId || undefined,
        })
        currentChatId = createRes.data.id as string
        setEffectiveChatId(currentChatId)
        setOptimisticTitle(text.slice(0, 50))
        windowHistoryReplace(currentChatId)
        setCreatingChat(false)
        onChatCreated?.()
      } else {
        currentChatId = currentChatId as string
      }

      let messageContent = text
      if (attachedFiles.length > 0) {
        const fileContexts = attachedFiles
          .map((f: any) => {
            if (f.extracted_text) {
              return `[File: ${f.filename}]\n\`\`\`\n${f.extracted_text}\n\`\`\``
            }
            return `[File: ${f.filename}]`
          })
          .join('\n\n')
        messageContent = `${fileContexts}\n\n${text}`
      }

      const endpoint = `/api/chats/${currentChatId}/message`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '',
        },
        credentials: 'include',
        body: JSON.stringify({ content: messageContent }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login'
          return
        }
        if (res.status === 428) {
          throw new Error('Add an AI provider API key in Settings to start chatting.')
        }
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      const processBuffer = () => {
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)
            if (!raw.trim()) continue

            if (raw === '[DONE]') {
              setToolExecution(null)
              const duration = Date.now() - startTimeRef.current
              onStreamDone?.({
                provider: selectedModel.providerId || '',
                model: selectedModel.modelId,
                durationMs: duration,
              })
              setStreaming(false)
              return true
            }

            if (raw.startsWith('[ERR]') && raw.endsWith('[/ERR]')) {
              const errorMsg = raw.slice(5, -6)
              setSendError(errorMsg || 'An error occurred')
              onStreamError?.(errorMsg || 'An error occurred')
              setStreaming(false)
              return true
            }

            if (raw.startsWith('[TOOL]') && raw.endsWith('[/TOOL]')) {
              try {
                const toolData = JSON.parse(raw.slice(6, -7))
                setToolExecution({
                  command: toolData.command || '',
                  stdout: toolData.stdout || '',
                  stderr: toolData.stderr || '',
                  status: toolData.status || 'error',
                })
              } catch {}
              continue
            }

            setStreamedContent((prev) => prev + raw)
          }
        }
        return false
      }

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          if (processBuffer()) {
            await refetchChat()
            return
          }
        }
        if (done) break
        if (controller.signal.aborted) break
      }

      // Process any remaining buffer after stream ends
      if (buffer.trim()) {
        buffer += '\n\n' // Ensure trailing events are processed
        if (processBuffer()) {
          await refetchChat()
          return
        }
      }

      // Stream ended without [DONE] marker
      setToolExecution(null)
      const duration = Date.now() - startTimeRef.current
      onStreamDone?.({
        provider: selectedModel.providerId || '',
        model: selectedModel.modelId,
        durationMs: duration,
      })
      setStreaming(false)
      await refetchChat()
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        return
      }
      setSendError(err.message || 'Failed to send message')
      onStreamError?.(err.message || 'Failed to send message')
      setStreaming(false)
    } finally {
      abortControllerRef.current = null
    }
  }, [])

  return [
    { streaming, streamedContent, sendError, toolExecution, creatingChat },
    { startStream, stopStream, clearStreamedContent },
  ]
}
