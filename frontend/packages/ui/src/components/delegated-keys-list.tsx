import { KeyRound } from 'lucide-react'
import { type ReactNode } from 'react'
import { SizableText } from '../text'

export type DelegatedKeyItem = {
  id: string
  /** Primary label (e.g. a session/client name or capability label). */
  title: string
  /** Secondary mono line (the delegate principal / account id). */
  subtitle?: string
  /** Optional pill (e.g. the capability role). */
  badge?: string
  /** Optional right-aligned date label. */
  dateLabel?: string
  /** Optional leading icon; defaults to a key glyph. */
  icon?: ReactNode
}

/**
 * Shared, cross-platform list of an account's delegated keys ("devices").
 *
 * Presentational and data-agnostic: each platform maps its own source into
 * `DelegatedKeyItem`s. The desktop app derives them from the daemon's
 * ListCapabilities (agent/writer grants on the home document); the web vault
 * derives them from the account's stored delegated sessions.
 */
export function DelegatedKeysList({
  items,
  emptyLabel = 'No Sites Connected',
  emptyDescription = 'When you log into a Hypermedia site, your session will appear here.',
}: {
  items: DelegatedKeyItem[]
  emptyLabel?: string
  emptyDescription?: string
}) {
  if (!items.length) {
    return (
      <div className="border-border flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
        <SizableText weight="bold">{emptyLabel}</SizableText>
        <SizableText size="sm" color="muted" className="max-w-sm">
          {emptyDescription}
        </SizableText>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10"
        >
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
            {item.icon ?? <KeyRound className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <SizableText size="sm" weight="bold" className="truncate">
              {item.title}
            </SizableText>
            {item.subtitle ? (
              <SizableText size="xs" color="muted" className="truncate font-mono">
                {item.subtitle}
              </SizableText>
            ) : null}
          </div>
          {item.badge || item.dateLabel ? (
            <div className="flex shrink-0 flex-col items-end gap-1">
              {item.badge ? (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs capitalize">
                  {item.badge}
                </span>
              ) : null}
              {item.dateLabel ? (
                <SizableText size="xs" color="muted">
                  {item.dateLabel}
                </SizableText>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
