import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

export default function ScrollToBottom({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          onClick={onClick}
          aria-label="Scroll to bottom"
          className="absolute bottom-20 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center border border-border-subtle bg-layer shadow-md text-text-helper transition-colors hover:border-border-strong hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
