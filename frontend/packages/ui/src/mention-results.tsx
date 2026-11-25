import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {getDocumentTitle, hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {mentionBreadcrumbSegments, mentionCandidateSubtitle, timeAgo} from '@shm/shared/models/mention-ranking'
import {useEffect, useRef} from 'react'
import {LoadedHMIcon} from './hm-icon'
import {cn} from './utils'

/** Space name resolved from the candidate's home document, when it loads. */
function useSpaceName(accountUid: string) {
  const home = useResource(hmId(accountUid))
  const doc = home.data?.type === 'document' ? home.data.document : undefined
  return doc ? getDocumentTitle(doc) : undefined
}

/** Document subtitle: "Space / parents… · 6h ago" — breadcrumbs ellipsize, time stays visible. */
function DocumentSubtitle({item}: {item: HMMentionCandidate}) {
  const spaceName = useSpaceName(item.parentNames[0] || item.id.uid)
  const crumbs = mentionBreadcrumbSegments(item, spaceName)
  const time = item.activityTime === undefined ? undefined : timeAgo(item.activityTime, Date.now())
  return (
    <span className="flex min-w-0 items-baseline">
      <span className="min-w-0 truncate">{crumbs.join(' / ')}</span>
      {time ? <span className="flex-none whitespace-nowrap"> · {time}</span> : null}
    </span>
  )
}

/** Shared account/document suggestions for editor mentions and reference fields. */
export function MentionResults({
  id,
  mode,
  suggestions,
  selected,
  loading,
  error,
  onRetry,
  onSelect,
  className,
}: {
  id: string
  mode: 'account' | 'document'
  suggestions: HMMentionCandidate[]
  selected: number
  loading: boolean
  error: boolean
  onRetry: () => void
  onSelect: (item: HMMentionCandidate) => void
  className?: string
}) {
  const rows = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    rows.current[selected]?.scrollIntoView?.({block: 'nearest'})
  }, [selected])
  return (
    <div
      id={id}
      role="listbox"
      aria-label={mode === 'account' ? 'Accounts' : 'Documents'}
      aria-busy={loading}
      className={cn(
        'border-border bg-background flex max-h-64 w-80 flex-col overflow-y-auto rounded border shadow-lg',
        className,
      )}
    >
      {loading && !suggestions.length && (
        <p role="status" className="text-muted-foreground px-4 py-2">
          Searching…
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 py-2">
          Unable to load mentions or resolve the published version.{' '}
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {!loading && !error && !suggestions.length && (
        <p role="status" className="text-muted-foreground px-4 py-2">
          No {mode === 'account' ? 'accounts' : 'documents'} found
        </p>
      )}
      {suggestions.map((item, i) => (
        <button
          type="button"
          id={`${id}-${i}`}
          key={item.id.id}
          ref={(el) => {
            rows.current[i] = el
          }}
          role="option"
          aria-selected={selected === i}
          disabled={loading || error}
          className={`flex min-h-12 items-center gap-3 px-4 py-2 text-left ${
            selected === i ? 'bg-accent' : 'hover:bg-accent'
          }`}
          onPointerDown={(event) => {
            if (event.button !== 0 || loading || error) return
            event.preventDefault()
          }}
          onClick={() => onSelect(item)}
        >
          <LoadedHMIcon id={item.id} size={24} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.title || item.id.uid}</span>
            <span className="text-muted-foreground text-xs" title={item.type === 'account' ? item.id.uid : undefined}>
              {item.type === 'document' ? <DocumentSubtitle item={item} /> : mentionCandidateSubtitle(item)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
