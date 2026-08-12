import {type RunInfo, type RunJournalEntryInfo, type RunPlan, type RunStatus} from '@/agents-client'
import {ToolCallLine} from '@/components/assistant-message-rendering'
import {
  RunWorkHierarchy,
  PlanStepRow,
  descendantsOf,
  isTerminalRun,
  runTitle,
  useRunTreeView,
  type PlanSettle,
} from '@/pages/agents/run-work'
import {formatElapsed, formatTokenCount} from '@/components/agent-run-status'
import {useCancelRun, useRun, useSessionRuns, type AgentRunTreeLiveState} from '@/models/agents'
import {Button} from '@shm/ui/button'
import {ChevronDown, ChevronRight, Loader2, Workflow} from 'lucide-react'
import React, {useEffect, useMemo, useRef, useState} from 'react'

/** How a run's status reads in the header pill. */
const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  claimed: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  succeeded: 'Finished',
  failed: 'Failed',
  canceled: 'Canceled',
}

function runStatusClass(status: RunStatus): string {
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
  onOpenSession,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  sessionId: string
  /** `SessionInfo.plan`, rendered as a todo list when no run is live. */
  sessionPlan?: RunPlan
  /** Sidebar sizing: tighter rows, no footer. */
  compact?: boolean
  /** Opens the transcript of an agent child run. */
  onOpenSession?: (sessionId: string, agentId?: string) => void
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
  onOpenSession,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  runId: string
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
        plan={focus.plan}
        onOpenSession={onOpenSession}
        onCancelRun={(id) => cancelRun.mutate(id)}
        cancelPending={cancelRun.isPending}
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
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const isTerminal = isTerminalRun(run.status)
  const isParked = run.status === 'waiting'
  const progress = liveState.progress[run.id]
  const doneChildren = childRuns.filter((child) => isTerminalRun(child.status)).length
  const usageTotal = (run.usage?.total ?? 0) + (run.usage?.children?.total ?? 0)

  useEffect(() => {
    if (isTerminal) setConfirmingCancel(false)
  }, [isTerminal])

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {isTerminal ? null : <Loader2 className="text-muted-foreground size-3.5 flex-none animate-spin" />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {isParked && childRuns.length
            ? `Waiting on ${childRuns.length} sub-session${childRuns.length === 1 ? '' : 's'} — ${doneChildren} done`
            : runTitle(run)}
        </span>
        <span className={`flex-none rounded-full border px-1.5 py-0.5 text-[10px] ${runStatusClass(run.status)}`}>
          {RUN_STATUS_LABELS[run.status]}
        </span>
        <RunElapsed run={run} />
        {isTerminal ? null : confirmingCancel ? (
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

      {run.error ? <div className="text-destructive text-[11px] break-words">{run.error.message}</div> : null}

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

      <RunWorkHierarchy
        run={run}
        childRuns={childRuns}
        plan={plan}
        journal={liveState.journal}
        liveState={liveState}
        compact={compact}
        onOpenSession={onOpenSession}
        onCancelRun={onCancelRun}
        cancelPending={cancelPending}
        renderToolPart={(part) => (
          <ToolCallLine item={part} serverUrl={serverUrl} accountUid={accountUid} agentId={run.agentId} />
        )}
      />

      <RunSourceDrawer runs={[run, ...childRuns]} />

      <RunActivityDrawer journal={liveState.journal} />

      {!compact && usageTotal > 0 ? (
        <div className="text-muted-foreground border-border flex justify-end border-t pt-1 text-[10px]">
          {formatTokenCount(usageTotal)} tokens
        </div>
      ) : null}
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
function RunActivityDrawer({journal}: {journal: RunJournalEntryInfo[]}) {
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
function RunSourceDrawer({runs}: {runs: RunInfo[]}) {
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

/** The step list, fed by a run's plan or by the session's `update_plan` todo list. */
function RunPlanSteps({plan, compact, settle = 'live'}: {plan: RunPlan; compact?: boolean; settle?: PlanSettle}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {plan.title ? (
        <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{plan.title}</span>
      ) : null}
      {plan.steps.map((step) => (
        <PlanStepRow key={step.id} step={step} compact={compact} settle={settle} />
      ))}
    </div>
  )
}
