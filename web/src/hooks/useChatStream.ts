import { useCallback, useRef, useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { SelectedModel } from '../components/ProviderModelSelector'

export interface ToolExecution {
  tool_name: string
  tool_id: string
  command?: string
  stdout?: string
  stderr?: string
  status: string
  filename?: string
  query?: string
  results?: Array<{ title: string; url: string; snippet: string }>
  events?: any[]
  emails?: any[]
  tasks?: any[]
  to?: string
  subject?: string
  body?: string
  from?: string
  date?: string
  summary?: string
  start?: string
  end?: string
  location?: string
  content?: string
  due_string?: string
  priority?: number
  task_id?: string
  url?: string
  page_content?: string
  code?: string
  language?: string
}

export interface StreamState {
  streaming: boolean
  streamedContent: string
  sendError: string
  toolExecution: ToolExecution | null
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
  isRegenerate?: boolean
}

export function useChatStream(): [StreamState, StreamActions] {
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [sendError, setSendError] = useState('')
  const [toolExecution, setToolExecution] = useState<ToolExecution | null>(null)
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

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
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
      isRegenerate,
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
        body: JSON.stringify({ content: messageContent, is_regenerate: isRegenerate }),
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

      // Fetch the newly inserted user message right away so it shows up in UI
      await refetchChat()

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      const processBuffer = () => {
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          const raw = event
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n')

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
                tool_name: toolData.tool_name || 'unknown',
                tool_id: toolData.tool_id || '',
                command: toolData.command || '',
                stdout: toolData.stdout || '',
                stderr: toolData.stderr || '',
                status: toolData.status || 'error',
                filename: toolData.filename || '',
                query: toolData.query || '',
                results: toolData.results || [],
                events: toolData.events,
                emails: toolData.emails,
                tasks: toolData.tasks,
                to: toolData.to,
                subject: toolData.subject,
                body: toolData.body,
                from: toolData.from,
                date: toolData.date,
                summary: toolData.summary,
                start: toolData.start,
                end: toolData.end,
                location: toolData.location,
                content: toolData.content,
                due_string: toolData.due_string,
                priority: toolData.priority,
                task_id: toolData.task_id,
                url: toolData.url,
                page_content: toolData.page_content,
                code: toolData.code,
                language: toolData.language,
              })
            } catch {}
            continue
          }

          setStreamedContent((prev) => prev + raw)
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
