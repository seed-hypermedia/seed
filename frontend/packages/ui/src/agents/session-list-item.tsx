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
 */
export function SessionListItem({
  session,
  serverUrl,
  accountUid,
  onOpen,
  onOpenSession,
  onOpenTrigger,
  agentName,
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
}) {
  return (
    <div className="hover:bg-muted flex flex-col items-start rounded-lg px-3 py-2 transition-colors">
      <button type="button" className="flex w-full flex-col gap-0.5 text-left max-sm:min-h-10" onClick={onOpen}>
        <span className="flex w-full items-start gap-3">
          <span className="flex h-5 flex-none items-center">
            <SessionStatusDot status={session.status} />
          </span>
          <SizableText weight="bold" className="min-w-0 flex-1 truncate">
            {session.title || 'Untitled session'}
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
              {formattedDateMedium(new Date(session.updatedAt))}
            </SizableText>
          </span>
        </span>
        {session.description ? (
          <SizableText size="sm" color="muted" className="line-clamp-3 w-full pl-5">
            {session.description}
          </SizableText>
        ) : null}
      </button>
      {session.startedByTrigger ? (
        <button
          type="button"
          className="bg-primary/10 text-primary mt-2 rounded-full px-2 py-0.5 text-xs font-bold"
          onClick={(event) => {
            event.stopPropagation()
            onOpenTrigger?.()
          }}
        >
          Triggered by {session.startedByTrigger.triggerName}
        </button>
      ) : null}
      {session.childSessionCount && onOpenSession ? (
        <div className="mt-1 w-full pl-5">
          <SubSessionsDisclosure
            serverUrl={serverUrl}
            accountUid={accountUid}
            parentSessionId={session.id}
            childSessionCount={session.childSessionCount}
            onOpenSession={onOpenSession}
          />
        </div>
      ) : null}
    </div>
  )
}
