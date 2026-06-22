import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { ChevronUp, Check, Loader2, Search, Cpu, AlertCircle, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

interface ProviderModels {
  provider_id: string
  provider_name: string
  models: Model[]
}

export interface SelectedModel {
  providerId: string
  modelId: string
}

export default function ProviderModelSelector({
  selected,
  onSelect,
}: {
  selected: SelectedModel
  onSelect: (selection: SelectedModel) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Keep provider list loaded at all times so the collapsed button label can
  // display the provider name alongside the model id consistently, even before
  // the user opens the dropup.
  const { data, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await api.get('/models')
      return (res.data.providers || []) as ProviderModels[]
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
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

  const flatModels = useMemo(() => {
    const list: { providerId: string; providerName: string; model: Model }[] = []
    if (!data) return list
    for (const pm of data) {
      for (const m of pm.models) {
        list.push({ providerId: pm.provider_id, providerName: pm.provider_name, model: m })
      }
    }
    return list
  }, [data])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return flatModels
    return flatModels.filter(
      (item) =>
        item.model.id.toLowerCase().includes(q) ||
        item.providerName.toLowerCase().includes(q)
    )
  }, [flatModels, search])

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {}
    for (const item of filtered) {
      if (!groups[item.providerName]) groups[item.providerName] = []
      groups[item.providerName].push(item)
    }
    return groups
  }, [filtered])

  const selectedItem = flatModels.find(
    (m) => m.providerId === selected.providerId && m.model.id === selected.modelId
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-carbon border border-border-subtle bg-layer/50 px-3 py-2.5 text-left text-xs text-text-secondary shadow-sm backdrop-blur-md transition-all hover:bg-layer/70"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-interactive" />
          <span className="font-mono truncate text-[11px]">
            {selectedItem
              ? `${selectedItem.providerName} / ${selectedItem.model.id}`
              : selected.providerId
                ? selected.modelId || 'Select model'
                : 'No provider'}
          </span>
        </div>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-text-helper transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 max-h-80 w-96 overflow-hidden rounded-carbon border border-border-subtle bg-layer shadow-xl">
          {/* Search */}
          <div className="border-b border-border-subtle p-2">
            <div className="flex items-center gap-2 bg-background px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-text-helper" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-placeholder"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-60 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-5">
                <Loader2 className="h-4 w-4 animate-spin text-interactive" />
              </div>
            )}

            {error && (
              <div className="px-3 py-3 text-center text-xs text-support-error">
                Failed to load models
              </div>
            )}

            {!isLoading && !error && (!data || data.length === 0) && (
              <div className="px-3 py-4 text-center">
                <AlertCircle className="mx-auto mb-2 h-5 w-5 text-text-helper" />
                <p className="text-xs text-text-helper mb-2">No providers configured</p>
                <button
                  onClick={() => {
                    setOpen(false)
                    navigate('/settings?tab=providers')
                  }}
                  className="inline-flex items-center gap-1 text-xs text-interactive hover:text-link-hover"
                >
                  <Plus className="h-3 w-3" />
                  Add a provider
                </button>
              </div>
            )}

            {!isLoading && !error && data && data.length > 0 && filtered.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-text-helper">
                No models found
              </div>
            )}

            {Object.entries(grouped).map(([providerName, items]) => (
              <div key={providerName}>
                <div className="sticky top-0 bg-layer px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                  {providerName}
                </div>
                {items.map((item) => (
                  <button
                    key={`${item.providerId}:${item.model.id}`}
                    onClick={() => {
                      onSelect({ providerId: item.providerId, modelId: item.model.id })
                      setOpen(false)
                      setSearch('')
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-layer-hover ${
                      selected.providerId === item.providerId && selected.modelId === item.model.id
                        ? 'bg-interactive/10 text-interactive'
                        : 'text-text-secondary'
                    }`}
                  >
                    <span className="font-mono break-all">{item.model.id}</span>
                    {selected.providerId === item.providerId && selected.modelId === item.model.id && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-interactive ml-2" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
