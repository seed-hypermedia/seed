import type {describeAgentError} from './errors'
import type {AgentSessionListEntry} from './models'
import {useClickNavigate, useNavigate} from './navigation'
import {SessionListItem} from './session-list-item'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {useLoadMoreSentinel} from '@shm/ui/use-load-more-sentinel'

/** A server whose sessions failed to load, named so the rest of the list still reads as whole. */
export type AgentSessionsFeedProblem = {
  serverUrl: string
  notice: ReturnType<typeof describeAgentError>
  refetch: () => void
  isFetching: boolean
}

/**
 * The account's sessions, newest activity first, as the Agents home page and a server's page list
 * them: one notice per server that failed, the rows (with the agent each belongs to), and the next
 * page loaded well before the reader scrolls to the end.
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
}) {
  const navigate = useNavigate()
  const clickNavigate = useClickNavigate()
  const loadMoreSentinel = useLoadMoreSentinel({
    enabled: hasNextPage && !isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  return (
    <section className="flex flex-col gap-3">
      {isLoading ? <SizableText color="muted">Loading sessions…</SizableText> : null}
      {problems.map((problem) => (
        <Notice
          key={problem.serverUrl}
          tone={problem.notice.tone}
          title={problem.notice.title}
          onRetry={problem.refetch}
          retryPending={problem.isFetching}
        >
          {problem.notice.detail}
        </Notice>
      ))}
      {!isLoading && !sessions.length && !problems.length ? <SizableText color="muted">{emptyText}</SizableText> : null}
      <div className="flex flex-col gap-1">
        {sessions.map(({serverUrl, session, agent}) => (
          <SessionListItem
            key={`${serverUrl}:${session.id}`}
            session={session}
            serverUrl={serverUrl}
            accountUid={accountUid}
            agentName={agent?.definition.name || session.agentId}
            onOpen={(event) =>
              clickNavigate({key: 'agent-session', agentId: session.agentId, sessionId: session.id, serverUrl}, event)
            }
            onOpenSession={(child, event) =>
              clickNavigate({key: 'agent-session', agentId: child.agentId, sessionId: child.id, serverUrl}, event)
            }
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
