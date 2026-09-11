import type {AgentRowActivity} from './activity'
import {AgentActivityMark} from './activity-dot'
import type {SessionInfo} from './client'
import {ContinuedFromListChip} from './continuation'
import {SessionStatusDot, SubSessionsDisclosure} from './session-children'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {SizableText} from '@shm/ui/text'
import {Bot} from 'lucide-react'
import type React from 'react'

/**
 * One top-level session in a list: status, title, date, the agent's own description, and the
 * disclosure of any sub-sessions. `agentName` labels the row in lists that span several agents.
 * `compact` stacks the details under the title for a narrow column (the assistant sidebar).
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
  /** Something unread in the chat, or the agent working in it; outranks the plain status dot. */
  activity?: AgentRowActivity | null
  compact?: boolean
}) {
  const title = session.title || 'Untitled session'
  const date = formattedDateMedium(new Date(session.updatedAt))
  const mark = activity ? (
    <AgentActivityMark tone={activity.tone} label={activity.label} className={compact ? 'size-2' : undefined} />
  ) : (
    <SessionStatusDot status={session.status} className={compact ? 'size-2' : undefined} />
  )
  const trigger = session.startedByTrigger ? (
    <button
      type="button"
      className={`bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-bold ${
        compact ? 'mt-1 ml-4' : 'mt-2'
      }`}
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
    return (
      <div className="hover:bg-muted flex flex-col items-start rounded-md px-2 py-1.5 transition-colors">
        <button type="button" className="flex w-full flex-col gap-0.5 text-left" onClick={onOpen}>
          <span className="flex w-full items-center gap-2">
            <span className="flex w-2 flex-none items-center justify-center">{mark}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            {activity ? <span className="text-muted-foreground shrink-0 text-[10px]">{activity.short}</span> : null}
          </span>
          <span className="text-muted-foreground flex w-full min-w-0 items-center gap-1 pl-4 text-xs">
            {agentName ? (
              <>
                <span className="min-w-0 truncate">{agentName}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="whitespace-nowrap">{date}</span>
          </span>
          {session.description ? (
            <span className="text-muted-foreground line-clamp-2 w-full pl-4 text-xs">{session.description}</span>
          ) : null}
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
          <span className="flex h-5 flex-none items-center">{mark}</span>
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
            <SizableText size="sm" color="muted" className="whitespace-nowrap">
              {date}
            </SizableText>
          </span>
        </span>
        {session.description ? (
          <SizableText size="sm" color="muted" className="line-clamp-3 w-full pl-5">
            {session.description}
          </SizableText>
        ) : null}
      </button>
      {trigger}
      {children}
    </div>
  )
}
