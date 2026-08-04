import {type RunInfo, type RunJournalEntryInfo, type RunPlan, type RunStatus} from '@/agents-client'
import {formatElapsed, formatTokenCount} from '@/components/agent-run-status'
import {SessionStatusDot} from '@/components/session-children'
import {
  useAgentRunTreeSubscription,
  useCancelRun,
  useRun,
  useRunTree,
  useSessionRuns,
  type AgentRunTreeLiveState,
} from '@/models/agents'
import {Button} from '@shm/ui/button'
import {Bot, Check, ChevronDown, ChevronRight, CircleDashed, Loader2, Minus, Workflow, X} from 'lucide-react'
import React, {useEffect, useMemo, useRef, useState} from 'react'

/** Statuses a run can no longer leave. */
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled'])

const isTerminalRun = (status: RunStatus) => TERMINAL_RUN_STATUSES.has(status)

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

/** Session status a run maps onto, so child rows reuse the one status dot the lists use. */
function runStatusAsSessionStatus(status: RunStatus): 'idle' | 'streaming' | 'error' {
  if (status === 'failed' || status === 'canceled') return 'error'
  if (isTerminalRun(status)) return 'idle'
  return 'streaming'
}

/** A run's own title, or what it is when it never got one. */
function runTitle(run: RunInfo): string {
  if (run.title) return run.title
  if (run.kind === 'workflow') return 'Workflow'
  // Only child runs are sub-sessions; an untitled root is just this session's own turn.
  return run.parentRunId ? 'Sub-session' : 'Agent turn'
}

/**
 * The run tree behind a card: durable rows from `ListRuns`, overlaid by the socket's replay.
 *
 * `live: false` opens no socket and skips the tree query — used by transcript cards that are
 * collapsed, so a long chat full of finished workflows costs nothing until one is opened.
 */
function useRunTreeView(
  serverUrl: string,
  accountUid: string | null | undefined,
  rootRunId: string | undefined,
  seed: RunInfo | undefined,
  live: boolean,
): {runsById: Record<string, RunInfo>; liveState: AgentRunTreeLiveState} {
  const tree = useRunTree(serverUrl, accountUid, live ? rootRunId : undefined)
  const liveState = useAgentRunTreeSubscription(serverUrl, accountUid, live ? rootRunId : undefined)

  const runsById = useMemo(() => {
    const merged: Record<string, RunInfo> = {}
    for (const run of tree.data || []) merged[run.id] = run
    if (seed && !merged[seed.id]) merged[seed.id] = seed
    // The socket's replay is at least as fresh as the query, so it wins.
    for (const run of Object.values(liveState.runs)) merged[run.id] = run
    return merged
  }, [tree.data, liveState.runs, seed])

  return {runsById, liveState}
}

/**
 * Every run spawned under `focusRunId`, at any depth, oldest first.
 *
 * A subscription is keyed by the tree's root, so a card focused on one run inside that tree (a
 * workflow bubble, say) receives its siblings too and has to narrow to its own branch.
 */
function descendantsOf(runsById: Record<string, RunInfo>, focusRunId: string): RunInfo[] {
  const isDescendant = (run: RunInfo): boolean => {
    let current: RunInfo | undefined = run
    // Bounded walk: a cycle would otherwise hang the render.
    for (let depth = 0; depth < 32 && current; depth += 1) {
      const parentId: string | undefined = current.parentRunId
      if (!parentId) return false
      if (parentId === focusRunId) return true
      current = runsById[parentId]
    }
    return false
  }
  return Object.values(runsById)
    .filter((run) => run.id !== focusRunId && isDescendant(run))
    .sort((a, b) => a.createdAt - b.createdAt)
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
    <div className="border-border bg-background/40 flex flex-col gap-2 rounded-md border p-2">
      <RunCardBody
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
  run,
  childRuns,
  liveState,
  plan,
  compact,
  onOpenSession,
  onCancelRun,
  cancelPending,
}: {
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

  // A step and the sub-agent working it are one item, not two. A child attaches to a step when the
  // spawner recorded the step label (`stepLabel`, stamped by ctx.step / the running update_plan
  // step), or — legacy runs — when its title happens to equal a step label. Attached children render
  // in the step's position, replacing the step row: the child row is clickable, cancelable, and
  // live, which is everything the step row would have said and more.
  const {childrenByStep, unattachedChildren} = useMemo(() => {
    const byStep = new Map<string, RunInfo[]>()
    if (!plan?.steps.length) return {childrenByStep: byStep, unattachedChildren: childRuns}
    const stepLabels = new Set(plan.steps.map((step) => step.label.trim().toLowerCase()))
    const loose: RunInfo[] = []
    for (const child of childRuns) {
      const stamped = (child.stepLabel || '').trim().toLowerCase()
      const titled = (child.title || '').trim().toLowerCase()
      const label = stamped && stepLabels.has(stamped) ? stamped : titled && stepLabels.has(titled) ? titled : undefined
      if (!label) {
        loose.push(child)
        continue
      }
      byStep.set(label, [...(byStep.get(label) ?? []), child])
    }
    return {childrenByStep: byStep, unattachedChildren: loose}
  }, [plan, childRuns])

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

      {plan?.steps.length ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {plan.title ? (
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{plan.title}</span>
          ) : null}
          {plan.steps.map((step) => {
            const attached = childrenByStep.get(step.label.trim().toLowerCase())
            if (attached?.length) {
              return attached.map((child) => (
                <RunChildRow
                  key={child.id}
                  run={child}
                  ownerTerminal={isTerminal}
                  activityDetail={liveState.activity[child.id]?.detail}
                  onOpen={
                    child.sessionId && onOpenSession ? () => onOpenSession(child.sessionId!, child.agentId) : undefined
                  }
                  onCancel={() => onCancelRun(child.id)}
                  cancelPending={cancelPending}
                />
              ))
            }
            return (
              <PlanStepRow
                key={step.id}
                step={step}
                compact={compact}
                settle={isTerminal ? 'run-finished' : 'live'}
              />
            )
          })}
        </div>
      ) : null}

      {unattachedChildren.length ? (
        <div className="flex flex-col">
          {unattachedChildren.map((child) => (
            <RunChildRow
              key={child.id}
              run={child}
              ownerTerminal={isTerminal}
              activityDetail={liveState.activity[child.id]?.detail}
              onOpen={
                child.sessionId && onOpenSession ? () => onOpenSession(child.sessionId!, child.agentId) : undefined
              }
              onCancel={() => onCancelRun(child.id)}
              cancelPending={cancelPending}
            />
          ))}
        </div>
      ) : null}

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
              {sources.length > 1 ? (
                <span className="text-muted-foreground text-[10px]">{runTitle(run)}</span>
              ) : null}
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

const STEP_ICONS = {
  pending: CircleDashed,
  running: Loader2,
  done: Check,
  failed: X,
  skipped: Minus,
}

const STEP_CLASSES = {
  pending: 'text-muted-foreground',
  running: 'text-primary',
  done: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground line-through',
}

type StepStatus = keyof typeof STEP_ICONS

/**
 * How much of the plan's own account of itself to still believe.
 *
 * - `live`: verbatim.
 * - `run-finished`: the run that owns this plan is over, so nothing in it is running and nothing
 *   pending will start. Mirrors the settling the service now does in `plan_cbor`, so plans written
 *   before that landed read identically.
 * - `idle`: a session todo list with no run behind it right now. The session lives on, so pending
 *   steps stay pending — but a step left mid-flight is not running either, and a spinner under a
 *   finished turn is exactly the lie that makes the whole card untrustworthy.
 */
type PlanSettle = 'live' | 'run-finished' | 'idle'

function displayStepStatus(status: StepStatus, settle: PlanSettle): StepStatus {
  if (settle === 'live') return status
  if (settle === 'idle') return status === 'running' ? 'pending' : status
  if (status === 'running') return 'done'
  if (status === 'pending') return 'skipped'
  return status
}

/** One plan step row: status icon and label. */
function PlanStepRow({
  step,
  compact,
  settle = 'live',
}: {
  step: RunPlan['steps'][number]
  compact?: boolean
  settle?: PlanSettle
}) {
  const status = displayStepStatus(step.status, settle)
  const Icon = STEP_ICONS[status]
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <Icon className={`size-3 flex-none ${STEP_CLASSES[status]} ${status === 'running' ? 'animate-spin' : ''}`} />
      <span className={`min-w-0 truncate ${STEP_CLASSES[status]}`}>{step.label}</span>
    </div>
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

/** One child run in the strip: status, what it is, a way into its transcript, and a way to stop it. */
function RunChildRow({
  run,
  ownerTerminal,
  activityDetail,
  onOpen,
  onCancel,
  cancelPending,
}: {
  run: RunInfo
  /** The parent run has finished, so this child cannot still be going however it was last recorded. */
  ownerTerminal?: boolean
  activityDetail?: string
  onOpen?: () => void
  onCancel?: () => void
  cancelPending?: boolean
}) {
  const KindIcon = run.kind === 'workflow' ? Workflow : Bot
  const isLive = !isTerminalRun(run.status) && !ownerTerminal
  const status = runStatusAsSessionStatus(run.status)
  // A stale "still running" child under a finished parent gets the quiet dot, never the pulse.
  const dotStatus = status === 'streaming' && !isLive ? 'idle' : status
  const content = (
    <>
      <SessionStatusDot status={dotStatus} className="size-2" />
      <KindIcon className="text-muted-foreground size-3 flex-none" />
      {/* The title is the click target: it holds its ground (truncating only past 55%), while the
          error text yields — truncated into the remaining space with the full text on hover.
          A flex-none error span let long provider errors crush the title entirely. */}
      <span className="max-w-[55%] flex-none truncate">{runTitle(run)}</span>
      {isLive && activityDetail ? (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">{activityDetail}</span>
      ) : null}
      {run.error ? (
        <span className="text-destructive min-w-0 flex-1 truncate text-[10px]" title={run.error.message}>
          {run.error.message}
        </span>
      ) : null}
    </>
  )
  return (
    <div className="flex min-w-0 items-center gap-1">
      {onOpen ? (
        <button
          type="button"
          className="hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]"
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-[11px]">{content}</div>
      )}
      {isLive && onCancel ? (
        <button
          type="button"
          // One child is low-stakes to stop, unlike the whole run — no confirmation step in the way.
          aria-label={`Cancel ${runTitle(run)}`}
          title={`Cancel ${runTitle(run)}`}
          className="text-muted-foreground hover:text-destructive flex-none rounded p-0.5"
          disabled={cancelPending}
          onClick={onCancel}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
