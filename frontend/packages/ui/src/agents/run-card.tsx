import {type RunInfo, type RunJournalEntryInfo, type RunPlan, type RunStatus} from './client'
import {ToolCallLine} from './message-rendering'
import {ParkedRunActions} from './run-parked-actions'
import {
  RunWorkHierarchy,
  PlanStepRow,
  RunErrorChip,
  RunTimerProgress,
  descendantsOf,
  isTerminalRun,
  journalToolParts,
  runTitle,
  useRunTreeView,
  type PlanSettle,
} from './run-work'
import {formatElapsed, formatTokenCount} from './agent-run-status'
import {useCancelRun, useRun, useSessionRuns, type AgentRunTreeLiveState} from './models'
import {useNavigate} from './navigation'
import {Button} from '@shm/ui/button'
import {ArrowUpRight, ChevronDown, ChevronRight, Loader2} from 'lucide-react'
import React, {useEffect, useMemo, useRef, useState} from 'react'

/**
 * What a parked run is actually waiting for, in words — or nothing, when the card's own title says
 * enough.
 *
 * "Waiting" alone is the least useful thing a card can say about a run that may sit for hours: the
 * question a person has is always WHY, and whether it is on them. Each wait reason answers that —
 * a budget pause and an approval need a human, a sleep does not. A run parked on its children just
 * keeps its title: the child rows below already show what is running, and a "waiting on N" line
 * would be one more spinner saying the same thing.
 */
function parkedLabel(run: RunInfo): string | undefined {
  const wait = run.wait
  if (wait?.reason === 'budget-pause') return wait.label || 'Paused: out of time budget'
  if (wait?.reason === 'event') {
    const until = wait.wakeAt ? ` (until ${formatWakeTime(wait.wakeAt)})` : ''
    return `${wait.label || 'Waiting for something to happen'}${until}`
  }
  if (wait?.reason === 'timer' && wait.wakeAt) return `Sleeping until ${formatWakeTime(wait.wakeAt)}`
  return undefined
}

/**
 * The card's display name, preferring names the model authored over the user's raw message.
 *
 * A user turn's run is titled by whatever the user typed, which reads poorly as a heading
 * ("again, wait 3 minutes and run again"). The plan title names the work when the model published
 * one. A planless turn whose whole work is one delegated child takes that child's briefing title —
 * the model writes those too. Everything else (delegate runs, planned turns) already carries a
 * deliberate title of its own, and a plan's steps name the work without renaming the card.
 */
function cardTitle(run: RunInfo, plan: RunPlan | undefined, childRuns: RunInfo[]): string {
  if (plan?.title) return plan.title
  const isUserTurn = run.origin === 'user' && !run.parentRunId
  if (isUserTurn && !plan?.steps.length && childRuns.length === 1 && childRuns[0]!.title) {
    return childRuns[0]!.title
  }
  return runTitle(run)
}

/** A wake time as a person reads it: a clock time today, a date beyond that. */
function formatWakeTime(wakeAt: number): string {
  const date = new Date(wakeAt)
  const sameDay = new Date().toDateString() === date.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})
    : date.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
}

/** How a run's status reads in the header pill. */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  claimed: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  succeeded: 'Finished',
  failed: 'Failed',
  canceled: 'Canceled',
}

export function runStatusClass(status: RunStatus): string {
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (status === 'succeeded') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'canceled') return 'border-border bg-muted text-muted-foreground'
  return 'border-primary/30 bg-primary/10 text-primary'
}

/**
 * The live progress card pinned above the composer.
 *
 * Shows only while the session's newest run is still going: once it finishes, the record of it lives
 * in the transcript (see {@link RunRecordCard}) and the pinned slot clears so the next turn — or a
 * plain chat reply — is not shadowed by a stale summary. With no live run it falls back to the
 * session's `update_plan` todo list, the same step list fed from a different source.
 */
export function SessionRunCard({
  serverUrl,
  accountUid,
  sessionId,
  sessionPlan,
  compact,
  frozenRunIds,
  onOpenSession,
  readOnly = false,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  sessionId: string
  /** `SessionInfo.plan`, rendered as a todo list when no run is live. */
  sessionPlan?: RunPlan
  /** Sidebar sizing: tighter rows, no footer. */
  compact?: boolean
  /**
   * Runs whose card the transcript already holds. A run whose story settled mid-flight is told in
   * the scroll, at the moment it settled; pinning the same card here too would show one story twice,
   * and this copy would be the one that has stopped changing.
   */
  frozenRunIds?: ReadonlySet<string>
  /** Opens the transcript of an agent child run. */
  onOpenSession?: (sessionId: string, agentId?: string) => void
  /** Hides run controls for reader collaborators while preserving live progress. */
  readOnly?: boolean
}) {
  const runs = useSessionRuns(serverUrl, accountUid, sessionId)
  const cancelRun = useCancelRun(serverUrl, accountUid)
  const seedRoot = runs.data?.[0]
  // Gate on the query's view of the status: it lags by at most one poll, and gating on the merged
  // status instead would need the very socket this decides whether to open.
  const seedIsLive = !!seedRoot && !isTerminalRun(seedRoot.status)
  const {runsById, liveState} = useRunTreeView(
    serverUrl,
    accountUid,
    seedIsLive ? seedRoot.rootRunId : undefined,
    seedRoot,
    seedIsLive,
  )

  const root = seedRoot ? runsById[seedRoot.id] ?? seedRoot : undefined
  const children = useMemo(() => (root ? descendantsOf(runsById, root.id) : []), [runsById, root?.id])

  // A plain turn — one model streaming, maybe a few tool calls — is not an orchestration: it
  // renders in the scroll log like it always has. The pinned panel earns its place only when
  // there is a process to supervise: a workflow, spawned children, a parked wait, or a plan.
  const isOrchestration =
    !!root &&
    (root.kind === 'workflow' || children.length > 0 || root.status === 'waiting' || (root.plan?.steps.length ?? 0) > 0)

  // Frozen mid-flight: the transcript is already telling this run's story at the place it settled,
  // so the pinned slot clears early rather than holding a finished summary over the composer.
  if (root && !isTerminalRun(root.status) && frozenRunIds?.has(root.id)) return null

  if (root && isOrchestration && !isTerminalRun(root.status)) {
    return (
      <RunCardShell compact={compact} column>
        <RunCardBody
          serverUrl={serverUrl}
          accountUid={accountUid}
          run={root}
          childRuns={children}
          liveState={liveState}
          plan={root.plan ?? sessionPlan}
          compact={compact}
          onOpenSession={onOpenSession}
          onCancelRun={(runId) => cancelRun.mutate(runId)}
          cancelPending={cancelRun.isPending}
          readOnly={readOnly}
        />
      </RunCardShell>
    )
  }

  // Todo-list fallback. A plan with nothing left to do is just noise once its run is over.
  if (!sessionPlan?.steps.length) return null
  const settled = !!root
  if (settled && sessionPlan.steps.every((step) => step.status === 'done' || step.status === 'skipped')) {
    return null
  }
  return (
    <RunCardShell compact={compact}>
      <RunPlanSteps plan={sessionPlan} compact={compact} settle={settled ? 'idle' : 'live'} />
    </RunCardShell>
  )
}

/**
 * The durable record of one run, rendered inside its `sub_session` / `run_workflow` chat bubble.
 *
 * The pinned card is deliberately transient, so this is where a finished workflow keeps its step
 * list, children, and activity log — in the transcript, at the point in the conversation where it
 * happened. Mounted only while its bubble is expanded, which is what keeps its socket and queries
 * off until someone actually looks.
 */
export function RunRecordCard({
  serverUrl,
  accountUid,
  runId,
  plan,
  onOpenSession,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  runId: string
  /**
   * The checklist to render when the run has none of its own — a model-driven run keeps its plan on
   * the session, and the frozen card would otherwise show a story with its steps missing.
   */
  plan?: RunPlan
  onOpenSession?: (sessionId: string, agentId?: string) => void
}) {
  const run = useRun(serverUrl, accountUid, runId)
  const cancelRun = useCancelRun(serverUrl, accountUid)
  const seed = run.data ?? undefined
  const {runsById, liveState} = useRunTreeView(serverUrl, accountUid, seed?.rootRunId, seed, true)
  const focus = seed ? runsById[seed.id] ?? seed : undefined
  const children = useMemo(() => (focus ? descendantsOf(runsById, focus.id) : []), [runsById, focus?.id])

  if (!focus) {
    return run.isLoading ? <div className="text-muted-foreground py-1 text-[11px]">Loading run…</div> : null
  }

  return (
    // Same shell as the pinned card: this IS that card, frozen where the run finished.
    <div className="border-border bg-card mr-6 flex flex-col gap-2 rounded-lg border p-2.5">
      <RunCardBody
        serverUrl={serverUrl}
        accountUid={accountUid}
        run={focus}
        childRuns={children}
        liveState={liveState}
        plan={focus.plan ?? plan}
        onOpenSession={onOpenSession}
        onCancelRun={(id) => cancelRun.mutate(id)}
        cancelPending={cancelRun.isPending}
        transcript
      />
    </div>
  )
}

/**
 * Everything a run has to say about itself: status, progress, steps, children, log, cost.
 *
 * Shared by the pinned card and the transcript record so a run looks the same wherever it is read.
 */
function RunCardBody({
  serverUrl,
  accountUid,
  run,
  childRuns,
  liveState,
  plan,
  compact,
  onOpenSession,
  onCancelRun,
  cancelPending,
  readOnly = false,
  transcript = false,
}: {
  /** Agent server this run lives on, so its tool rows can link into the agent's own pages. */
  serverUrl: string
  accountUid: string | null | undefined
  run: RunInfo
  childRuns: RunInfo[]
  liveState: AgentRunTreeLiveState
  plan?: RunPlan
  compact?: boolean
  onOpenSession?: (sessionId: string, agentId?: string) => void
  onCancelRun: (runId: string) => void
  cancelPending: boolean
  readOnly?: boolean
  /** Completed transcript record: checklist first, implementation details collapsed. */
  transcript?: boolean
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const isTerminal = isTerminalRun(run.status)
  const isParked = run.status === 'waiting'
  const progress = liveState.progress[run.id]
  const usageTotal = (run.usage?.total ?? 0) + (run.usage?.children?.total ?? 0)
  const planIsComplete =
    !!plan?.steps.length &&
    plan.steps.every((step) => step.status === 'done' || step.status === 'failed' || step.status === 'skipped')
  const isCompletedTranscript =
    transcript &&
    (run.status === 'succeeded' ||
      (planIsComplete && run.status !== 'failed' && run.status !== 'canceled' && !isParked))
  const showRunControls = !isTerminal && !isCompletedTranscript && !readOnly
  const issueCount = childRuns.filter((child) => child.status === 'failed' || child.status === 'canceled').length
  // The journaled call this run's own terminal error points at, for its error inspector.
  const rootErrorToolPart = useMemo(() => {
    const callSeq = run.error?.callSeq
    if (typeof callSeq !== 'number') return undefined
    return journalToolParts(liveState.journal.filter((entry) => entry.runId === run.id)).find(
      (part) => part.id === `wf-${run.id}:${callSeq}`,
    )
  }, [liveState.journal, run.id, run.error?.callSeq])

  useEffect(() => {
    if (isTerminal) setConfirmingCancel(false)
  }, [isTerminal])

  const headerTitle = (isParked ? parkedLabel(run) : undefined) ?? cardTitle(run, plan, childRuns)
  const navigate = useNavigate()

  return (
    <>
      <div className="group/runhead flex min-w-0 items-center gap-2">
        {showRunControls ? <Loader2 className="text-muted-foreground size-3.5 flex-none animate-spin" /> : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={headerTitle}>
          {headerTitle}
        </span>
        {/* Everything technical lives on the run's own page; the card offers only the way there,
            in the same hover bubble every tool row uses for its quiet affordances. */}
        <span className="flex flex-none items-center gap-1.5">
          {isCompletedTranscript && issueCount ? (
            <span className="text-[10px] text-amber-700 dark:text-amber-300">
              {issueCount} recovered issue{issueCount === 1 ? '' : 's'}
            </span>
          ) : null}
          <button
            type="button"
            title="Open run page"
            aria-label="Open run page"
            onClick={() => navigate({key: 'agent-run', runId: run.id, serverUrl, agentId: run.agentId})}
            className="hover:bg-background/70 text-muted-foreground hover:text-foreground bg-background/60 rounded-full border p-0.75 opacity-0 transition-opacity group-hover/runhead:opacity-100 focus-visible:opacity-100"
          >
            <ArrowUpRight className="size-3" />
          </button>
        </span>
        {!showRunControls ? null : confirmingCancel ? (
          <span className="flex flex-none items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={cancelPending}
              onClick={() => {
                onCancelRun(run.id)
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
          <Button size="sm" variant="ghost" className="flex-none" onClick={() => setConfirmingCancel(true)}>
            Cancel
          </Button>
        )}
      </div>

      {run.error ? (
        <div className="flex min-w-0 items-center">
          <RunErrorChip
            run={run}
            error={run.error}
            errorToolPart={rootErrorToolPart}
            renderToolPart={(part) => (
              <ToolCallLine item={part} serverUrl={serverUrl} accountUid={accountUid} agentId={run.agentId} />
            )}
          />
        </div>
      ) : null}

      {/* The run has stopped and is asking; the answer belongs where the question is. */}
      {!readOnly ? <ParkedRunActions run={run} serverUrl={serverUrl} accountUid={accountUid} /> : null}

      <RunTimerProgress run={run} journal={liveState.journal} wide />

      {progress && !isTerminal ? (
        <div className="flex flex-col gap-1">
          {progress.label ? <span className="text-muted-foreground text-[11px]">{progress.label}</span> : null}
          {progress.fraction !== undefined ? (
            <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-300"
                style={{width: `${Math.min(100, Math.max(0, progress.fraction * 100))}%`}}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Live: the work itself stays inline — that is the card's purpose. Finished record: the
          checklist alone tells the story. Everything technical (hierarchy, code, activity) lives
          on the run page, behind the open-run bubble. */}
      {isCompletedTranscript ? (
        plan?.steps.length ? (
          <RunPlanSteps plan={plan} compact={compact} settle="run-finished" />
        ) : null
      ) : (
        <RunWorkHierarchy
          run={run}
          childRuns={childRuns}
          plan={plan}
          journal={liveState.journal}
          liveState={liveState}
          compact={compact}
          onOpenSession={onOpenSession}
          onCancelRun={readOnly ? undefined : onCancelRun}
          cancelPending={cancelPending}
          renderToolPart={(part) => (
            <ToolCallLine item={part} serverUrl={serverUrl} accountUid={accountUid} agentId={run.agentId} />
          )}
        />
      )}

      {/* Status and elapsed time anchor the card's bottom-left; cost keeps the opposite corner. */}
      <div className="border-border flex items-center gap-2 border-t pt-1">
        <span
          className={`flex-none rounded-full border px-1.5 py-0.5 text-[10px] ${runStatusClass(
            isCompletedTranscript && !isTerminal ? 'succeeded' : run.status,
          )}`}
        >
          {/* A budget pause is the one wait a person has to end, so it does not hide behind "Waiting". */}
          {isCompletedTranscript && !isTerminal
            ? 'Plan complete'
            : run.wait?.reason === 'budget-pause'
              ? 'Paused'
              : RUN_STATUS_LABELS[run.status]}
        </span>
        <RunElapsed run={run} />
        {!compact && usageTotal > 0 ? (
          <span className="text-muted-foreground ml-auto text-[10px]">{formatTokenCount(usageTotal)} tokens</span>
        ) : null}
      </div>
    </>
  )
}

/** How many journal lines the drawer keeps on screen; older ones scroll out of existence. */
const MAX_ACTIVITY_LINES = 100

/** One rendered journal line: what happened, how loudly to say it, and the full entry behind it. */
type ActivityLine = {key: string; text: string; tone?: 'error' | 'warn'; entry: RunJournalEntryInfo}

/**
 * Renders the journal entries a workflow writes as it runs. Kinds not listed here (`timer`, `fired`,
 * `now`, `plan`, and successful `result`s) are replay bookkeeping, not activity, and would drown the
 * log.
 */
function journalEntryLine(entry: RunJournalEntryInfo): ActivityLine | null {
  const payload = entry.entry as {
    kind?: string
    level?: string
    message?: string
    label?: string
    phase?: string
    ok?: boolean
    op?: string
    tool?: string
    status?: string
    error?: {code?: string; message?: string}
  }
  const key = `${entry.runId}:${entry.seq}`
  if (payload.kind === 'log') {
    return {
      key,
      text: `${payload.level || 'info'} · ${payload.message ?? ''}`,
      tone: payload.level === 'error' ? 'error' : payload.level === 'warn' ? 'warn' : undefined,
      entry,
    }
  }
  if (payload.kind === 'step') {
    const phase = payload.phase === 'start' ? 'start' : payload.ok === false ? 'failed' : 'done'
    return {
      key,
      text: `step: ${payload.label ?? payload.phase ?? ''} (${phase})`,
      tone: phase === 'failed' ? 'error' : undefined,
      entry,
    }
  }
  if (payload.kind === 'call') {
    if (payload.op === 'agent') return {key, text: 'agent: sub-session', entry}
    return {key, text: `tool: ${payload.tool ?? 'unknown'}`, entry}
  }
  // Successful results are replay bookkeeping, but a failed result is the one place the error
  // message lives — surface it where someone reading the log is looking for it.
  if (payload.kind === 'result' && payload.status === 'failed') {
    return {
      key,
      text: `failed: ${payload.error?.message ?? payload.error?.code ?? 'action failed'}`,
      tone: 'error',
      entry,
    }
  }
  return null
}

/**
 * Collapsible log of what the run has actually been doing.
 *
 * Collapsed by default: a fan-out of a dozen children writes hundreds of lines, and the card's job
 * above this is to stay glanceable. Entries span every run in the tree, oldest first, so the newest
 * line sits at the bottom where the drawer is already scrolled.
 */
export function RunActivityDrawer({journal}: {journal: RunJournalEntryInfo[]}) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lines = useMemo(() => {
    const ordered = [...journal].sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq)
    return ordered
      .map(journalEntryLine)
      .filter((line): line is ActivityLine => line !== null)
      .slice(-MAX_ACTIVITY_LINES)
  }, [journal])

  // Follow the tail, the way a terminal does.
  useEffect(() => {
    if (!open || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [open, lines.length])

  if (!lines.length) return null

  return (
    <div className="border-border flex flex-col border-t pt-1">
      <button
        type="button"
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-[11px]"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
        Activity
        <span className="opacity-70">{lines.length}</span>
      </button>
      {open ? (
        <div
          ref={scrollRef}
          aria-label="Run activity"
          className="bg-muted/40 mt-1 max-h-40 overflow-y-auto rounded p-1.5 font-mono text-[10px] leading-4"
        >
          {lines.map((line) => (
            <ActivityLineRow key={line.key} line={line} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One journal line; clicking it unfolds the entry's full payload. What the log line compresses —
 * call inputs, result values, error details — is one click away instead of gone.
 */
function ActivityLineRow({line}: {line: ActivityLine}) {
  const [open, setOpen] = useState(false)
  const toneClass =
    line.tone === 'error' ? 'text-destructive' : line.tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        title={open ? 'Hide full entry' : 'Show full entry'}
        className={`hover:bg-muted block w-full truncate rounded px-0.5 text-left ${toneClass}`}
        onClick={() => setOpen((current) => !current)}
      >
        {line.text}
      </button>
      {open ? (
        <pre className="bg-background/80 my-0.5 max-h-40 overflow-auto rounded border p-1.5 whitespace-pre-wrap">
          {JSON.stringify(line.entry.entry, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

/**
 * The code a workflow actually runs, verbatim.
 *
 * Agents write these modules; reviewing the run means reading them. Collapsed by default beside the
 * Activity drawer; one section per workflow run in the tree (there is usually exactly one).
 */
export function RunSourceDrawer({runs}: {runs: RunInfo[]}) {
  const [open, setOpen] = useState(false)
  const sources = runs.filter((run) => run.kind === 'workflow' && run.sourceText)
  if (!sources.length) return null
  return (
    <div className="border-border flex flex-col border-t pt-1">
      <button
        type="button"
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-[11px]"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
        Code
      </button>
      {open
        ? sources.map((run) => (
            <div key={run.id} className="mt-1 flex flex-col gap-0.5">
              {sources.length > 1 ? <span className="text-muted-foreground text-[10px]">{runTitle(run)}</span> : null}
              <pre
                aria-label={`Workflow source: ${runTitle(run)}`}
                className="bg-muted/40 max-h-64 overflow-auto rounded p-1.5 font-mono text-[10px] leading-4 whitespace-pre"
              >
                {run.sourceText}
              </pre>
            </div>
          ))
        : null}
    </div>
  )
}

/** The pinned frame: full composer width, never scrolls away with the transcript. */
function RunCardShell({children, compact, column}: {children: React.ReactNode; compact?: boolean; column?: boolean}) {
  return (
    <div
      className={`border-border bg-card flex flex-none gap-2 rounded-lg border ${
        compact ? 'mx-2 mb-1 p-2' : 'mb-2 p-2.5'
      } ${column ? 'flex-col' : 'items-center'}`}
    >
      {children}
    </div>
  )
}

/** Live elapsed timer for a run, frozen once it finishes. */
function RunElapsed({run}: {run: RunInfo}) {
  const [now, setNow] = useState(() => Date.now())
  const isTerminal = isTerminalRun(run.status)
  useEffect(() => {
    if (isTerminal) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isTerminal, run.id])
  const startedAt = run.startedAt ?? run.createdAt
  const endedAt = isTerminal ? run.finishedAt ?? run.updatedAt : now
  return (
    <span className="text-muted-foreground flex-none text-[10px] tabular-nums" aria-label="Elapsed time">
      {formatElapsed(Math.max(0, endedAt - startedAt))}
    </span>
  )
}

/**
 * The step list, fed by a run's plan or by the session's `update_plan` todo list. Steps only — the
 * plan's title is the card header's job, and repeating it here (the old all-caps line) showed the
 * same words twice in one card.
 */
function RunPlanSteps({plan, compact, settle = 'live'}: {plan: RunPlan; compact?: boolean; settle?: PlanSettle}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {plan.steps.map((step) => (
        <PlanStepRow key={step.id} step={step} compact={compact} settle={settle} />
      ))}
    </div>
  )
}
