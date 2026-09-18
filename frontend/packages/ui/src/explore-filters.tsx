import type {HMExploreContext, HMExploreResultType} from '@shm/shared/explore'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Check, ChevronDown} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {Checkbox} from './components/checkbox'
import {cn} from './utils'

/** Trigger for one dropdown in the explorer filter row. */
export function ExploreChipButton({
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
