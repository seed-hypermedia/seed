import {useSelectedAccountId} from './account'
import {formatTokenCount} from './agent-run-status'
import {type ChatToolPart} from './chat-parts'
import {describeAgentError} from './errors'
import {AgentBreadcrumb} from './header'
import {ToolCallLine} from './message-rendering'
import {getDefaultAgentServerUrl, useAgentDetail, useAgentServerUrl, useCancelRun, useRun} from './models'
import {useNavigate} from './navigation'
import {AgentsNoAccountPage} from './no-account'
import {RUN_STATUS_LABELS, RunActivityDrawer, RunSourceDrawer, runStatusClass} from './run-card'
import {ParkedRunActions} from './run-parked-actions'
import {
  descendantsOf,
  isTerminalRun,
  journalToolParts,
  RunErrorChip,
  runTitle,
  RunWorkHierarchy,
  useRunTreeView,
} from './run-work'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {Notice} from '@shm/ui/notice'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {MessageSquare} from 'lucide-react'
import {useMemo, useState} from 'react'
import type {RunInfo} from './client'

/** How a run's origin reads in the page's one meta line. */
const ORIGIN_LABELS: Record<RunInfo['origin'], string> = {
  user: 'started by you',
  trigger: 'fired by a trigger',
  agent: 'started by an agent',
  workflow: 'started by a script',
  system: 'started by the system',
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * The durable record of one run, as a page.
 *
 * The same record the transcript's run card shows, given room and an address: firings, delegate
 * rows, and copied links all land here. Deliberately spare — one title line, one meta line, the
 * work itself, and the code/activity drawers. A run is a record, not a conversation: nothing here
 * is editable, and the only actions are the ones the run itself still offers (cancel, parked
 * questions, its transcript when it has one).
 */
function AgentRunPage({
  runId,
  routeServerUrl,
  routeAgentId,
  selectedAccountId,
}: {
  runId: string
  routeServerUrl?: string
  routeAgentId?: string
  selectedAccountId: string
}) {
  const navigate = useNavigate()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const run = useRun(serverUrl, selectedAccountId, runId)
  const seed = run.data ?? undefined
  const {runsById, liveState} = useRunTreeView(serverUrl, selectedAccountId, seed?.rootRunId, seed, true)
  const focus = seed ? runsById[seed.id] ?? seed : undefined
  const children = useMemo(() => (focus ? descendantsOf(runsById, focus.id) : []), [runsById, focus?.id])
  const agentId = routeAgentId || focus?.agentId
  // Names the breadcrumb; a run of an agent the viewer cannot read still renders without it.
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  const cancelRun = useCancelRun(serverUrl, selectedAccountId)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  // The journaled call the run's terminal error points at, for the error chip's inspector.
  const errorToolPart = useMemo(() => {
    const callSeq = focus?.error?.callSeq
    if (!focus || typeof callSeq !== 'number') return undefined
    return journalToolParts(liveState.journal.filter((entry) => entry.runId === focus.id)).find(
      (part) => part.id === `wf-${focus.id}:${callSeq}`,
    )
  }, [liveState.journal, focus?.id, focus?.error?.callSeq])

  const renderToolPart = (part: ChatToolPart) => (
    <ToolCallLine item={part} serverUrl={serverUrl} accountUid={selectedAccountId} agentId={focus?.agentId} />
  )

  const meta = focus
    ? [
        focus.kind === 'workflow' ? 'Script' : 'Agent run',
        ORIGIN_LABELS[focus.origin],
        formattedDateMedium(new Date(focus.createdAt)),
        focus.startedAt && focus.finishedAt ? `ran ${formatDuration(focus.finishedAt - focus.startedAt)}` : null,
        (() => {
          const total = (focus.usage?.total ?? 0) + (focus.usage?.children?.total ?? 0)
          return total ? `${formatTokenCount(total)} tokens` : null
        })(),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <PanelContainer className="overflow-y-auto">
      <Container className="max-w-4xl gap-4 pt-4 pb-8">
        <AgentBreadcrumb
          serverUrl={serverUrl}
          agentId={agentId}
          agentName={agent.data?.agent.definition.name}
          items={[{label: focus ? runTitle(focus) : 'Run'}]}
        />
        {run.isLoading && !focus ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Spinner size="large" className="text-muted-foreground" />
          </div>
        ) : null}
        {run.isError ? (
          <RunLoadNotice error={run.error} onRetry={() => void run.refetch()} retryPending={run.isFetching} />
        ) : null}
        {!run.isLoading && !run.isError && !focus ? (
          <Notice tone="warning" title="Run not found">
            This run may have been removed, or it lives on a different server.
          </Notice>
        ) : null}
        {focus ? (
          <>
            <header className="flex flex-col gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${runStatusClass(
                    focus.status,
                  )}`}
                >
                  {RUN_STATUS_LABELS[focus.status]}
                </span>
                <SizableText size="xl" weight="bold" className="min-w-0 flex-1 truncate" title={runTitle(focus)}>
                  {runTitle(focus)}
                </SizableText>
                {focus.sessionId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate({key: 'agent-session', sessionId: focus.sessionId!, agentId: focus.agentId, serverUrl})
                    }
                  >
                    <MessageSquare className="size-4" />
                    Open transcript
                  </Button>
                ) : null}
                {isTerminalRun(focus.status) ? null : confirmingCancel ? (
                  <span className="flex flex-none items-center gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={cancelRun.isPending}
                      onClick={() => {
                        cancelRun.mutate(focus.id)
                        setConfirmingCancel(false)
                      }}
                    >
                      Cancel run
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingCancel(false)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingCancel(true)}>
                    Cancel
                  </Button>
                )}
              </div>
              <SizableText size="xs" color="muted">
                {meta}
              </SizableText>
            </header>

            {focus.error ? (
              <div className="flex min-w-0 items-center">
                <RunErrorChip
                  run={focus}
                  error={focus.error}
                  errorToolPart={errorToolPart}
                  renderToolPart={renderToolPart}
                />
              </div>
            ) : null}

            <ParkedRunActions run={focus} serverUrl={serverUrl} accountUid={selectedAccountId} />

            <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
              <RunWorkHierarchy
                run={focus}
                childRuns={children}
                plan={focus.plan}
                journal={liveState.journal}
                liveState={liveState}
                onOpenSession={(sessionId, openAgentId) =>
                  navigate({key: 'agent-session', sessionId, agentId: openAgentId, serverUrl})
                }
                onCancelRun={(id) => cancelRun.mutate(id)}
                cancelPending={cancelRun.isPending}
                renderToolPart={renderToolPart}
              />
            </section>

            <RunSourceDrawer runs={[focus, ...children]} />
            <RunActivityDrawer journal={liveState.journal} />
          </>
        ) : null}
      </Container>
    </PanelContainer>
  )
}

function RunLoadNotice({error, onRetry, retryPending}: {error: unknown; onRetry: () => void; retryPending: boolean}) {
  const notice = describeAgentError(error, {failed: 'Couldn’t load this run'})
  return (
    <Notice tone={notice.tone} title={notice.title} onRetry={onRetry} retryPending={retryPending}>
      {notice.detail}
    </Notice>
  )
}

export default function AgentRunRoutePage() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  if (route.key !== 'agent-run') return null
  // Agent servers reject unauthenticated requests; without an account there is nothing to load.
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return (
    <AgentRunPage
      runId={route.runId}
      routeServerUrl={route.serverUrl}
      routeAgentId={route.agentId}
      selectedAccountId={selectedAccountId}
    />
  )
}
