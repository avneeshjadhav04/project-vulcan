import { motion } from 'framer-motion'
import { Bot } from 'lucide-react'

export default function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const suggestions = [
    { icon: '>', text: 'List all files in the current directory' },
    { icon: '>', text: 'Write a Python script to fetch weather data' },
    { icon: '>', text: 'Check what version of Node.js is installed' },
    { icon: '>', text: 'Find all .log files and show their sizes' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 flex-col items-center justify-center px-6"
    >
      <div className="mb-6 flex h-14 w-14 items-center justify-center border border-border-subtle bg-layer">
        <Bot className="h-7 w-7 text-interactive" aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-text-primary">Just Ask.</h2>
      <p className="mb-6 max-w-md text-center text-xs text-text-helper">
        I can write code, analyze data, answer questions, help with creative projects, and much more.
      </p>
      <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05 }}
            onClick={() => onSuggestion(s.text)}
            className="flex items-start gap-2 border border-border-subtle bg-layer p-3 text-left transition-colors hover:border-border-strong hover:bg-layer-hover focus:outline-none focus:ring-1 focus:ring-focus"
          >
            <span className="mt-0.5 text-xs text-interactive">{s.icon}</span>
            <span className="text-xs text-text-secondary">{s.text}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}
