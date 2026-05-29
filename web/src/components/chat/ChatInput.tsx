import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowUp,
  StopCircle,
  Wrench,
  Mic,
  MicOff,
  Loader2,
} from 'lucide-react'
import ProviderModelSelector, { type SelectedModel } from '../ProviderModelSelector'
import FileUpload, { type UploadedFile } from '../FileUpload'

interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  effectiveChatId?: string
  getChatId: () => Promise<string>
  selectedModel: SelectedModel
  onModelChange: (sel: SelectedModel) => void
  attachedFiles: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
  voiceSupported: boolean
  isListening: boolean
  onToggleVoice: () => void
  toolsEnabled?: boolean
  onToggleTools: () => void
  sendError: string
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
  voiceSupported,
  isListening,
  onToggleVoice,
  toolsEnabled,
  onToggleTools,
  sendError,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  return (
    <div className="border-t border-white/5 bg-background/80 backdrop-blur-xl px-4 py-4">
      <div className="mx-auto max-w-3xl">
        <AnimatePresence>
          {sendError && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="mb-2 flex items-center gap-2 border border-support-error/30 bg-support-error/10 px-3 py-2 text-[11px] text-support-error"
              role="alert"
            >
              {sendError}
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
          className="relative flex items-end gap-2 rounded-glass border border-white/10 bg-layer/50 p-2 shadow-lg backdrop-blur-md transition-all focus-within:border-interactive/50 focus-within:bg-layer/70 focus-within:shadow-interactive/10"
        >
          <FileUpload 
            getChatId={getChatId} 
            files={attachedFiles} 
            onFilesChange={onFilesChange} 
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder="Message AI..."
            rows={2}
            disabled={streaming}
            aria-label="Message input"
            className="max-h-[200px] min-h-[48px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-50"
          />

          <div className="w-52 shrink-0 hidden sm:block">
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

          {voiceSupported && (
            <button
              onClick={onToggleVoice}
              aria-label={isListening ? 'Stop listening' : 'Voice input'}
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-carbon transition-colors ${
                isListening
                  ? 'bg-support-error/20 text-support-error'
                  : 'text-text-helper hover:bg-layer-hover hover:text-text-primary'
              }`}
            >
              {isListening ? (
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-support-error/40" />
                  <MicOff className="relative h-4 w-4" aria-hidden="true" />
                </span>
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
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
              onClick={onSend}
              disabled={!input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-carbon bg-vibrant-gradient text-white shadow-md transition-all hover:opacity-90 hover:shadow-interactive/30 disabled:opacity-30 disabled:shadow-none"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-center gap-2">
          {isListening ? (
            <>
              <span className="flex h-1.5 w-1.5 bg-support-error animate-pulse" />
              <span className="text-[10px] text-support-error">Listening... speak now</span>
            </>
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
