import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { ChevronUp, Check, Loader2, Search, Cpu } from 'lucide-react'

interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

const CATEGORY_ORDER = ['nvidia', 'meta', 'mistralai', 'qwen', 'deepseek-ai', 'google', 'microsoft', 'other']

const CATEGORY_LABELS: Record<string, string> = {
  nvidia: 'NVIDIA',
  meta: 'Meta',
  mistralai: 'Mistral AI',
  qwen: 'Qwen',
  'deepseek-ai': 'DeepSeek',
  google: 'Google',
  microsoft: 'Microsoft',
  other: 'Other',
}

function getCategory(model: Model): string {
  const owner = model.owned_by.toLowerCase()
  if (CATEGORY_ORDER.includes(owner)) return owner
  return 'other'
}

export default function ModelSelector({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
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

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.toLowerCase().trim()
    if (!q) return data
    return data.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.owned_by.toLowerCase().includes(q)
    )
  }, [data, search])

  const grouped = useMemo(() => {
    const groups: Record<string, Model[]> = {}
    filtered.forEach((m) => {
      const cat = getCategory(m)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(m)
    })
    return groups
  }, [filtered])

  const selectedModel = data?.find((m) => m.id === selected)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2.5 text-left text-xs text-[#c6c6c6] transition-all hover:border-[#0f62fe]/30 hover:bg-[#1a1a1a]/80"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-[#0f62fe]" />
          <span className="truncate font-mono">{selectedModel?.id || selected}</span>
        </div>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-[#525252] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-80 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] shadow-2xl shadow-black/50">
          {/* Search */}
          <div className="border-b border-[#2a2a2a] p-2">
            <div className="flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-2">
              <Search className="h-3.5 w-3.5 text-[#525252]" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#525252]"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-60 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#0f62fe]" />
              </div>
            )}

            {error && (
              <div className="px-3 py-4 text-center text-xs text-[#da1e28]">
                Failed to load models
              </div>
            )}

            {!isLoading && !error && filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-[#525252]">
                No models found
              </div>
            )}

            {CATEGORY_ORDER.map((cat) => {
              const models = grouped[cat]
              if (!models || models.length === 0) return null
              return (
                <div key={cat}>
                  <div className="sticky top-0 bg-[#1a1a1a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                    {CATEGORY_LABELS[cat] || cat}
                  </div>
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        onSelect(model.id)
                        setOpen(false)
                        setSearch('')
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-xs transition-colors hover:bg-[#2a2a2a] ${
                        selected === model.id ? 'bg-[#0f62fe]/10 text-[#0f62fe]' : 'text-[#c6c6c6]'
                      }`}
                    >
                      <span className="truncate font-mono">{model.id}</span>
                      {selected === model.id && <Check className="h-3.5 w-3.5 shrink-0 text-[#0f62fe]" />}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
