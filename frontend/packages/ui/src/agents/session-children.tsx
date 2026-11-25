import {type SessionInfo} from './client'
import {describeAgentError} from './errors'
import {useChildSessions} from './models'
import {Notice} from '@shm/ui/notice'
import {ChevronDown, ChevronRight} from 'lucide-react'
import React, {useState} from 'react'

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

/**
 * Disclosure for the sub-sessions spawned under one session.
 *
 * Session lists exclude children, so a parent carries only `childSessionCount` until the user opens
 * this — the child list is fetched on first expand and then kept live by the existing WebSocket
 * invalidations.
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
            <Notice
              size="sm"
              tone={describeAgentError(children.error, {failed: 'Couldn’t load sub-sessions'}).tone}
              onRetry={() => void children.refetch()}
              retryPending={children.isFetching}
              className="my-1"
            >
              Couldn’t load sub-sessions
            </Notice>
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
                <span className="min-w-0 flex-1 truncate">{child.title || 'Untitled sub-session'}</span>
                {child.status === 'error' ? <span className="text-destructive shrink-0">Error</span> : null}
              </span>
              {child.description ? (
                <span className="text-muted-foreground line-clamp-3 w-full text-xs">{child.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
