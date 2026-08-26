import {type SessionInfo} from './client'
import {useChildSessions} from './models'
import {ChevronDown, ChevronRight} from 'lucide-react'
import React, {useState} from 'react'

/** Status dot shown beside a session title in every session list. */
/**
 * The agent's own summary of a session (status verb, or the server's namer), pinned above the
 * chat so a reader knows what the session is doing without scrolling the transcript.
 */
export function SessionSummaryBanner({
  description,
  compact,
  className = '',
}: {
  description: string | undefined
  compact?: boolean
  className?: string
}) {
  if (!description) return null
  return (
    <div
      className={`border-border bg-card/95 supports-[backdrop-filter]:bg-card/80 flex-none border-b backdrop-blur ${
        compact ? 'px-3 py-1.5' : 'px-1 py-2'
      } ${className}`}
      aria-label="Session summary"
    >
      <p className={`text-muted-foreground line-clamp-3 ${compact ? 'text-xs' : 'text-sm'}`} title={description}>
        {description}
      </p>
    </div>
  )
}

export function SessionStatusDot({status, className}: {status: SessionInfo['status']; className?: string}) {
  const statusClass =
    status === 'error'
      ? 'bg-destructive'
      : status === 'streaming'
        ? 'bg-muted-foreground animate-pulse'
        : 'bg-green-500'
  return (
    <span
      className={`${statusClass} ${className || 'size-2.5'} flex-none rounded-full`}
      aria-label={status}
      title={status}
    />
  )
}

/**
 * Rolls the children's statuses into the one dot shown on a collapsed parent row: a failure has to
 * be visible without opening the disclosure, and anything still streaming keeps the row animated.
 */
function summarizeChildStatus(children: SessionInfo[] | undefined): SessionInfo['status'] | undefined {
  if (!children?.length) return undefined
  if (children.some((child) => child.status === 'error')) return 'error'
  if (children.some((child) => child.status === 'streaming')) return 'streaming'
  return 'idle'
}

/**
 * Disclosure for the sub-sessions spawned under one session.
 *
 * Session lists exclude children, so a parent carries only `childSessionCount` until the user opens
 * this — the child list is fetched on first expand and then kept live by the existing WebSocket
 * invalidations. Until that first fetch the summary dot has nothing to summarize and stays neutral.
 */
export function SubSessionsDisclosure({
  serverUrl,
  accountUid,
  parentSessionId,
  childSessionCount,
  compact,
  selectedSessionId,
  onOpenSession,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  parentSessionId: string
  childSessionCount: number
  /** Sidebar sizing: smaller text and tighter rows. */
  compact?: boolean
  selectedSessionId?: string
  onOpenSession: (session: SessionInfo, event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const children = useChildSessions(serverUrl, accountUid, parentSessionId, {enabled: expanded})
  const summaryStatus = summarizeChildStatus(children.data)
  const textClass = compact ? 'text-[11px]' : 'text-xs'

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        className={`text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start rounded px-1 py-0.5 max-sm:min-h-10 ${textClass}`}
        onClick={(event) => {
          event.stopPropagation()
          setExpanded((current) => !current)
        }}
      >
        {expanded ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
        {summaryStatus ? (
          <SessionStatusDot status={summaryStatus} className="size-2" />
        ) : (
          <span className="bg-muted-foreground/40 size-2 flex-none rounded-full" />
        )}
        <span>
          {childSessionCount} sub-session{childSessionCount === 1 ? '' : 's'}
        </span>
      </button>
      {expanded ? (
        <div className={`border-border ml-2 flex flex-col border-l ${compact ? 'pl-2' : 'pl-3'}`}>
          {children.isLoading ? (
            <span className={`text-muted-foreground px-2 py-1 ${textClass}`}>Loading sub-sessions…</span>
          ) : null}
          {children.isError ? (
            <span className={`text-destructive px-2 py-1 ${textClass}`}>Could not load sub-sessions</span>
          ) : null}
          {children.data?.length === 0 ? (
            <span className={`text-muted-foreground px-2 py-1 ${textClass}`}>No sub-sessions</span>
          ) : null}
          {children.data?.map((child) => (
            <button
              key={child.id}
              type="button"
              className={`hover:bg-muted flex w-full flex-col gap-0.5 rounded px-2 py-1 text-left ${textClass} ${
                child.id === selectedSessionId ? 'bg-muted' : ''
              }`}
              onClick={(event) => {
                event.stopPropagation()
                onOpenSession(child, event)
              }}
            >
              <span className="flex w-full items-center gap-2">
                <SessionStatusDot status={child.status} className="size-2" />
                <span className="min-w-0 flex-1 truncate">{child.title || 'Untitled sub-session'}</span>
              </span>
              {child.description ? (
                <span className="text-muted-foreground line-clamp-3 w-full pl-4 text-xs">{child.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
