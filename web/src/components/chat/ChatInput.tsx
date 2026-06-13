import { useRef, useLayoutEffect, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowUp,
  StopCircle,
  Wrench,
  Mic,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import ProviderModelSelector, { type SelectedModel } from '../ProviderModelSelector'
import FileUpload, { type UploadedFile } from '../FileUpload'

interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  onSend: (text?: string) => void
  onStop: () => void
  streaming: boolean
  effectiveChatId?: string
  getChatId: () => Promise<string>
  selectedModel: SelectedModel
  onModelChange: (sel: SelectedModel) => void
  attachedFiles: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
  voiceState: 'idle' | 'connecting' | 'recording' | 'error'
  voiceRecordingTime: number
  voiceTranscript: string
  voicePartialText: string
  onStartVoice: () => void
  onStopVoice: () => void
  onCancelVoice: () => void
  onVoiceTranscript: (transcript: string) => void
  toolsEnabled?: boolean
  onToggleTools: () => void
  sendError: string
  onRetry?: () => void
}

export default function ChatInput({
  input,
  onInputChange,
  onSend,
  onStop,
  streaming,
  effectiveChatId: _effectiveChatId,
  getChatId,
  selectedModel,
  onModelChange,
  attachedFiles,
  onFilesChange,
  voiceState,
  voiceRecordingTime,
  voiceTranscript,
  voicePartialText,
  onStartVoice,
  onStopVoice,
  onCancelVoice,
  onVoiceTranscript,
  toolsEnabled,
  onToggleTools,
  sendError,
  onRetry,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useLayoutEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0px'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 320)}px`
    }
  }, [input])

  // Enter key stops recording
  useEffect(() => {
    if (voiceState !== 'recording') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onStopVoice()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [voiceState, onStopVoice])

  return (
    <div className="border-t border-white/5 bg-background/80 backdrop-blur-xl px-4 py-4">
      <div className="mx-auto max-w-3xl">
        <AnimatePresence>
          {sendError && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="mb-2 flex items-center justify-between gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-[11px] text-support-error"
              role="alert"
            >
              <span className="flex-1">{sendError}</span>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-1 rounded bg-support-error/20 px-2 py-1 text-[11px] font-medium text-support-error transition-colors hover:bg-support-error/30"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div
          onDrop={(e) => {
            e.preventDefault()
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
          }}
          onDragOver={(e) => e.preventDefault()}
          className="relative flex flex-col rounded-glass border border-white/10 bg-layer/50 shadow-lg backdrop-blur-md transition-all focus-within:border-interactive/50 focus-within:bg-layer/70 focus-within:shadow-interactive/10"
        >
          {/* Top area: textarea or voice recording */}
          {voiceState === 'connecting' ? (
            <div className="flex items-center gap-3 px-4 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-interactive" />
              <div className="flex-1">
                <div className="text-sm text-text-primary">Connecting...</div>
                <div className="text-[10px] text-text-helper">
                  Setting up voice transcription
                </div>
              </div>
              <button
                onClick={onCancelVoice}
                className="text-[11px] text-text-helper hover:text-text-primary transition-colors"
              >
                Stop
              </button>
            </div>
          ) : voiceState === 'recording' ? (
            <div className="flex flex-col px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-support-error/20">
                  <span className="flex h-3 w-3 rounded-full bg-support-error animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-text-primary font-medium">
                    Recording... {(voiceRecordingTime / 1000).toFixed(1)}s
                  </div>
                  <div className="text-[10px] text-text-helper">
                    Speak now. Click stop when done.
                  </div>
                </div>
                <button
                  onClick={onStopVoice}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-layer-hover text-text-primary hover:bg-layer-active transition-colors"
                  aria-label="Stop recording"
                >
                  <StopCircle className="h-4 w-4" />
                </button>
                <button
                  onClick={onCancelVoice}
                  className="text-[11px] text-text-helper hover:text-text-primary transition-colors"
                >
                  Stop
                </button>
              </div>
              {voicePartialText && (
                <div className="mt-2 text-sm text-text-primary/80 italic">
                  {voicePartialText}
                </div>
              )}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={voiceTranscript || input}
              onChange={(e) => {
                if (voiceTranscript) {
                  onInputChange(e.target.value)
                  onVoiceTranscript('')
                } else {
                  onInputChange(e.target.value)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const text = voiceTranscript || input.trim()
                  onSend(text)
                  onInputChange('')
                  onVoiceTranscript('')
                }
              }}
              placeholder="Message AI..."
              rows={2}
              disabled={streaming}
              aria-label="Message input"
              className="max-h-[320px] min-h-[64px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-50"
            />
          )}

          {/* Bottom area: controls */}
          <div className="flex items-end justify-between gap-2 px-2 pb-2">
            {/* Left: file upload */}
            <FileUpload 
              getChatId={getChatId} 
              chatId={_effectiveChatId}
              files={attachedFiles} 
              onFilesChange={onFilesChange} 
            />

            {/* Right: model, tools, voice, send */}
            <div className="flex items-center gap-1.5">
              <div className="w-44 shrink-0">
                <ProviderModelSelector
                  selected={selectedModel}
                  onSelect={onModelChange}
                />
              </div>

              <button
                onClick={onToggleTools}
                aria-label={toolsEnabled ? 'Disable tools' : 'Enable tools'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-carbon transition-colors ${
                  toolsEnabled
                    ? 'bg-support-success/20 text-support-success'
                    : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
                }`}
              >
                <Wrench className="h-4 w-4" aria-hidden="true" />
              </button>

              {voiceState === 'idle' && (
                <button
                  onClick={onStartVoice}
                  aria-label="Voice input"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-carbon transition-colors text-text-helper hover:bg-layer-hover hover:text-text-primary"
                >
                  <Mic className="h-4 w-4" aria-hidden="true" />
                </button>
              )}

              {streaming ? (
                <button
                  onClick={onStop}
                  aria-label="Stop generating"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-carbon bg-support-error/10 text-support-error transition-colors hover:bg-support-error/20"
                >
                  <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />
                  <StopCircle className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    const text = voiceTranscript || input.trim()
                    onSend(text)
                    onInputChange('')
                    onVoiceTranscript('')
                  }}
                  disabled={!input.trim() && !voiceTranscript.trim()}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-carbon bg-vibrant-gradient text-white shadow-md transition-all hover:opacity-90 disabled:opacity-30 disabled:shadow-none"
                >
                  <ArrowUp className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-center gap-2">
          {voiceState === 'connecting' ? (
            <span className="text-[10px] text-interactive">
              Connecting to transcription service...
            </span>
          ) : voiceState === 'recording' ? (
            <span className="text-[10px] text-support-error">
              Recording... speak clearly
            </span>
          ) : voiceState === 'error' ? (
            <span className="text-[10px] text-support-error">
              Voice input failed. Try again or type your message.
            </span>
          ) : (
            <span className="text-[10px] text-text-helper">
              {toolsEnabled ? 'Tools On — AI can run commands, create files, and search the web.' : 'Tools Off — AI will not use any tools.'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
