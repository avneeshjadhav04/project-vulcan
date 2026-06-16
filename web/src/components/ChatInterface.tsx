import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useErrorToast } from './ui/ErrorToast'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useChatStream } from '../hooks/useChatStream'
import { useVoiceStreaming } from '../hooks/useVoiceStreaming'
import { useChatScroll } from '../hooks/useChatScroll'
import type { SelectedModel } from './ProviderModelSelector'
import type { UploadedFile } from './FileUpload'

import ChatHeader from './chat/ChatHeader'
import ChatMessages from './chat/ChatMessages'
import ChatInput from './chat/ChatInput'

import {
  AlertCircle,
  Key,
  Settings,
  ExternalLink,
  Paperclip,
  X,
} from 'lucide-react'

interface MessageItem {
  id: string
  role: string
  content: string
  created_at: string
  tokens_used?: number
}

export default function ChatInterface({
  chatId,
  selectedModel,
  onModelChange,
  sidebarOpen,
}: {
  chatId?: string
  selectedModel: SelectedModel
  onModelChange?: (selection: SelectedModel) => void
  sidebarOpen?: boolean
}) {
  const [input, setInput] = useState('')
  const [effectiveChatId, setEffectiveChatId] = useState<string | undefined>(chatId)
  const [optimisticTitle, setOptimisticTitle] = useState<string>()
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([])
  const [modelValidation, setModelValidation] = useState<{ valid: boolean; error?: string; model_id?: string } | null>(null)
  const [validatingModel, setValidatingModel] = useState(false)
  const [messageMeta, setMessageMeta] = useState<Record<string, { provider: string; model: string; durationMs: number }>>({})
  const [isGlobalDragging, setIsGlobalDragging] = useState(false)
  const [providerOverlayDismissed, setProviderOverlayDismissed] = useState(false)
  const pendingMetaRef = useRef<{ provider: string; model: string; durationMs: number } | null>(null)

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [streamState, streamActions] = useChatStream()
  const { streaming, streamedContent, sendError, toolExecutions, creatingChat } = streamState
  const { startStream, stopStream, clearStreamedContent } = streamActions

  const showError = useErrorToast();

  const voice = useVoiceStreaming()

  useEffect(() => {
    setEffectiveChatId(chatId)
    setOptimisticTitle(undefined)
  }, [chatId])

  // Sync selected model to chat's stored provider+model when chat loads
  const { data: chatData, refetch, isError } = useQuery({
    queryKey: ['chat', effectiveChatId],
    queryFn: async () => {
      const res = await api.get(`/chats/${effectiveChatId}`)
      return res.data as {
        chat: { title: string; model_id: string; provider_id: string | null }
        messages: MessageItem[]
      }
    },
    enabled: !!effectiveChatId,
  })

  const { data: userData, refetch: refetchUser } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/me')
      return res.data as { has_nim_key: boolean; has_provider: boolean; tools_enabled: boolean }
    },
  })
  const scroll = useChatScroll(effectiveChatId)
  // Sync model from loaded chat
  useEffect(() => {
    if (chatData?.chat.model_id) {
      onModelChange?.({
        providerId: chatData.chat.provider_id || '',
        modelId: chatData.chat.model_id,
      })
    }
  }, [chatData?.chat.model_id, chatData?.chat.provider_id, onModelChange])

  // Reset state when switching chats
  useEffect(() => {
    setInput('')
    setAttachedFiles([])
    setMessageMeta({})
    pendingMetaRef.current = null
  }, [chatId])

  // Removed: We no longer load all past files into the input box.
  // attachedFiles only represents files about to be sent.

  // Validate model when chat loads
  const validationRunRef = useRef(0)
  useEffect(() => {
    const currentModelId = chatData?.chat.model_id
    const currentProviderId = chatData?.chat.provider_id
    if (!currentModelId || !currentProviderId || !userData?.has_provider) {
      setModelValidation(null)
      setValidatingModel(false)
      return
    }

    const runId = ++validationRunRef.current
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    setValidatingModel(true)

    api.get(`/models/validate?provider_id=${encodeURIComponent(currentProviderId)}&model_id=${encodeURIComponent(currentModelId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeoutId)
        if (validationRunRef.current === runId) setModelValidation(res.data)
      })
      .catch(() => {
        clearTimeout(timeoutId)
        if (validationRunRef.current === runId) setModelValidation(null)
      })
      .finally(() => {
        clearTimeout(timeoutId)
        if (validationRunRef.current === runId) setValidatingModel(false)
      })

    return () => {
      controller.abort()
      clearTimeout(timeoutId)
    }
  }, [chatData?.chat.model_id, chatData?.chat.provider_id, userData?.has_provider])

  // Assign pending meta to last assistant message
  useEffect(() => {
    if (pendingMetaRef.current && chatData?.messages && chatData.messages.length > 0) {
      const lastMsg = chatData.messages[chatData.messages.length - 1]
      if (lastMsg.role === 'assistant') {
        setMessageMeta((prev) => ({ ...prev, [lastMsg.id]: pendingMetaRef.current! }))
        pendingMetaRef.current = null
      }
    }
  }, [chatData?.messages])

  // Smoothly clear streamed content when streaming finishes
  useEffect(() => {
    if (!streaming && streamedContent && chatData?.messages) {
      const timer = setTimeout(() => {
        clearStreamedContent()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [streaming, streamedContent, chatData?.messages, clearStreamedContent])

  const handleSend = useCallback(async (textOverride?: string, isRegenerate = false) => {
    const text = textOverride || input.trim()
    if (!text || streaming) return

    // Check if user has a provider before sending
    if (userData && !userData.has_provider && !userData.has_nim_key) {
      setProviderOverlayDismissed(false)
      showError('Add an AI provider in Settings to start chatting.')
      return
    }

    const currentFiles = [...attachedFiles]
    if (!textOverride) {
      setInput('')
    }
    setAttachedFiles([])

    await startStream(text, {
      effectiveChatId,
      selectedModel,
      setEffectiveChatId,
      setOptimisticTitle,
      attachedFiles: currentFiles,
      onStreamDone: (meta) => {
        pendingMetaRef.current = meta
      },
      onStreamError: (error) => {
        console.error('Stream error:', error)
      },
      refetchChat: refetch,
      windowHistoryReplace: (id) => {
        window.history.replaceState({}, '', `/chat/${id}`)
      },
      onChatCreated: () => {
        queryClient.invalidateQueries({ queryKey: ['chats'] })
      },
      onUserMessageAdded: () => {
        scroll.forceScrollToBottom()
      },
      isRegenerate,
    })
  }, [input, streaming, effectiveChatId, selectedModel, attachedFiles, refetch, startStream, queryClient, scroll])


  const handleRegenerate = useCallback(async () => {
    const lastUserMessage = chatData?.messages?.slice().reverse().find((m) => m.role === 'user')

    if (lastUserMessage) {
      if (effectiveChatId) {
        try {
          await api.delete(`/chats/${effectiveChatId}/messages/${lastUserMessage.id}/after`)
        } catch (e: any) {
            showError(e?.message ?? 'Failed to delete messages after regenerate');
          }
      }
      handleSend(lastUserMessage.content, true)
    }
  }, [chatData?.messages, handleSend, effectiveChatId])

  const handleEditMessage = useCallback(async (msgId: string, newContent: string) => {
    try {
      await api.patch(`/chats/${effectiveChatId}/messages/${msgId}`, { content: newContent })
      await api.delete(`/chats/${effectiveChatId}/messages/${msgId}/after`)
      await refetch()
      handleSend(newContent, true)
    } catch (err: any) {
      showError(err?.message ?? 'Failed to edit message')
    }
  }, [effectiveChatId, refetch, handleSend])

  const dragCounterRef = useRef(0)

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsGlobalDragging(true)
    }
  }, [])

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault() // Required to allow dropping
  }, [])

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setIsGlobalDragging(false)
    }
  }, [])

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsGlobalDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      if (input) {
        const dt = new DataTransfer()
        for (const f of files) dt.items.add(f)
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }, [])

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-text-helper">
        <AlertCircle className="mb-3 h-10 w-10 text-support-error" aria-hidden="true" />
        <p className="mb-1 text-base font-medium text-text-primary">Chat not found</p>
        <p className="mb-4 text-xs text-text-helper">This chat may have been deleted or you don&apos;t have access.</p>
        <button
          onClick={() => window.location.reload()}
          className="carbon-btn-primary"
        >
          Refresh Page
        </button>
      </div>
    )
  }

  const messages = chatData?.messages || []

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div 
        className="relative flex flex-1 flex-col overflow-hidden bg-background"
        onDragEnter={handleGlobalDragEnter}
        onDragOver={handleGlobalDragOver}
        onDragLeave={handleGlobalDragLeave}
        onDrop={handleGlobalDrop}
      >
      <AnimatePresence>
        {isGlobalDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex items-center justify-center border-4 border-dashed border-interactive/50 bg-background/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-layer/90 px-12 py-10 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-interactive/20">
                <Paperclip className="h-8 w-8 text-interactive" />
              </div>
              <h2 className="text-xl font-bold text-text-primary">Drop files to upload</h2>
              <p className="mt-2 text-sm text-text-helper">Files will be attached to your next message.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ChatHeader
        title={chatData?.chat.title}
        optimisticTitle={optimisticTitle}
        chatId={effectiveChatId}
        sidebarOpen={sidebarOpen}
      />

      {/* API Key Required Overlay */}
      <AnimatePresence>
        {userData && !userData.has_provider && !userData.has_nim_key && !providerOverlayDismissed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="relative mx-4 max-w-sm rounded-2xl border border-border-subtle bg-layer p-8 text-center shadow-2xl"
            >
              {/* Close button */}
              <button
                onClick={() => setProviderOverlayDismissed(true)}
                className="absolute right-3 top-3 p-1.5 text-text-helper transition-colors hover:text-text-primary"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
              
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-border-subtle bg-background">
                <Key className="h-6 w-6 text-interactive" aria-hidden="true" />
              </div>
              <h2 className="mb-2 text-base font-semibold text-text-primary">AI Provider Required</h2>
              <p className="mb-5 text-xs text-text-helper">
                To use Project Vulcan, you need to add at least one AI provider API key.
                You can use NVIDIA NIM, OpenAI, Groq, or any OpenAI-compatible provider.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigate('/settings?tab=providers')}
                  className="carbon-btn-primary"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  Add AI Provider
                </button>
                <a
                  href="https://build.nvidia.com/explore/discover"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="carbon-btn-secondary"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Get Free API Key
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model Validation Warning */}
      <AnimatePresence>
        {validatingModel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border-subtle bg-layer px-5 py-1.5"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-[11px] text-text-helper">
              <div className="h-3 w-3 animate-spin border-2 border-border-subtle border-t-interactive" />
              Checking model availability...
            </div>
          </motion.div>
        )}
        {modelValidation && !modelValidation.valid && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-support-warning/30 bg-support-warning/10 px-5 py-2.5"
          >
            <div className="mx-auto flex max-w-3xl items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-support-warning">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{modelValidation.error || `Model '${modelValidation.model_id}' is not available`}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ChatMessages
        messages={messages}
        streaming={streaming}
        streamedContent={streamedContent}
        toolExecutions={toolExecutions}
        creatingChat={creatingChat}
        chatId={effectiveChatId}
        messageMeta={messageMeta}
        showScrollBtn={scroll.showScrollBtn}
        scrollContainerRef={scroll.containerRef}
        wasNearBottomRef={scroll.wasNearBottomRef}
        onScroll={scroll.handleScroll}
        onScrollToBottom={scroll.scrollToBottom}
        onRegenerate={handleRegenerate}
        onEditMessage={handleEditMessage}
        onSuggestion={(text) => handleSend(text)}
      />

      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={(text) => handleSend(text)}
        onStop={stopStream}
        streaming={streaming}
        effectiveChatId={effectiveChatId}
        getChatId={async () => {
          if (effectiveChatId) return effectiveChatId
          // Create chat optimistically
          const createRes = await api.post('/chats', {
            title: 'New Chat',
            model_id: selectedModel.modelId,
            provider_id: selectedModel.providerId || undefined,
          })
          const newId = createRes.data.id as string
          setEffectiveChatId(newId)
          window.history.replaceState({}, '', `/chat/${newId}`)
          queryClient.invalidateQueries({ queryKey: ['chats'] })
          return newId
        }}
        selectedModel={selectedModel}
        onModelChange={onModelChange || (() => {})}
        attachedFiles={attachedFiles}
        onFilesChange={setAttachedFiles}
        voiceState={voice.state}
        voiceRecordingTime={voice.recordingTime}
        voiceTranscript={voice.transcript}
        voicePartialText={voice.partialText}
        onStartVoice={voice.startRecording}
        onStopVoice={voice.stopRecording}
        onCancelVoice={voice.cancelRecording}
        onVoiceTranscript={voice.reset}
        toolsEnabled={userData?.tools_enabled}
        onToggleTools={async () => {
          try {
            await api.post('/me/tools', { tools_enabled: !userData?.tools_enabled })
            await refetchUser()
          } catch (err: any) {
            // Error handled by query
          }
        }}
        sendError={sendError}
        onRetry={handleRegenerate}
      />
      </div>
    </div>
  )
}
