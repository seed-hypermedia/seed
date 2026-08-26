import type {AgentModelRef, ModelProviderInfo, ModelProviderType} from './client'
import {useModelProviders, useProviderModels} from './models'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Check, ChevronsUpDown, Plus} from 'lucide-react'
import {useMemo, useState} from 'react'
import {curateProviderModels, modelLabel} from './model-utils'
import {ProviderIcon} from './provider-icons'

/**
 * Unified provider + model picker: one popover listing every configured
 * provider as a section with its model catalog inside, searchable across all
 * of them. Clicking a model selects the provider/model pair together; the
 * optional per-row checkboxes mark quick-switch choices (which may span
 * providers) without changing the active pair. Replaces the separate provider
 * dropdown + model dropdown in agent settings and agent creation.
 */
export function ProviderModelSelect({
  serverUrl,
  accountUid,
  agentId,
  value,
  onChange,
  enabledModels,
  onToggleModel,
  onAddProvider,
  disabled,
}: {
  serverUrl: string | undefined
  accountUid: string | null | undefined
  /** Set when editing an existing agent so shared agents list the owner's providers. */
  agentId?: string
  /** Active pair; empty strings mean nothing is selected yet. */
  value: AgentModelRef
  onChange: (entry: AgentModelRef) => void
  /** Checked quick-switch pairs; the active pair counts as checked implicitly. */
  enabledModels?: AgentModelRef[]
  /** Enables the per-row checkboxes when provided. */
  onToggleModel?: (entry: AgentModelRef, enabled: boolean) => void
  onAddProvider?: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const providers = useModelProviders(serverUrl, accountUid, agentId)

  const trimmedQuery = query.trim().toLowerCase()
  const valueProvider = providers.data?.find((provider) => provider.name === value.provider)
  const triggerLabel = value.model || 'Select a model'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={cn(
          'border-border flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-left text-sm transition-[color,box-shadow,border-color] outline-none hover:border-black/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {valueProvider ? (
            <ProviderIcon type={valueProvider.type as ModelProviderType} className="size-4 shrink-0" />
          ) : null}
          <span className={cn('truncate', !value.model && 'text-muted-foreground')}>{triggerLabel}</span>
          {value.model && (providers.data?.length ?? 0) > 1 ? (
            <span className="text-muted-foreground shrink-0 truncate text-xs">{value.provider}</span>
          ) : null}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
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
        <div className="max-h-80 overflow-y-auto p-1">
          {providers.isLoading ? (
            <div className="px-2 py-3">
              <SizableText size="sm" color="muted">
                Loading providers…
              </SizableText>
            </div>
          ) : !providers.data?.length ? (
            <div className="px-2 py-3">
              <SizableText size="sm" color="muted">
                No providers configured yet.
              </SizableText>
            </div>
          ) : (
            providers.data.map((provider) => (
              <ProviderModelSection
                key={provider.id}
                serverUrl={serverUrl}
                accountUid={accountUid}
                agentId={agentId}
                provider={provider}
                query={trimmedQuery}
                value={value}
                enabledModels={enabledModels}
                onToggleModel={onToggleModel}
                onSelect={(entry) => {
                  onChange(entry)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
        {onAddProvider ? (
          <div className="border-border border-t p-1">
            <button
              type="button"
              className="hover:bg-muted text-muted-foreground flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs"
              onClick={() => {
                setOpen(false)
                onAddProvider()
              }}
            >
              <Plus className="size-3.5" />
              Add provider…
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** One provider's group in the unified picker: header, its model catalog, and a show-all toggle. */
function ProviderModelSection({
  serverUrl,
  accountUid,
  agentId,
  provider,
  query,
  value,
  enabledModels,
  onToggleModel,
  onSelect,
}: {
  serverUrl: string | undefined
  accountUid: string | null | undefined
  agentId?: string
  provider: ModelProviderInfo
  /** Lower-cased trimmed search text; empty shows the curated list. */
  query: string
  value: AgentModelRef
  enabledModels?: AgentModelRef[]
  onToggleModel?: (entry: AgentModelRef, enabled: boolean) => void
  onSelect: (entry: AgentModelRef) => void
}) {
  const models = useProviderModels(serverUrl, accountUid, provider.name, agentId)
  const [showAll, setShowAll] = useState(false)
  const curated = useMemo(() => curateProviderModels(models.data, provider.type), [models.data, provider.type])

  const visibleModels = useMemo(() => {
    if (query) {
      return curated.all.filter(
        (model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query),
      )
    }
    return showAll ? curated.all : curated.recommended
  }, [curated, query, showAll])

  // While searching, a provider with no matches drops out entirely instead of
  // showing an empty header.
  if (query && !visibleModels.length) return null

  return (
    <div className="pb-1">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-semibold">
        <ProviderIcon type={provider.type as ModelProviderType} className="size-3.5" />
        <span className="truncate">{provider.name}</span>
      </div>
      {models.isError ? (
        <SizableText size="xs" className="text-destructive block px-2 py-1">
          {models.error instanceof Error ? models.error.message : 'Could not load models'}
        </SizableText>
      ) : models.isLoading ? (
        <SizableText size="xs" color="muted" className="block px-2 py-1">
          Loading models…
        </SizableText>
      ) : !visibleModels.length ? (
        <SizableText size="xs" color="muted" className="block px-2 py-1">
          No models found.
        </SizableText>
      ) : (
        visibleModels.map((model) => {
          const isActive = provider.name === value.provider && model.id === value.model
          const isEnabled =
            isActive || !!enabledModels?.some((entry) => entry.provider === provider.name && entry.model === model.id)
          return (
            <div
              key={model.id}
              className={cn('hover:bg-muted flex w-full items-center gap-1 rounded-sm', isActive && 'bg-muted')}
            >
              {onToggleModel ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isEnabled}
                  aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${modelLabel(model)} for quick switching`}
                  title={
                    isActive
                      ? 'The current model is always available'
                      : isEnabled
                        ? 'Remove from the model switcher'
                        : 'Add to the model switcher'
                  }
                  disabled={isActive}
                  className={cn(
                    'ml-2 flex size-4 shrink-0 items-center justify-center rounded-xs border',
                    isEnabled ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-transparent',
                    isActive && 'opacity-50',
                  )}
                  onClick={() => onToggleModel({provider: provider.name, model: model.id}, !isEnabled)}
                >
                  {isEnabled ? <Check className="size-3" /> : null}
                </button>
              ) : null}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-sm"
                onClick={() => onSelect({provider: provider.name, model: model.id})}
              >
                <span className="min-w-0 truncate">{modelLabel(model)}</span>
                {isActive ? <Check className="size-4 shrink-0" /> : null}
              </button>
            </div>
          )
        })
      )}
      {!query && curated.hasMore && !models.isLoading && !models.isError ? (
        <button
          type="button"
          className="hover:bg-muted text-muted-foreground w-full rounded-sm px-2 py-1 text-left text-xs"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer models' : `Show all ${curated.all.length} models`}
        </button>
      ) : null}
    </div>
  )
}
