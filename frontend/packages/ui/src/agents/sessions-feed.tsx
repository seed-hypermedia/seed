import {sessionRowActivity, type AgentActivityReadState} from './activity'
import type {describeAgentError} from './errors'
import type {AgentSessionListEntry} from './models'
import {useClickNavigate, useNavigate} from './navigation'
import {SessionListItem} from './session-list-item'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {useLoadMoreSentinel} from '@shm/ui/use-load-more-sentinel'
import type React from 'react'

/** A server whose sessions failed to load, named so the rest of the list still reads as whole. */
export type AgentSessionsFeedProblem = {
  serverUrl: string
  notice: ReturnType<typeof describeAgentError>
  refetch: () => void
  isFetching: boolean
}

/** The session a row (or one of its sub-sessions) opens. */
export type AgentSessionsFeedTarget = {serverUrl: string; agentId: string; sessionId: string}

/**
 * The account's sessions, newest activity first, as the Agents home page, a server's page, and the
 * assistant sidebar list them: one notice per server that failed, the rows (with the agent each
 * belongs to), and the next page loaded well before the reader scrolls to the end.
 */
export function AgentSessionsFeed({
  sessions,
  accountUid,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  problems,
  emptyText,
  compact = false,
  showAgentName = true,
  readState,
  onOpenSession,
}: {
  sessions: AgentSessionListEntry[]
  accountUid: string | null | undefined
  isLoading: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  problems: AgentSessionsFeedProblem[]
  /** Shown once loading settles with no sessions and no failures. */
  emptyText: string
  /** Narrow-column rows (the assistant sidebar). */
  compact?: boolean
  /** Label each row with its agent; off when the list is one agent's already. */
  showAgentName?: boolean
  /** This device's read marks: when given, rows point at unread chats and ones an agent is working in. */
  readState?: AgentActivityReadState
  /** Opens a session somewhere other than the main window's session page (the sidebar opens it in place). */
  onOpenSession?: (target: AgentSessionsFeedTarget, event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const navigate = useNavigate()
  const clickNavigate = useClickNavigate()
  const loadMoreSentinel = useLoadMoreSentinel({
    enabled: hasNextPage && !isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })
  const open = (target: AgentSessionsFeedTarget, event: React.MouseEvent<HTMLButtonElement>) =>
    onOpenSession ? onOpenSession(target, event) : clickNavigate({key: 'agent-session', ...target}, event)

  return (
    <section className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      {isLoading ? (
        <SizableText size={compact ? 'sm' : undefined} color="muted" className={compact ? 'px-2 py-1' : undefined}>
          Loading sessions…
        </SizableText>
      ) : null}
      {problems.map((problem) => (
        <Notice
          key={problem.serverUrl}
          size={compact ? 'sm' : undefined}
          tone={problem.notice.tone}
          title={problem.notice.title}
          onRetry={problem.refetch}
          retryPending={problem.isFetching}
        >
          {problem.notice.detail}
        </Notice>
      ))}
      {!isLoading && !sessions.length && !problems.length ? (
        <SizableText size={compact ? 'sm' : undefined} color="muted" className={compact ? 'px-2 py-1' : undefined}>
          {emptyText}
        </SizableText>
      ) : null}
      <div className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1'}`}>
        {sessions.map(({serverUrl, session, agent}) => (
          <SessionListItem
            key={`${serverUrl}:${session.id}`}
            session={session}
            serverUrl={serverUrl}
            accountUid={accountUid}
            compact={compact}
            agentName={showAgentName ? agent?.definition.name || session.agentId : undefined}
            activity={readState ? sessionRowActivity(session, serverUrl, readState, agent?.activity) : undefined}
            onOpen={(event) => open({serverUrl, agentId: session.agentId, sessionId: session.id}, event)}
            onOpenSession={(child, event) => open({serverUrl, agentId: child.agentId, sessionId: child.id}, event)}
            onOpenTrigger={() =>
              session.startedByTrigger
                ? navigate({
                    key: 'agent',
                    agentId: session.agentId,
                    serverUrl,
                    tab: 'triggers',
                    triggerId: session.startedByTrigger.triggerId,
                  })
                : undefined
            }
          />
        ))}
      </div>
      {/* Scrolling near the end loads the next page; this row is only ever seen if the fetch is slow. */}
      <div ref={loadMoreSentinel} aria-hidden="true" className="h-px" />
      {isFetchingNextPage ? (
        <SizableText size="sm" color="muted" className="text-center">
          Loading more…
        </SizableText>
      ) : null}
    </section>
  )
}
