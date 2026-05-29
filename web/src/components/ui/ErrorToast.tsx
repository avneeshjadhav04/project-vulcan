import { createContext, useContext, useState, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XCircle } from 'lucide-react'

// Simple global error toast using Context
type ShowError = (msg: string) => void

const ErrorToastContext = createContext<ShowError>(() => {})

export const ErrorToastProvider = ({ children }: { children: ReactNode }) => {
  const [error, setError] = useState<string | null>(null)

  const showError: ShowError = (msg) => {
    setError(msg)
    // Auto dismiss after 5 seconds
    setTimeout(() => setError(null), 5000)
  }

  return (
    <ErrorToastContext.Provider value={showError}>
      {children}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-md bg-support-error/10 border border-support-error/30 px-4 py-2 text-sm text-support-error shadow-lg"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              <span className="flex-1">{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ErrorToastContext.Provider>
  )
}

export const useErrorToast = () => useContext(ErrorToastContext)
