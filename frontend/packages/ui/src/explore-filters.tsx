import type {ExploreDateSelection, ExploreTimeField, HMExploreContext, HMExploreResultType} from '@shm/shared/explore'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Check, ChevronDown, X} from 'lucide-react'
import type {ReactNode} from 'react'
import {useState} from 'react'
import {Button} from './button'
import {Checkbox} from './components/checkbox'
import {Input} from './components/input'
import {cn} from './utils'

/** Trigger for one dropdown in the explorer filter row. */
export function FilterChipButton({
  label,
  active,
  open,
  onClick,
}: {
  label: string
  active?: boolean
  open?: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      aria-expanded={!!open}
      className={cn('rounded-full', (active || open) && 'border-primary text-primary')}
    >
      {label}
      <ChevronDown className="ml-1 size-3.5" aria-hidden />
    </Button>
  )
}

/** Removable active-filter chip shared by Explore and query blocks. */
export function ActiveFilterChip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={removeLabel}
      className="border-border bg-muted/40 hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors"
    >
      {children}
      <X className="size-3" aria-hidden />
    </button>
  )
}

/** Wrapping active-filter row with the shared Clear all action. */
export function ActiveFilterChipRow({children, onClear}: {children: ReactNode; onClear?: () => void}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onClear ? (
        <button type="button" className="text-muted-foreground hover:text-foreground px-2 text-xs" onClick={onClear}>
          Clear all
        </button>
      ) : null}
    </div>
  )
}

/** Space picker opened by the scope chip. */
export function ExploreScopeMenu({
  context,
  accounts,
  onChange,
}: {
  context: HMExploreContext
  accounts: Array<{value: string; label: string}>
  onChange: (scope: HMExploreContext) => void
}) {
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 max-h-80 min-w-56 overflow-auto rounded-md border p-1 shadow-md">
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
        onClick={() => onChange({type: 'node'})}
      >
        {context.type === 'node' ? <Check className="size-3.5" /> : <span className="size-3.5" />}
        All spaces
      </button>
      {accounts.map((account) => (
        <button
          key={account.value}
          type="button"
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
          onClick={() => onChange({type: 'site', id: hmId(account.value)})}
        >
          {context.type === 'site' && context.id.uid === account.value ? (
            <Check className="size-3.5" />
          ) : (
            <span className="size-3.5" />
          )}
          <span className="truncate">{account.label}</span>
        </button>
      ))}
    </div>
  )
}

export const typeOptions: Array<{value: HMExploreResultType; label: string}> = [
  {value: 'document', label: 'Documents'},
  {value: 'block', label: 'Text blocks'},
  {value: 'comment', label: 'Conversations'},
  {value: 'space', label: 'Spaces'},
  {value: 'contact', label: 'People'},
]

/**
 * Multi-select of result types, applied in one go rather than per click.
 * The counts are already loaded results, so they move as more pages arrive.
 */
export function ExploreTypeMenu({
  counts,
  showCounts,
  selected,
  onApply,
}: {
  counts: Record<HMExploreResultType | 'all', number>
  showCounts: boolean
  selected: HMExploreResultType[]
  onApply: (types: HMExploreResultType[]) => void
}) {
  const [draft, setDraft] = useState<HMExploreResultType[]>(selected)
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 min-w-60 rounded-md border p-2 shadow-md">
      {typeOptions.map((option) => {
        const checked = draft.includes(option.value)
        return (
          <label
            key={option.value}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
          >
            <Checkbox
              className="border-muted-foreground/50 border"
              checked={checked}
              onCheckedChange={() =>
                setDraft(checked ? draft.filter((value) => value !== option.value) : [...draft, option.value])
              }
            />
            <span className="flex-1">{option.label}</span>
            {showCounts ? <span className="text-muted-foreground tabular-nums">{counts[option.value]}</span> : null}
          </label>
        )
      })}
      <Button size="sm" variant="brand" className="mt-2 w-full" onClick={() => onApply(draft)}>
        Apply filters
      </Button>
    </div>
  )
}

// The search box limit for accounts.
const AUTHOR_MENU_LIMIT = 50

/** Single-select author picker. */
export function ExploreAuthorMenu({
  accounts,
  isLoading,
  selected,
  onSelect,
}: {
  accounts: Array<{value: string; label: string}>
  isLoading?: boolean
  selected: string | null
  onSelect: (author: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  // Nameless accounts show their short id, listed after the named ones.
  const people = accounts
    .map((account) => {
      const named = !!account.label && account.label !== account.value
      return {value: account.value, label: named ? account.label : abbreviateUid(account.value), named}
    })
    .sort((a, b) => Number(b.named) - Number(a.named))
  const matches = needle ? people.filter((person) => person.label.toLowerCase().includes(needle)) : people
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 flex w-64 flex-col divide-y divide-black/10 rounded-md border shadow-md dark:divide-white/10">
      <div className="p-1">
        <Input
          autoFocus
          value={search}
          onChangeText={setSearch}
          placeholder="Search people"
          aria-label="Search authors"
          className="h-8 border-black/10 dark:border-white/10"
        />
      </div>
      <div className="p-1">
        <button
          type="button"
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
          onClick={() => onSelect(null)}
        >
          {selected ? <span className="size-3.5" /> : <Check className="size-3.5" />}
          Anyone
        </button>
      </div>
      <div className="flex max-h-72 flex-col overflow-auto p-1">
        {matches.slice(0, AUTHOR_MENU_LIMIT).map((person) => (
          <button
            key={person.value}
            type="button"
            className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
            onClick={() => onSelect(person.value)}
          >
            {selected === person.value ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            <span className={cn('truncate', !person.named && 'text-muted-foreground')}>{person.label}</span>
          </button>
        ))}
        {isLoading ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">Loading people…</p>
        ) : !matches.length ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">No one matches.</p>
        ) : matches.length > AUTHOR_MENU_LIMIT ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">Type to narrow {matches.length} people.</p>
        ) : null}
      </div>
    </div>
  )
}

const datePresets: Array<{value: ExploreDateSelection['preset']; label: string}> = [
  {value: 'any', label: 'Any time'},
  {value: 'week', label: 'Past week'},
  {value: 'month', label: 'Past month'},
  {value: 'year', label: 'Past year'},
  {value: 'custom', label: 'Custom range'},
]

/** Created-or-updated date range, applied in one go. */
export function ExploreDateMenu({
  initial,
  onApply,
}: {
  initial: ExploreDateSelection
  onApply: (selection: ExploreDateSelection) => void
}) {
  const [field, setField] = useState<ExploreTimeField>(initial.field)
  const [preset, setPreset] = useState<ExploreDateSelection['preset']>(initial.preset)
  const [from, setFrom] = useState(initial.preset === 'custom' ? initial.from ?? '' : '')
  const [to, setTo] = useState(initial.preset === 'custom' ? initial.to ?? '' : '')
  const apply = () =>
    onApply(preset === 'custom' ? {field, preset, from: from || undefined, to: to || undefined} : {field, preset})
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 flex w-64 flex-col rounded-md border shadow-md">
      <div className="p-2">
        <div
          className="bg-muted flex items-center gap-0.5 rounded-md border border-black/10 p-0.5 dark:border-white/10"
          role="radiogroup"
          aria-label="Date field"
        >
          {(['created', 'updated'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              role="radio"
              aria-checked={field === value}
              className={cn('h-7 flex-1', field === value && 'bg-background shadow-sm')}
              onClick={() => setField(value)}
            >
              {value === 'created' ? 'Created' : 'Updated'}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col p-1" role="radiogroup" aria-label="Date range">
        {datePresets.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preset === option.value}
            className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
            onClick={() => setPreset(option.value)}
          >
            {preset === option.value ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            {option.label}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <div className="flex flex-col gap-2 border-t border-black/10 p-2 dark:border-white/10">
          <label className="flex flex-col gap-1 text-xs">
            From
            <Input
              type="date"
              value={from}
              onChangeText={setFrom}
              max={to || undefined}
              className="h-8 border-black/10 dark:border-white/10 dark:scheme-dark"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            To
            <Input
              type="date"
              value={to}
              onChangeText={setTo}
              min={from || undefined}
              className="h-8 border-black/10 dark:border-white/10 dark:scheme-dark"
            />
          </label>
        </div>
      ) : null}
      <div className="p-2">
        <Button size="sm" variant="brand" className="w-full" onClick={apply}>
          Apply filters
        </Button>
      </div>
    </div>
  )
}

export function ExploreFilterMenu({
  options,
  activeTokens,
  onToggle,
}: {
  options: Array<{token: string; label: string}>
  activeTokens: string[]
  onToggle: (predicate: string) => void
}) {
  return (
    <div className="border-border bg-popover absolute top-10 left-0 z-10 flex min-w-44 flex-col rounded-md border p-1 shadow-md">
      {options.length ? (
        options.map((option) => (
          <button
            key={option.token}
            type="button"
            className={cn(
              'hover:bg-muted truncate rounded px-2 py-1.5 text-left text-sm',
              activeTokens.includes(option.token) && 'bg-accent',
            )}
            onClick={() => onToggle(option.token)}
          >
            {option.label}
          </button>
        ))
      ) : (
        <p className="text-muted-foreground px-2 py-2 text-xs">No suggestions available.</p>
      )}
    </div>
  )
}
