import { motion, AnimatePresence } from 'framer-motion'
import {
  Workflow,
  CheckCircle2,
  XCircle,
  Terminal,
  Globe,
  FileCode,
  RotateCcw,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useState } from 'react'

export interface AgentStep {
  id: number
  tool?: string
  status: 'running' | 'success' | 'error' | 'retry'
  result?: string
  retryCount?: number
}

export interface AgentState {
  plan: string
  steps: AgentStep[]
  currentStep: number
  totalSteps: number
  isPlanning: boolean
  isComplete: boolean
  finalResponse: string
}

interface AgentTimelineProps {
  state: AgentState
}

function ToolIcon({ tool }: { tool?: string }) {
  const iconClass = "h-3.5 w-3.5"
  if (tool?.includes('terminal') || tool?.includes('command')) return <Terminal className={iconClass} />
  if (tool?.includes('web') || tool?.includes('search')) return <Globe className={iconClass} />
  if (tool?.includes('file')) return <FileCode className={iconClass} />
  return <Sparkles className={iconClass} />
}

function StepStatus({ status }: { status: AgentStep['status'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-[#24a148]" />
    case 'error':
      return <XCircle className="h-4 w-4 text-[#da1e28]" />
    case 'retry':
      return <RotateCcw className="h-4 w-4 animate-spin text-[#f1c21b]" />
    case 'running':
    default:
      return <Loader2 className="h-4 w-4 animate-spin text-[#0f62fe]" />
  }
}

export function createInitialAgentState(): AgentState {
  return {
    plan: '',
    steps: [],
    currentStep: 0,
    totalSteps: 0,
    isPlanning: true,
    isComplete: false,
    finalResponse: '',
  }
}

export default function AgentTimeline({ state }: AgentTimelineProps) {
  const [planExpanded, setPlanExpanded] = useState(true)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  const toggleStep = (id: number) => {
    const next = new Set(expandedSteps)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedSteps(next)
  }

  const planLines = state.plan
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.trim())

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-3 overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-[#2a2a2a] px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0f62fe]/10">
          <Workflow className="h-4 w-4 text-[#0f62fe]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">Agent Workflow</p>
          <p className="text-[11px] text-[#525252]">
            {state.isPlanning
              ? 'Generating plan...'
              : state.isComplete
                ? 'Completed'
                : `Step ${state.currentStep} of ${state.totalSteps || '?'}`}
          </p>
        </div>
        {state.isComplete && <CheckCircle2 className="h-5 w-5 text-[#24a148]" />}
      </div>

      {/* Plan */}
      <AnimatePresence>
        {state.plan && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden border-b border-[#2a2a2a]"
          >
            <button
              onClick={() => setPlanExpanded(!planExpanded)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-[#525252]">Plan</span>
              {planExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-[#525252]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[#525252]" />
              )}
            </button>
            <AnimatePresence>
              {planExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1 px-4 pb-3">
                    {planLines.map((line, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-[#c6c6c6]">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0f62fe]/10 text-[10px] font-bold text-[#0f62fe]">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{line.replace(/^\d+\.\s*/, '')}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Steps */}
      <div className="px-4 py-3">
        {state.steps.length === 0 && state.isPlanning && (
          <div className="flex items-center gap-2 text-xs text-[#525252]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0f62fe]" />
            Analyzing task and creating execution plan...
          </div>
        )}

        <div className="space-y-2">
          {state.steps.map((step) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] overflow-hidden"
            >
              <button
                onClick={() => toggleStep(step.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <StepStatus status={step.status} />
                <div className="flex flex-1 items-center gap-2">
                  {step.tool && (
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-[#2a2a2a]">
                      <ToolIcon tool={step.tool} />
                    </div>
                  )}
                  <span className="text-xs font-medium text-white">
                    {step.tool
                      ? `${step.tool}`
                      : `Step ${step.id}`}
                  </span>
                  {step.retryCount !== undefined && step.retryCount > 0 && (
                    <span className="rounded bg-[#f1c21b]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#f1c21b]">
                      Retry {step.retryCount}
                    </span>
                  )}
                </div>
                {step.result && (
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-[#525252] transition-transform ${
                      expandedSteps.has(step.id) ? 'rotate-180' : ''
                    }`}
                  />
                )}
              </button>

              <AnimatePresence>
                {expandedSteps.has(step.id) && step.result && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-[#2a2a2a] px-3 py-2">
                      <pre className="max-h-32 overflow-auto rounded-lg bg-[#1a1a1a] p-2 font-mono text-[11px] text-[#c6c6c6]">
                        {step.result}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        {state.isComplete && state.finalResponse && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 flex items-center gap-2 rounded-xl bg-[#24a148]/10 px-3 py-2 text-xs text-[#24a148]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Agent finished. Response delivered below.
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
