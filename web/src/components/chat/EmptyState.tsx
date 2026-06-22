import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Suggestion {
  id: number
  text: string
}

const CLOCKWISE_SLOTS = [0, 1, 3, 2]

const IDEA_POOL: Suggestion[] = [
  // Coding / Dev
  { id: 1, text: 'List all files in the current directory' },
  { id: 2, text: 'Write a Python script to fetch weather data' },
  { id: 3, text: 'Check what version of Node.js is installed' },
  { id: 4, text: 'Find all .log files and show their sizes' },
  { id: 5, text: 'Generate a React component for a todo list' },
  { id: 6, text: 'Write a bash script to back up a folder' },
  { id: 7, text: 'Create a SQL query to find duplicate records' },
  { id: 8, text: 'Explain the difference between let and const in JavaScript' },
  { id: 9, text: 'Build a simple REST API with Express' },
  { id: 10, text: 'Write a unit test for a login function' },
  { id: 11, text: 'Create a Python function to parse URLs' },
  { id: 12, text: 'Refactor this function to use async/await' },

  // Daily tasks / Productivity
  { id: 13, text: 'Draft a professional email to request time off' },
  { id: 14, text: 'Summarize my notes into bullet points' },
  { id: 15, text: 'Create a weekly meal plan' },
  { id: 16, text: 'Write a to-do list for my project' },
  { id: 17, text: 'Generate a meeting agenda template' },
  { id: 18, text: 'List my upcoming Google Calendar events' },
  { id: 19, text: 'Add a task to my Todoist inbox' },
  { id: 20, text: 'Show me the latest unread emails in Gmail' },
  { id: 21, text: 'Help me write a project README' },
  { id: 22, text: 'Create a JSON schema for an e-commerce order' },

  // Learning / Explanations
  { id: 23, text: 'Explain how recursion works with an example' },
  { id: 24, text: 'Summarize the main points of quantum computing' },
  { id: 25, text: 'Explain OAuth 2.0 in simple terms' },
  { id: 26, text: 'Explain how TCP/IP handshake works' },
  { id: 27, text: 'What is the difference between SQL and NoSQL?' },
  { id: 28, text: 'Teach me the basics of machine learning' },
  { id: 29, text: 'How does public-key cryptography work?' },
  { id: 30, text: 'Explain the SOLID principles in software design' },
  { id: 31, text: 'What causes climate change in simple terms?' },
  { id: 32, text: 'Describe how a blockchain works' },

  // Fun / Creative
  { id: 33, text: 'Write a short sci-fi story about Mars' },
  { id: 34, text: 'Plan a weekend project to learn a new skill' },
  { id: 35, text: 'Create a workout plan for beginners' },
  { id: 36, text: 'Suggest a playlist theme for a road trip' },
  { id: 37, text: 'Write a haiku about coding' },
  { id: 38, text: 'Brainstorm ideas for a mobile app' },
  { id: 39, text: 'Help me outline a blog post about AI' },
  { id: 40, text: 'Generate a trivia question about space' },
]

function shuffle<T>(array: T[]): T[] {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export default function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const [displayed, setDisplayed] = useState<Suggestion[]>(() => shuffle(IDEA_POOL).slice(0, 4))
  const [stepIndex, setStepIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const rotate = useCallback(() => {
    setDisplayed((current) => {
      const currentIds = new Set(current.map((s) => s.id))
      const available = IDEA_POOL.filter((s) => !currentIds.has(s.id))
      const next = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : IDEA_POOL[Math.floor(Math.random() * IDEA_POOL.length)]
      const updated = [...current]
      updated[CLOCKWISE_SLOTS[stepIndex]] = next
      return updated
    })
    setStepIndex((i) => (i + 1) % 4)
  }, [stepIndex])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) rotate()
    }, 15000)
    return () => clearInterval(interval)
  }, [isPaused, rotate])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 flex-col items-center justify-center px-6"
    >
      <div className="mb-6 h-14 w-14" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold text-text-primary">Just Ask.</h2>
      <p className="mb-6 max-w-md text-center text-xs text-text-helper">
        I can write code, analyze data, answer questions, help with creative projects, and much more.
      </p>
      <div
        className="grid w-full max-w-lg gap-2 sm:grid-cols-2"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {displayed.map((s, i) => (
          <AnimatePresence mode="wait" key={i}>
            <motion.button
              key={s.id}
              initial={{ opacity: 0, filter: 'blur(8px)', scale: 0.95 }}
              animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, filter: 'blur(8px)', scale: 0.95 }}
              transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
              onClick={() => onSuggestion(s.text)}
              className="flex items-start gap-2 border border-border-subtle bg-layer p-3 text-left transition-colors hover:border-border-strong hover:bg-layer-hover focus:outline-none focus:ring-1 focus:ring-focus"
            >
              <span className="mt-0.5 text-xs text-interactive">{'>'}</span>
              <span className="text-xs text-text-secondary">{s.text}</span>
            </motion.button>
          </AnimatePresence>
        ))}
      </div>
    </motion.div>
  )
}
