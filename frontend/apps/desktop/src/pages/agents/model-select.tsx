import type {ProviderModelInfo} from '@/agents-client'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Check, ChevronsUpDown} from 'lucide-react'
import {useMemo, useState} from 'react'
import {curateProviderModels, modelLabel} from './model-utils'

/**
 * Searchable model picker shared by every agent model dropdown. Shows a short
 * curated list by default (embeddings/audio/image models removed, dated
 * snapshots collapsed) with a "show all" affordance and free-text search to
 * reach the full provider list.
 */
export function ModelSelect({
  models,
  providerType,
  value,
  onChange,
  isLoading,
  isError,
  error,
  disabled,
}: {
  models: ProviderModelInfo[] | undefined
  providerType: string | undefined
  value: string
  onChange: (id: string) => void
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const curated = useMemo(() => curateProviderModels(models, providerType), [models, providerType])

  const trimmedQuery = query.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    if (trimmedQuery) {
      return curated.all.filter(
        (model) => model.id.toLowerCase().includes(trimmedQuery) || model.name.toLowerCase().includes(trimmedQuery),
      )
    }
    return showAll ? curated.all : curated.recommended
  }, [curated, showAll, trimmedQuery])

  const selectedModel = useMemo(() => curated.all.find((model) => model.id === value), [curated.all, value])
  const triggerLabel = isLoading
    ? 'Loading models…'
    : selectedModel
      ? modelLabel(selectedModel)
      : value || 'Select a model'

  const isDisabled = disabled || isLoading

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery('')
          setShowAll(false)
        }
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={isDisabled}
        className={cn(
          'border-input bg-background flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('truncate', !selectedModel && !value && 'text-muted-foreground')}>{triggerLabel}</span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-border border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models…"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {isError ? (
            <div className="px-2 py-3">
              <SizableText size="xs" className="text-destructive">
                {error instanceof Error ? error.message : 'Could not load models'}
              </SizableText>
            </div>
          ) : visibleModels.length === 0 ? (
            <div className="px-2 py-3">
              <SizableText size="sm" color="muted">
                {isLoading ? 'Loading models…' : 'No models found.'}
              </SizableText>
            </div>
          ) : (
            visibleModels.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  'hover:bg-muted flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  model.id === value && 'bg-muted',
                )}
                onClick={() => {
                  onChange(model.id)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 truncate">{modelLabel(model)}</span>
                {model.id === value ? <Check className="size-4 shrink-0" /> : null}
              </button>
            ))
          )}
        </div>
        {!trimmedQuery && curated.hasMore ? (
          <div className="border-border border-t p-1">
            <button
              type="button"
              className="hover:bg-muted text-muted-foreground w-full rounded-sm px-2 py-1.5 text-left text-xs"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? 'Show fewer models' : `Show all ${curated.all.length} models`}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
