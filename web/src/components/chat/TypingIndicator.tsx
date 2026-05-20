import { motion } from 'framer-motion'

export default function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 py-3"
      aria-live="polite"
      aria-label="AI is thinking"
    >
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-7 w-7 items-center justify-center border border-border-subtle bg-interactive">
          <span className="sr-only">AI avatar</span>
        </div>
      </div>
      <div className="flex items-center">
        <div className="flex items-center gap-1.5 border border-border-subtle bg-layer px-3 py-2">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
            className="h-1.5 w-1.5 bg-interactive"
          />
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
            className="h-1.5 w-1.5 bg-interactive"
          />
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
            className="h-1.5 w-1.5 bg-interactive"
          />
        </div>
      </div>
    </motion.div>
  )
}
