import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

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
        <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-border-subtle bg-interactive/10">
          <motion.div
             animate={{ opacity: [0.4, 1, 0.4] }}
             transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-3.5 w-3.5 text-interactive" />
          </motion.div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 pt-1.5 w-full max-w-2xl">
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          className="h-2.5 w-full max-w-[85%] rounded-full bg-layer-hover" 
        />
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
          className="h-2.5 w-full max-w-[100%] rounded-full bg-layer-hover" 
        />
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          className="h-2.5 w-full max-w-[65%] rounded-full bg-layer-hover" 
        />
      </div>
    </motion.div>
  )
}
