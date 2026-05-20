import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Terminal } from 'lucide-react'

export default function ToolExecutionCard({ tool }: { tool: { command: string; stdout: string; stderr: string; status: string } }) {
  const [expanded, setExpanded] = useState(true)
  const isSuccess = tool.status === 'success'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 overflow-hidden border border-border-subtle bg-layer"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <div className={`flex h-5 w-5 items-center justify-center ${isSuccess ? 'bg-support-success/10' : 'bg-support-error/10'}`}>
            {isSuccess ? (
              <CheckCircle2 className="h-3 w-3 text-support-success" aria-hidden="true" />
            ) : (
              <XCircle className="h-3 w-3 text-support-error" aria-hidden="true" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3 w-3 text-text-helper" aria-hidden="true" />
            <span className="truncate font-mono text-[11px] text-text-secondary">{tool.command}</span>
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${isSuccess ? 'text-support-success' : 'text-support-error'}`}>
          {tool.status}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-subtle">
              {tool.stdout && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Output</p>
                  <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                    {tool.stdout}
                  </pre>
                </div>
              )}
              {tool.stderr && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Stderr</p>
                  <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-support-error">
                    {tool.stderr}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
