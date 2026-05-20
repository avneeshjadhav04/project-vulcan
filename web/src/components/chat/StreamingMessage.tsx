import { motion } from 'framer-motion'
import { Sparkles, Zap } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdownComponents'

export default function StreamingMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 py-3"
    >
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-7 w-7 items-center justify-center border border-border-subtle bg-interactive">
          <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden="true" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-primary">AI</span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-interactive">
              <Zap className="h-2.5 w-2.5" aria-hidden="true" />
              Generating...
            </span>
          )}
        </div>
        <div className="inline-block border border-border-subtle bg-layer px-4 py-2.5">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-[cursor-blink_1s_infinite] bg-interactive" />
          )}
        </div>
      </div>
    </motion.div>
  )
}
