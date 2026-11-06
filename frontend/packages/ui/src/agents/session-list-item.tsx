import type {AgentRowActivity} from './activity'
import type {SessionInfo} from './client'
import {ContinuedFromListChip} from './continuation'
import {SubSessionsDisclosure} from './session-children'
import {formattedDateMedium, formattedTimeAgo} from '@shm/shared/utils/date'
import {SizableText} from '@shm/ui/text'
import {Bot} from 'lucide-react'
import type React from 'react'

/**
 * The right edge of a session row: any unread or working state in words, then how long ago the chat
 * last moved, with the exact time on hover. No colored dots here: they were removed on purpose (#1310).
 * Errors replace the time, since the time says nothing useful about a broken chat.
 */
function SessionRowMeta({
  activity,
  status,
  updatedAt,
  className,
}: {
  activity?: AgentRowActivity | null
  status: SessionInfo['status']
  updatedAt: number
  className?: string
}) {
  const date = new Date(updatedAt)
  return (
    <span className={`text-muted-foreground flex shrink-0 items-center gap-1.5 whitespace-nowrap ${className ?? ''}`}>
      {status === 'error' ? (
        <span className="text-destructive">Error</span>
      ) : (
        <>
          {/* Unread or working state stays visible as words ("New reply", "Working"), never a dot. */}
          {activity ? <span className="text-foreground">{activity.short}</span> : null}
          <span title={activity ? `${activity.label} · ${formattedDateMedium(date)}` : formattedDateMedium(date)}>
            {formattedTimeAgo(date)}
          </span>
        </>
      )}
    </span>
  )
}

/**
 * One top-level session in a list: title with how long ago it moved on the right, the agent's own
 * description, and the disclosure of any sub-sessions. `agentName` labels the row in lists that
 * span several agents. `compact` is the narrow column of the assistant sidebar.
 */
export function SessionListItem({
  session,
  serverUrl,
  accountUid,
  onOpen,
  onOpenSession,
  onOpenTrigger,
  agentName,
  activity,
  compact = false,
}: {
  session: SessionInfo
  serverUrl: string
  /** Shown beside the title when the list mixes agents. */
  agentName?: string
  accountUid: string | null | undefined
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Opens a sub-session listed under this one. */
  onOpenSession?: (session: SessionInfo, event: React.MouseEvent<HTMLButtonElement>) => void
  onOpenTrigger?: () => void
  /** Something unread in the chat, or the agent working in it. */
  activity?: AgentRowActivity | null
  compact?: boolean
}) {
  const title = session.title || 'Untitled session'
  const trigger = session.startedByTrigger ? (
    <button
      type="button"
      className={`bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-bold ${compact ? 'mt-1' : 'mt-2'}`}
      onClick={(event) => {
        event.stopPropagation()
        onOpenTrigger?.()
      }}
    >
      Triggered by {session.startedByTrigger.triggerName}
    </button>
  ) : null
  const children =
    session.childSessionCount && onOpenSession ? (
      <div className={`mt-1 w-full ${compact ? 'pl-4' : 'pl-5'}`}>
        <SubSessionsDisclosure
          serverUrl={serverUrl}
          accountUid={accountUid}
          parentSessionId={session.id}
          childSessionCount={session.childSessionCount}
          onOpenSession={onOpenSession}
        />
      </div>
    ) : null

  if (compact) {
    const subtitle = [agentName, session.description].filter(Boolean).join(' · ')
    return (
      <div className="hover:bg-muted flex flex-col items-start rounded-md px-2 py-1.5 transition-colors">
        <button type="button" className="flex w-full flex-col gap-0.5 text-left" onClick={onOpen}>
          <span className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            <SessionRowMeta
              activity={activity}
              status={session.status}
              updatedAt={session.updatedAt}
              className="text-xs"
            />
          </span>
          {subtitle ? <span className="text-muted-foreground w-full truncate text-xs">{subtitle}</span> : null}
        </button>
        {trigger}
        {children}
      </div>
    )
  }

  return (
    <div className="hover:bg-muted flex flex-col items-start rounded-lg px-3 py-2 transition-colors">
      <button type="button" className="flex w-full flex-col gap-0.5 text-left max-sm:min-h-10" onClick={onOpen}>
        <span className="flex w-full items-start gap-3">
          <SizableText weight="bold" className="min-w-0 flex-1 truncate">
            {title}
          </SizableText>
          <span className="flex max-w-[50%] flex-none flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {agentName ? (
              <span className="bg-muted text-muted-foreground inline-flex max-w-40 items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                <Bot className="size-3 flex-none" />
                <span className="truncate">{agentName}</span>
              </span>
            ) : null}
            {session.continuedFrom ? <ContinuedFromListChip link={session.continuedFrom} /> : null}
            <SessionRowMeta
              activity={activity}
              status={session.status}
              updatedAt={session.updatedAt}
              className="text-sm"
            />
          </span>
        </span>
        {session.description ? (
          <SizableText size="sm" color="muted" className="line-clamp-3 w-full">
            {session.description}
          </SizableText>
        ) : null}
      </button>
      {trigger}
      {children}
    </div>
  )
}
