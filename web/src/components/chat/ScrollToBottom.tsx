import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

export default function ScrollToBottom({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          onClick={onClick}
          aria-label="Scroll to latest messages"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-border-subtle bg-layer px-4 py-2.5 shadow-lg text-text-secondary transition-all hover:bg-layer-hover hover:text-text-primary hover:shadow-xl hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-interactive"
        >
          <span className="text-xs font-medium">Latest</span>
          <ChevronDown className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
