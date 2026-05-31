import { createContext, useContext, useState, ReactNode, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XCircle } from 'lucide-react'

// Simple global error toast using Context
type ShowError = (msg: string) => void

const ErrorToastContext = createContext<ShowError>(() => {})

export const ErrorToastProvider = ({ children }: { children: ReactNode }) => {
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPaused, setIsPaused] = useState(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => setError(null), 5000)
  }, [clearTimer])

  const showError: ShowError = useCallback((msg) => {
    setError(msg)
    startTimer()
  }, [startTimer])

  return (
    <ErrorToastContext.Provider value={showError}>
      {children}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onMouseEnter={() => {
              setIsPaused(true)
              clearTimer()
            }}
            onMouseLeave={() => {
              setIsPaused(false)
              startTimer()
            }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-md bg-support-error/10 border border-support-error/30 px-4 py-2 text-sm text-support-error shadow-lg cursor-default"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{error}</span>
              {isPaused && (
                <span className="text-[10px] text-support-error/60 ml-1">paused</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ErrorToastContext.Provider>
  )
}

export const useErrorToast = () => useContext(ErrorToastContext)
