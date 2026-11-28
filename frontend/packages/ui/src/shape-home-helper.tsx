import {Check, Loader2, AlertCircle} from 'lucide-react'
import {Button} from './button'
import {SizableText} from './text'

const MAX_VISIBLE = 12

/** A candidate page shown in the Shape Home helper. */
export interface ShapeHomeCandidateItem {
  id: string
  title: string
}

/** Props for the Shape Home helper block shown above Home content. */
export interface ShapeHomeHelperProps {
  /** Helper state. */
  state: 'loading' | 'choosing' | 'adding' | 'failed' | 'loadFailed'
  /** Candidate pages (state=choosing). */
  candidates: ShapeHomeCandidateItem[]
  /** Selected candidate id set (state=choosing). */
  selected: Set<string>
  /** Whether all candidates are shown or only the first MAX_VISIBLE. */
  showAll: boolean
  /** Error message (state=failed/loadFailed). */
  error?: string
  /** Toggle a candidate selection by id. */
  onToggle: (id: string) => void
  /** Show all candidates. */
  onShowMore: () => void
  /** Add the selected pages to Home. */
  onAdd: () => void
  /** Retry after a failure. */
  onRetry: () => void
  /** Dismiss the helper. */
  onNotNow: () => void
}

/** In-page helper block on a site's Home offering to add missing pages as Cards. */
export function ShapeHomeHelper({
  state,
  candidates,
  selected,
  showAll,
  error,
  onToggle,
  onShowMore,
  onAdd,
  onRetry,
  onNotNow,
}: ShapeHomeHelperProps) {
  const disabled = state === 'adding' || state === 'loading'
  const visible = showAll ? candidates : candidates.slice(0, MAX_VISIBLE)
  const hiddenCount = candidates.length - MAX_VISIBLE
  const selectedCount = selected.size
  const addLabel =
    selectedCount === candidates.length && candidates.length > 0 ? 'Add all to Home' : `Add ${selectedCount} to Home`
  return (
    <div
      role="status"
      className="border-brand/30 bg-brand/5 mx-auto my-4 flex w-full max-w-2xl flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start gap-2">
        <Check className="text-brand mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <SizableText size="sm" weight="bold">
            We changed how Seed organises spaces
          </SizableText>
          <SizableText size="sm" color="muted">
            These pages aren’t in your document browser yet. Add them to Home to show them on the left.
          </SizableText>
        </div>
      </div>

      {state === 'loadFailed' ? (
        <div className="flex flex-col gap-2">
          <p className="text-destructive text-sm">Couldn’t load your pages.</p>
          {error ? <p className="text-muted-foreground text-xs">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onNotNow}>
              Not now
            </Button>
          </div>
        </div>
      ) : state === 'failed' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-destructive text-sm">{error || 'Something went wrong.'}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onNotNow}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {state === 'loading'
              ? Array.from({length: 3}).map((_, i) => (
                  <span key={i} className="bg-muted h-7 w-24 rounded-full motion-safe:animate-pulse" aria-hidden />
                ))
              : visible.map((item) => {
                  const isSel = selected.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isSel}
                      disabled={disabled}
                      onClick={() => onToggle(item.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
                        isSel
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-border bg-background text-foreground hover:bg-accent'
                      }`}
                    >
                      {isSel ? <Check className="size-3.5" aria-hidden /> : null}
                      <span className="max-w-[12rem] truncate" title={item.title}>
                        {item.title}
                      </span>
                    </button>
                  )
                })}
          </div>
          {!showAll && hiddenCount > 0 ? (
            <Button size="sm" variant="link" onClick={onShowMore} className="w-fit">
              Show {hiddenCount} more
            </Button>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onNotNow} disabled={disabled}>
              Not now
            </Button>
            <Button size="sm" variant="default" onClick={onAdd} disabled={disabled || selectedCount === 0}>
              {state === 'adding' ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                addLabel
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
