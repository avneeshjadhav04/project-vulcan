import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { ChevronUp, Check, Loader2 } from 'lucide-react'

interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

export default function ModelSelector({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await api.get('/models')
      return res.data.models as Model[]
    },
    enabled: open,
    retry: false,
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between border border-border bg-background px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-surface-hover"
      >
        <span className="truncate font-mono">{selected}</span>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-y-auto border border-border bg-surface shadow-xl">
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-error">
              Failed to load models. Please check your connection or re-authenticate.
            </div>
          )}
          {data?.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onSelect(model.id)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover ${
                selected === model.id ? 'bg-surface-hover text-text-primary' : 'text-text-secondary'
              }`}
            >
              <span className="truncate font-mono">{model.id}</span>
              {selected === model.id && <Check className="h-3.5 w-3.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
