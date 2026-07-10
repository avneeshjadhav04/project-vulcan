import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SelectedModel } from '../components/ProviderModelSelector'
import type { UploadedFile } from '../components/FileUpload'

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
  url?: string
  page_content?: string
  code?: string
  language?: string
}

export interface StreamState {
  streaming: boolean
  streamedContent: string
  sendError: string
  toolExecutions: ToolExecution[]
  creatingChat: boolean
}

export interface StreamActions {
  startStream: (text: string, options: StreamOptions) => Promise<void>
  stopStream: (chatId?: string) => void
  clearStreamedContent: (chatId?: string) => void
}

export interface StreamOptions {
  effectiveChatId?: string
  selectedModel: SelectedModel
  setEffectiveChatId: (id: string) => void
  setOptimisticTitle: (title: string) => void
  attachedFiles: UploadedFile[]
  onStreamDone?: (meta: { provider: string; model: string; durationMs: number }, chatId: string) => void
  onStreamError?: (error: string, chatId: string) => void
  windowHistoryReplace: (chatId: string) => void
  onChatCreated?: () => void
  isRegenerate?: boolean
  regenerateFromMsgId?: string
  existingUserMsgId?: string
}

const defaultStreamState: StreamState = {
  streaming: false,
  streamedContent: '',
  sendError: '',
  toolExecutions: [],
  creatingChat: false,
}

export function useChatStream(chatId?: string): [StreamState, StreamActions] {
  const [streamStates, setStreamStates] = useState<Record<string, StreamState>>({})
  const activeControllersRef = useRef<Record<string, AbortController>>({})
  const startTimeRef = useRef<Record<string, number>>({})
  const queryClient = useQueryClient()

  const streamState = chatId
    ? (streamStates[chatId] || defaultStreamState)
    : (streamStates['__new__'] || defaultStreamState)

  const stopStream = useCallback(async (targetChatId?: string) => {
    const id = targetChatId ?? chatId
    if (!id) return
    const controller = activeControllersRef.current[id]
    if (controller) {
      controller.abort()
      delete activeControllersRef.current[id]
    }
    setStreamStates((prev) => ({
      ...prev,
      [id]: { ...defaultStreamState },
    }))
    try {
      await api.delete(`/chats/${id}/stream`)
    } catch (e) {
      // Stream may have already finished
    }
  }, [chatId])

  const clearStreamedContent = useCallback((targetChatId?: string) => {
    const id = targetChatId ?? chatId
    if (!id) return
    setStreamStates((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || defaultStreamState), streamedContent: '', toolExecutions: [] },
    }))
  }, [chatId])

  const startStream = useCallback(async (text: string, options: StreamOptions) => {
    const {
      effectiveChatId,
      selectedModel,
      setEffectiveChatId,
      setOptimisticTitle,
      attachedFiles,
      onStreamDone,
      onStreamError,
      windowHistoryReplace,
      onChatCreated,
      isRegenerate,
      regenerateFromMsgId,
      existingUserMsgId,
    } = options

    let currentChatId = effectiveChatId

    // Reject new sends while a stream is already running for this chat
    if (currentChatId && streamStates[currentChatId]?.streaming) {
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 600000)

    if (!currentChatId) {
      try {
        const createRes = await api.post('/chats', {
          title: text.slice(0, 50),
          model_id: selectedModel.modelId,
          provider_id: selectedModel.providerId || undefined,
        })
        currentChatId = createRes.data.id as string
        setEffectiveChatId(currentChatId)
        setOptimisticTitle(text.slice(0, 50))
        windowHistoryReplace(currentChatId)
        onChatCreated?.()
      } catch (err: any) {
        clearTimeout(timeoutId)
        setStreamStates((prev) => ({
          ...prev,
          ['__new__']: { ...defaultStreamState, sendError: err.message || 'Failed to create chat' },
        }))
        return
      }
    }

    if (!currentChatId) {
      clearTimeout(timeoutId)
      return
    }

    activeControllersRef.current[currentChatId] = controller
    startTimeRef.current[currentChatId] = Date.now()

    setStreamStates((prev) => {
      const next = { ...prev }
      delete next['__new__']
      next[currentChatId] = { ...defaultStreamState, streaming: true }
      return next
    })

    let attachmentNames: string[] = []
    if (attachedFiles.length > 0) {
      attachmentNames = attachedFiles.map((f) => f.filename)
    }

    const endpoint = `/api/chats/${currentChatId}/message`
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '',
        },
        credentials: 'include',
        body: JSON.stringify({
          content: text,
          attachments: attachmentNames,
          is_regenerate: isRegenerate,
          regenerate_from_msg_id: regenerateFromMsgId,
          existing_user_msg_id: existingUserMsgId,
          provider_id: selectedModel.providerId || undefined,
          model_id: selectedModel.modelId,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login'
          return
        }
        if (res.status === 409) {
          throw new Error('A stream is already in progress for this chat.')
        }
        if (res.status === 412) {
          throw new Error('Add an AI provider in Settings to start chatting.')
        }
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }

      queryClient.invalidateQueries({ queryKey: ['chat', currentChatId] })

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
            const duration = Date.now() - (startTimeRef.current[currentChatId] || 0)
            onStreamDone?.(
              {
                provider: selectedModel.providerId || '',
                model: selectedModel.modelId,
                durationMs: duration,
              },
              currentChatId
            )
            setStreamStates((prev) => {
              const current = prev[currentChatId] || defaultStreamState
              return { ...prev, [currentChatId]: { ...current, streaming: false } }
            })
            setTimeout(() => {
              setStreamStates((prev) => {
                const current = prev[currentChatId]
                if (!current) return prev
                return {
                  ...prev,
                  [currentChatId]: { ...current, streamedContent: '', toolExecutions: [] },
                }
              })
            }, 150)
            return true
          }

          if (raw.startsWith('[ERR]') && raw.endsWith('[/ERR]')) {
            const errorMsg = raw.slice(5, -6)
            onStreamError?.(errorMsg || 'An error occurred', currentChatId)
            setStreamStates((prev) => {
              const current = prev[currentChatId] || defaultStreamState
              return {
                ...prev,
                [currentChatId]: {
                  ...current,
                  sendError: errorMsg || 'An error occurred',
                  streaming: false,
                },
              }
            })
            return true
          }

          if (raw.startsWith('[TOOL]') && raw.endsWith('[/TOOL]')) {
            try {
              const toolData = JSON.parse(raw.slice(6, -7))
              setStreamStates((prev) => {
                const current = prev[currentChatId] || defaultStreamState
                return {
                  ...prev,
                  [currentChatId]: {
                    ...current,
                    toolExecutions: [
                      ...current.toolExecutions,
                      {
                        tool_name: toolData.tool_name || 'unknown',
                        tool_id: toolData.tool_id || '',
                        command: toolData.command || '',
                        stdout: toolData.stdout || '',
                        stderr: toolData.stderr || '',
                        status: toolData.status || 'error',
                        filename: toolData.filename || '',
                        query: toolData.query || '',
                        results: toolData.results || [],
                        url: toolData.url,
                        page_content: toolData.page_content || toolData.content,
                        code: toolData.code,
                        language: toolData.language,
                      },
                    ],
                  },
                }
              })
            } catch {}
            continue
          }

          setStreamStates((prev) => {
            const current = prev[currentChatId] || defaultStreamState
            return {
              ...prev,
              [currentChatId]: { ...current, streamedContent: current.streamedContent + raw },
            }
          })
        }
        return false
      }

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          if (processBuffer()) {
            queryClient.invalidateQueries({ queryKey: ['chat', currentChatId] })
            delete activeControllersRef.current[currentChatId]
            return
          }
        }
        if (done) break
        if (controller.signal.aborted) break
      }

      if (buffer.trim()) {
        buffer += '\n\n'
        if (processBuffer()) {
          queryClient.invalidateQueries({ queryKey: ['chat', currentChatId] })
          delete activeControllersRef.current[currentChatId]
          return
        }
      }

      setStreamStates((prev) => {
        const current = prev[currentChatId] || defaultStreamState
        return { ...prev, [currentChatId]: { ...current, streaming: false, toolExecutions: [] } }
      })
      const duration = Date.now() - (startTimeRef.current[currentChatId] || 0)
      onStreamDone?.(
        {
          provider: selectedModel.providerId || '',
          model: selectedModel.modelId,
          durationMs: duration,
        },
        currentChatId
      )
      setTimeout(() => {
        setStreamStates((prev) => {
          const current = prev[currentChatId]
          if (!current) return prev
          return {
            ...prev,
            [currentChatId]: { ...current, streamedContent: '', toolExecutions: [] },
          }
        })
      }, 150)
      queryClient.invalidateQueries({ queryKey: ['chat', currentChatId] })
    } catch (err: any) {
      clearTimeout(timeoutId)
      delete activeControllersRef.current[currentChatId]
      if (err.name === 'AbortError') {
        return
      }
      setStreamStates((prev) => {
        const current = prev[currentChatId] || defaultStreamState
        return {
          ...prev,
          [currentChatId]: {
            ...current,
            sendError: err.message || 'Failed to send message',
            streaming: false,
          },
        }
      })
      onStreamError?.(err.message || 'Failed to send message', currentChatId)
    }
  }, [queryClient, streamStates])

  return [
    streamState,
    { startStream, stopStream, clearStreamedContent },
  ]
}
