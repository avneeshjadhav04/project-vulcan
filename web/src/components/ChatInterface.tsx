import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useChatStream } from '../hooks/useChatStream'
import { useVoiceInput } from '../hooks/useVoiceInput'
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
}: {
  chatId?: string
  selectedModel: SelectedModel
  onModelChange?: (selection: SelectedModel) => void
}) {
  const [input, setInput] = useState('')
  const [effectiveChatId, setEffectiveChatId] = useState<string | undefined>(chatId)
  const [optimisticTitle, setOptimisticTitle] = useState<string>()
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([])
  const [modelValidation, setModelValidation] = useState<{ valid: boolean; error?: string; model_id?: string } | null>(null)
  const [validatingModel, setValidatingModel] = useState(false)
  const [messageMeta, setMessageMeta] = useState<Record<string, { provider: string; model: string; durationMs: number }>>({})
  const pendingMetaRef = useRef<{ provider: string; model: string; durationMs: number } | null>(null)

  const navigate = useNavigate()

  const [streamState, streamActions] = useChatStream()
  const { streaming, streamedContent, sendError, toolExecution, creatingChat } = streamState
  const { startStream, stopStream } = streamActions

  const voice = useVoiceInput({
    onTranscript: (text) => {
      if (text.trim()) {
        handleSend(text.trim())
      }
    },
  })

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

  const scroll = useChatScroll({ streamedContent, messages: chatData?.messages || [] })

  // Sync model from loaded chat
  useEffect(() => {
    if (chatData?.chat.model_id) {
      onModelChange?.({
        providerId: chatData.chat.provider_id || '',
        modelId: chatData.chat.model_id,
      })
    }
  }, [chatData?.chat.model_id, chatData?.chat.provider_id])

  // Reset state when switching chats
  useEffect(() => {
    setInput('')
    setAttachedFiles([])
    setMessageMeta({})
    pendingMetaRef.current = null
  }, [chatId])

  // Load attached files for chat
  useEffect(() => {
    if (!effectiveChatId) return
    api.get(`/chats/${effectiveChatId}/files`)
      .then((res) => setAttachedFiles(res.data || []))
      .catch(() => setAttachedFiles([]))
  }, [effectiveChatId])

  // Validate model when chat loads
  useEffect(() => {
    const currentModelId = chatData?.chat.model_id
    const currentProviderId = chatData?.chat.provider_id
    if (!currentModelId || !currentProviderId || !userData?.has_provider) {
      setModelValidation(null)
      return
    }

    let cancelled = false
    setValidatingModel(true)

    api.get(`/models/validate?provider_id=${encodeURIComponent(currentProviderId)}&model_id=${encodeURIComponent(currentModelId)}`)
      .then((res) => {
        if (!cancelled) setModelValidation(res.data)
      })
      .catch(() => {
        if (!cancelled) setModelValidation(null)
      })
      .finally(() => {
        if (!cancelled) setValidatingModel(false)
      })

    return () => { cancelled = true }
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

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = textOverride || input.trim()
    if (!text || streaming) return

    if (!textOverride) setInput('')

    await startStream(text, {
      effectiveChatId,
      selectedModel,
      setEffectiveChatId,
      setOptimisticTitle,
      attachedFiles,
      onStreamDone: (meta) => {
        pendingMetaRef.current = meta
      },
      onStreamError: (error) => {
        // Error is already set in hook state; this is for side effects if needed
        console.error('Stream error:', error)
      },
      refetchChat: refetch,
      windowHistoryReplace: (id) => {
        window.history.replaceState({}, '', `/chat/${id}`)
      },
    })
  }, [input, streaming, effectiveChatId, selectedModel, attachedFiles, refetch, startStream])

  // The hook doesn't expose these setters. I need to rethink this.
  // Let me use a reducer-based approach for ChatInterface state instead.

  const handleRegenerate = useCallback(() => {
    const lastUserMessage = chatData?.messages?.slice().reverse().find((m) => m.role === 'user')
    if (lastUserMessage) {
      handleSend(lastUserMessage.content)
    }
  }, [chatData?.messages, handleSend])

  const handleEditMessage = useCallback(async (msgId: string, newContent: string) => {
    try {
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
      const patchRes = await fetch(`/api/chats/${effectiveChatId}/messages/${msgId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        body: JSON.stringify({ content: newContent }),
      })
      if (!patchRes.ok) throw new Error('Failed to edit message')

      const deleteRes = await fetch(`/api/chats/${effectiveChatId}/messages/${msgId}/after`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
      })
      if (!deleteRes.ok) throw new Error('Failed to clear subsequent messages')

      await refetch()
      handleSend(newContent)
    } catch (err: any) {
      // Error is displayed via UI if needed
      console.error('Edit message error:', err)
    }
  }, [effectiveChatId, refetch, handleSend])

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
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <ChatHeader
        title={chatData?.chat.title}
        optimisticTitle={optimisticTitle}
        chatId={effectiveChatId}
      />

      {/* API Key Required Overlay */}
      <AnimatePresence>
        {userData && !userData.has_provider && !userData.has_nim_key && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mx-4 max-w-sm border border-border-subtle bg-layer p-8 text-center"
            >
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center border border-border-subtle bg-background">
                <Key className="h-6 w-6 text-interactive" aria-hidden="true" />
              </div>
              <h2 className="mb-2 text-base font-semibold text-text-primary">AI Provider Required</h2>
              <p className="mb-5 text-xs text-text-helper">
                To use Project Vulcan, you need to add at least one AI provider API key.
                You can use NVIDIA NIM, OpenAI, Groq, or any OpenAI-compatible provider.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigate('/settings')}
                  className="carbon-btn-primary"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  Go to Settings
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
        toolExecution={toolExecution}
        creatingChat={creatingChat}
        messageMeta={messageMeta}
        showScrollBtn={scroll.showScrollBtn}
        scrollContainerRef={scroll.scrollContainerRef}
        messagesEndRef={scroll.messagesEndRef}
        onScroll={scroll.handleScroll}
        onScrollToBottom={scroll.scrollToBottom}
        onRegenerate={handleRegenerate}
        onEditMessage={handleEditMessage}
        onSuggestion={(text) => handleSend(text)}
      />

      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={() => handleSend()}
        onStop={stopStream}
        streaming={streaming}
        effectiveChatId={effectiveChatId}
        selectedModel={selectedModel}
        onModelChange={onModelChange || (() => {})}
        attachedFiles={attachedFiles}
        onFilesChange={setAttachedFiles}
        voiceSupported={voice.voiceSupported}
        isListening={voice.isListening}
        onToggleVoice={voice.toggle}
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
      />
    </div>
  )
}
