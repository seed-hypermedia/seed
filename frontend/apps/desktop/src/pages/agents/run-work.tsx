/**
 * The elegant account of a run's work, shared by every surface that shows one: the pinned card,
 * the finished run-record row, and the expanded delegate bubble. The primary content is the
 * HIERARCHY — plan steps integrated with the children working them, and the script's own tool
 * calls labeled by the descriptions it narrated — never raw journal JSON (that stays behind the
 * Activity/ⓘ drawers). Tool calls render through the exact same tool-row component the chat uses,
 * injected via `renderToolPart` so this module stays import-cycle-free.
 */
import {type RunInfo, type RunJournalEntryInfo, type RunPlan, type RunStatus} from '@/agents-client'
import {useAgentRunTreeSubscription, useRunTree, type AgentRunTreeLiveState} from '@/models/agents'
import {SessionStatusDot} from '@/components/session-children'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import type {ChatToolPart} from '@/models/chat-parts'
import {Bot, Check, ChevronDown, ChevronRight, CircleDashed, Clock3, Loader2, Minus, Workflow, X} from 'lucide-react'
import React, {useMemo, useState} from 'react'

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled'])

export const isTerminalRun = (status: RunStatus) => TERMINAL_RUN_STATUSES.has(status)

type RunTimer = {startedAt: number; wakeAt: number}

/** Finds the durable timer currently parking a run, including when the page loaded mid-wait. */
function activeRunTimer(run: RunInfo, journal: RunJournalEntryInfo[]): RunTimer | undefined {
  if (run.wait?.reason !== 'timer' || !run.wait.wakeAt) return undefined
  const timer = [...journal].reverse().find((entry) => {
    if (entry.runId !== run.id) return false
    const payload = entry.entry as {kind?: string; wakeAt?: number}
    return payload.kind === 'timer' && payload.wakeAt === run.wait?.wakeAt
  })
  return {startedAt: timer?.createdAt ?? run.updatedAt, wakeAt: run.wait.wakeAt}
}

function TimerProgress({run, timer, wide = false}: {run: RunInfo; timer: RunTimer; wide?: boolean}) {
  const [now, setNow] = useState(() => Date.now())

  React.useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [timer.startedAt, timer.wakeAt])

  const duration = Math.max(1, timer.wakeAt - timer.startedAt)
  const remaining = Math.max(0, timer.wakeAt - now)
  const elapsedFraction = Math.min(1, Math.max(0, (now - timer.startedAt) / duration))
  const totalSeconds = Math.ceil(remaining / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const remainingLabel =
    remaining <= 0
      ? 'Waking…'
      : hours > 0
        ? `${hours}h ${String(minutes).padStart(2, '0')}m left`
        : `${minutes}:${String(seconds).padStart(2, '0')} left`
  const wakeLabel = new Date(timer.wakeAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})

  return (
    <div
      role="timer"
      data-testid={`run-timer-${run.id}`}
      aria-label={`${remainingLabel}; scheduled for ${wakeLabel}`}
      title={`Scheduled for ${wakeLabel}`}
      className={`border-primary/20 bg-primary/5 text-primary flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 ${
        wide ? 'w-full' : 'flex-none'
      }`}
    >
      <Clock3 className="size-3 flex-none" />
      <span className="flex-none text-[10px] font-medium tabular-nums">{remainingLabel}</span>
      <span className={`bg-primary/15 h-1 overflow-hidden rounded-full ${wide ? 'min-w-12 flex-1' : 'w-10'}`}>
        <span
          className="bg-primary block h-full rounded-full transition-[width] duration-1000 motion-reduce:transition-none"
          style={{width: `${elapsedFraction * 100}%`}}
        />
      </span>
      {wide ? <span className="text-muted-foreground flex-none text-[10px]">until {wakeLabel}</span> : null}
    </div>
  )
}

/** A live durable timer with a ticking countdown and elapsed-time track. */
export function RunTimerProgress({
  run,
  journal,
  wide = false,
}: {
  run: RunInfo
  journal: RunJournalEntryInfo[]
  wide?: boolean
}) {
  const timer = useMemo(() => activeRunTimer(run, journal), [journal, run])
  return timer ? <TimerProgress run={run} timer={timer} wide={wide} /> : null
}

/** A run's title. Mandatory at creation, so the display layer never invents a label. */
export function runTitle(run: RunInfo): string {
  return run.title
}

/** Session status a run maps onto, so child affordances reuse the one status dot the lists use. */
export function runStatusAsSessionStatus(status: RunStatus): 'idle' | 'streaming' | 'error' {
  if (status === 'failed' || status === 'canceled') return 'error'
  if (isTerminalRun(status)) return 'idle'
  return 'streaming'
}

/**
 * The run tree behind a card: durable rows from `ListRuns`, overlaid by the socket's replay.
 * `live: false` opens no socket and skips the tree query — used by collapsed transcript cards.
 */
export function useRunTreeView(
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
    for (const run of Object.values(liveState.runs)) merged[run.id] = run
    return merged
  }, [tree.data, liveState.runs, seed])

  return {runsById, liveState}
}

/** Every run spawned under `focusRunId`, at any depth, oldest first. */
export function descendantsOf(runsById: Record<string, RunInfo>, focusRunId: string): RunInfo[] {
  const isDescendant = (run: RunInfo): boolean => {
    let current: RunInfo | undefined = run
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
 * The journal's tool calls as chat tool parts: `ctx.call(tool, input, {description})` pairs with
 * its result by callSeq, and the script's own description becomes the row's summary — the same
 * row the chat renders, saying what the work WAS, with the tool name as the secondary fact.
 */
export function journalToolParts(journal: RunJournalEntryInfo[]): ChatToolPart[] {
  const resultsBySeq = new Map<string, {status?: string; output?: unknown; error?: {code?: string; message?: string}}>()
  for (const entry of journal) {
    const payload = entry.entry as {
      kind?: string
      callSeq?: number
      status?: string
      output?: unknown
      error?: {code?: string; message?: string}
    }
    if (payload.kind === 'result' && payload.callSeq !== undefined) {
      resultsBySeq.set(`${entry.runId}:${payload.callSeq}`, payload)
    }
  }
  const parts: ChatToolPart[] = []
  for (const entry of journal) {
    const payload = entry.entry as {
      kind?: string
      op?: string
      callSeq?: number
      tool?: string
      input?: unknown
      description?: string
    }
    if (payload.kind !== 'call' || payload.op !== 'tool') continue
    const key = `${entry.runId}:${payload.callSeq ?? entry.seq}`
    const result = resultsBySeq.get(key)
    const failed = result?.status === 'failed'
    parts.push({
      type: 'tool',
      id: `wf-${key}`,
      name: payload.tool || 'call',
      args: (typeof payload.input === 'object' && payload.input !== null ? payload.input : {}) as Record<
        string,
        unknown
      >,
      ...(payload.description ? {summaryOverride: payload.description} : {}),
      ...(result
        ? failed
          ? {isError: true, result: result.error?.message ?? 'failed'}
          : {rawOutput: result.output, result: safeStringify(result.output)}
        : {}),
    })
  }
  return parts
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
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

/** How much of the plan's own account of itself to still believe (see run-card for the story). */
export type PlanSettle = 'live' | 'run-finished' | 'idle'

export function displayStepStatus(status: StepStatus, settle: PlanSettle): StepStatus {
  if (settle === 'live') return status
  if (settle === 'idle') return status === 'running' ? 'pending' : status
  if (status === 'running') return 'done'
  if (status === 'pending') return 'skipped'
  return status
}

/**
 * How a child run shows up inside a row, wherever that row comes from: what kind of worker it is,
 * whether it is still alive, and what it is doing right now or how it failed.
 *
 * One fragment for the step row and the loose child row, so the two can never drift into saying
 * the same thing two different ways.
 */
function ChildRunPresence({
  run,
  live,
  activityDetail,
  errorToolPart,
  renderToolPart,
  timer,
  onOpen,
}: {
  run: RunInfo
  live: boolean
  activityDetail?: string
  /** The journaled call the run's terminal error points at, when it points at one. */
  errorToolPart?: ChatToolPart
  renderToolPart?: (part: ChatToolPart) => React.ReactNode
  timer?: RunTimer
  /** Opens the child's sub-session; surfaced inside the error inspector as the way deeper. */
  onOpen?: () => void
}) {
  const KindIcon = timer ? Clock3 : run.kind === 'workflow' ? Workflow : Bot
  const status = runStatusAsSessionStatus(run.status)
  return (
    <>
      {/* A stale "still running" child under a finished parent gets the quiet dot, never the pulse. */}
      <SessionStatusDot status={status === 'streaming' && !live ? 'idle' : status} className="size-2 flex-none" />
      <KindIcon className="text-muted-foreground size-3 flex-none" />
      {timer ? <TimerProgress run={run} timer={timer} /> : null}
      {live && activityDetail ? (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">{activityDetail}</span>
      ) : null}
      {run.error ? (
        <RunErrorChip
          run={run}
          error={run.error}
          errorToolPart={errorToolPart}
          renderToolPart={renderToolPart}
          onOpen={onOpen}
        />
      ) : null}
    </>
  )
}

/** The `workflow.js:LINE` frame a script stack points at, resolved to a line number. */
function scriptErrorLine(stack: string): number | undefined {
  const match = /workflow\.js:(\d+)/.exec(stack)
  return match ? Number(match[1]) : undefined
}

/**
 * A child run's failure, openable in place: truncated in the row, complete on click.
 *
 * The row it sits in is often itself a button (clicking a child row opens its sub-session), so the
 * chip is a non-button trigger and every interaction inside it stops propagating — including from
 * the portaled popover content, whose React events still bubble through the component tree to the
 * row.
 */
export function RunErrorChip({
  run,
  error,
  errorToolPart,
  renderToolPart,
  onOpen,
}: {
  run: RunInfo
  error: NonNullable<RunInfo['error']>
  /** The journaled call `error.callSeq` points at — rendered as the chat's own tool row. */
  errorToolPart?: ChatToolPart
  renderToolPart?: (part: ChatToolPart) => React.ReactNode
  /** Opens the run's sub-session, when it has one — the deepest context for agent children. */
  onOpen?: () => void
}) {
  // A script stack's workflow.js frames index into the stored source, so the offending line can
  // be shown verbatim instead of asking the reader to open the Code drawer and count lines.
  const errorLine = error.stack ? scriptErrorLine(error.stack) : undefined
  const sourceLines = errorLine !== undefined && run.sourceText ? run.sourceText.split('\n') : undefined
  const excerpt =
    errorLine !== undefined && sourceLines && sourceLines[errorLine - 1] !== undefined
      ? sourceLines.slice(Math.max(0, errorLine - 2), errorLine + 1).map((text, index) => ({
          number: Math.max(0, errorLine - 2) + index + 1,
          text,
        }))
      : undefined
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          title="Show full error"
          className="text-destructive hover:bg-destructive/10 min-w-0 flex-1 cursor-pointer truncate rounded px-0.5 text-left text-[10px] underline decoration-dotted underline-offset-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
        >
          {error.message}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[28rem] max-w-[92vw] flex-col gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-medium">{runTitle(run)}</span>
          <span className="text-destructive bg-destructive/10 flex-none rounded-full px-1.5 py-0.5 font-mono text-[10px]">
            {error.code}
          </span>
        </div>
        <pre className="text-destructive max-h-40 overflow-auto text-[11px] break-words whitespace-pre-wrap select-text">
          {error.message}
        </pre>
        {errorToolPart && renderToolPart ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Failing tool call</span>
            <div className="min-w-0 [&_.mr-6]:mr-0">{renderToolPart(errorToolPart)}</div>
          </div>
        ) : null}
        {excerpt ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
              workflow source, line {errorLine}
            </span>
            <pre className="bg-muted/60 max-h-32 overflow-auto rounded-md p-2 text-[11px] select-text">
              {excerpt.map((line) => (
                <div key={line.number} className={line.number === errorLine ? 'text-destructive font-medium' : ''}>
                  {String(line.number).padStart(4)} {line.text}
                </div>
              ))}
            </pre>
          </div>
        ) : null}
        {error.detail !== undefined ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Detail</span>
            <pre className="bg-muted/60 max-h-32 overflow-auto rounded-md p-2 text-[11px] whitespace-pre-wrap select-text">
              {JSON.stringify(error.detail, null, 2)}
            </pre>
          </div>
        ) : null}
        {error.stack ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Stack</span>
            <pre className="text-muted-foreground max-h-24 overflow-auto text-[10px] select-text">{error.stack}</pre>
          </div>
        ) : null}
        {onOpen ? (
          <button
            type="button"
            className="border-border hover:bg-muted self-start rounded-md border px-2 py-1 text-[11px]"
            onClick={onOpen}
          >
            Open sub-session
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Stopping one child, at the row's edge.
 *
 * Quiet until the row is hovered — but a keyboard focus reveals it too, and on a device with no
 * hover it is simply always there, so the only way to cancel is never one nobody can reach.
 */
function CancelRunButton({run, onCancel, pending}: {run: RunInfo; onCancel: () => void; pending?: boolean}) {
  return (
    <button
      type="button"
      aria-label={`Cancel ${runTitle(run)}`}
      title={`Cancel ${runTitle(run)}`}
      className="text-muted-foreground hover:text-destructive flex-none rounded p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      disabled={pending}
      onClick={onCancel}
    >
      <X className="size-3" />
    </button>
  )
}

/**
 * One plan step, integrated with the child working it. The step IS the interactive row: when a
 * single child is attached, clicking the row opens its sub-session, its status dot and live
 * activity ride along, and the child's cancel sits at the row's edge — one list, never a step row
 * with a duplicate child row stacked beneath it.
 *
 * With no child (either a plain step, or a batch step whose children render as peers below) the
 * row is inert: label and status only, nothing to click.
 */
export function PlanStepRow({
  step,
  child,
  compact,
  settle = 'live',
  ownerTerminal,
  activityDetail,
  errorToolPart,
  renderToolPart,
  timer,
  onOpen,
  onCancel,
  cancelPending,
}: {
  step: RunPlan['steps'][number]
  child?: RunInfo
  compact?: boolean
  settle?: PlanSettle
  ownerTerminal?: boolean
  activityDetail?: string
  /** The journaled call the child's terminal error points at, for the error inspector. */
  errorToolPart?: ChatToolPart
  renderToolPart?: (part: ChatToolPart) => React.ReactNode
  timer?: RunTimer
  onOpen?: () => void
  onCancel?: () => void
  cancelPending?: boolean
}) {
  const status = displayStepStatus(step.status, settle)
  const Icon = STEP_ICONS[status]
  const childLive = child ? !isTerminalRun(child.status) && !ownerTerminal : false
  const body = (
    <>
      <Icon className={`size-3 flex-none ${STEP_CLASSES[status]} ${status === 'running' ? 'animate-spin' : ''}`} />
      {/* The label owns the row's space (2:1 over presence detail) and truncates only when the
          row genuinely runs out — percentage caps collapse inside shrink-wrapped ancestors and
          were cutting short labels at a fraction of the available width. */}
      <span className={`min-w-0 flex-[2] truncate ${STEP_CLASSES[status]}`}>{step.label}</span>
      {/* Who closed it. A step the runtime settled from finished sub-agents is still done — but the
          agent never said so, and a checklist that reads identically either way quietly attributes
          the runtime's bookkeeping to the agent's judgment. */}
      {step.resolvedBy === 'runtime' ? (
        <span
          data-testid="step-resolved-by-runtime"
          title="Settled by the runtime from completed sub-agent results"
          className="text-muted-foreground flex-none text-[10px] tracking-wide uppercase opacity-70"
        >
          auto
        </span>
      ) : null}
      {child ? (
        <ChildRunPresence
          run={child}
          live={childLive}
          activityDetail={activityDetail}
          errorToolPart={errorToolPart}
          renderToolPart={renderToolPart}
          timer={timer}
          onOpen={onOpen}
        />
      ) : null}
    </>
  )
  return (
    <div className={`group flex min-w-0 items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      {child && onOpen ? (
        <button
          type="button"
          aria-label={`Open ${runTitle(child)}`}
          title={`Open ${runTitle(child)}`}
          className="hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left"
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5">{body}</div>
      )}
      {child && childLive && onCancel ? (
        <CancelRunButton run={child} onCancel={onCancel} pending={cancelPending} />
      ) : null}
    </div>
  )
}

/** One child run with no home step: status, what it is, a way in, and a way to stop it. */
export function RunChildRow({
  run,
  ownerTerminal,
  activityDetail,
  errorToolPart,
  renderToolPart,
  timer,
  onOpen,
  onCancel,
  cancelPending,
}: {
  run: RunInfo
  ownerTerminal?: boolean
  activityDetail?: string
  /** The journaled call the run's terminal error points at, for the error inspector. */
  errorToolPart?: ChatToolPart
  renderToolPart?: (part: ChatToolPart) => React.ReactNode
  timer?: RunTimer
  onOpen?: () => void
  onCancel?: () => void
  cancelPending?: boolean
}) {
  const isLive = !isTerminalRun(run.status) && !ownerTerminal
  const content = (
    <>
      {/* The title owns the row's space (2:1 over presence detail) and truncates only when the
          row genuinely runs out; percentage caps collapsed in shrink-wrapped ancestors. */}
      <span className="min-w-0 flex-[2] truncate">{runTitle(run)}</span>
      <ChildRunPresence
        run={run}
        live={isLive}
        activityDetail={activityDetail}
        errorToolPart={errorToolPart}
        renderToolPart={renderToolPart}
        timer={timer}
        onOpen={onOpen}
      />
    </>
  )
  return (
    <div className="group flex min-w-0 items-center gap-1">
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
      {isLive && onCancel ? <CancelRunButton run={run} onCancel={onCancel} pending={cancelPending} /> : null}
    </div>
  )
}

/** How many described tool calls render open before the list collapses behind a toggle. */
const OPEN_TOOL_CALLS_LIMIT = 6

/**
 * The work itself: the integrated step/child list, loose children, and the script's tool calls in
 * the chat's own tool-row UI. Every surface that shows a run's work composes this.
 */
export function RunWorkHierarchy({
  run,
  childRuns,
  plan,
  journal,
  liveState,
  compact,
  onOpenSession,
  onCancelRun,
  cancelPending,
  renderToolPart,
}: {
  run: RunInfo
  childRuns: RunInfo[]
  plan?: RunPlan
  /**
   * The subscription's journal for the whole run TREE. It is narrowed here to this run and its own
   * descendants, so a sibling script's calls can never surface in the wrong bubble — every caller
   * subscribes by root run id and would otherwise have to remember to filter.
   */
  journal: RunJournalEntryInfo[]
  liveState: AgentRunTreeLiveState
  compact?: boolean
  onOpenSession?: (sessionId: string, agentId?: string) => void
  onCancelRun?: (runId: string) => void
  cancelPending?: boolean
  /** The chat's ToolCallLine, injected to keep one tool-row visual language without an import cycle. */
  renderToolPart?: (part: ChatToolPart) => React.ReactNode
}) {
  const isTerminal = isTerminalRun(run.status)
  const settle: PlanSettle = isTerminal ? 'run-finished' : 'live'

  const {childrenByStep, unattachedChildren} = useMemo(() => {
    const byStep = new Map<string, RunInfo[]>()
    if (!plan?.steps.length) return {childrenByStep: byStep, unattachedChildren: childRuns}
    // Keyed by step id: the agent rewrites step labels between turns, so a child stamped with a
    // label stops matching the step it was spawned under. Ids are stable across those rewrites.
    // Labels and titles remain as fallbacks for runs stamped before planStepId existed.
    const stepIds = new Set(plan.steps.map((step) => step.id))
    const stepIdByLabel = new Map(plan.steps.map((step) => [step.label.trim().toLowerCase(), step.id]))
    const loose: RunInfo[] = []
    for (const child of childRuns) {
      const stamped = (child.stepLabel || '').trim().toLowerCase()
      const titled = (child.title || '').trim().toLowerCase()
      const stepId =
        (child.planStepId && stepIds.has(child.planStepId) ? child.planStepId : undefined) ??
        (stamped ? stepIdByLabel.get(stamped) : undefined) ??
        (titled ? stepIdByLabel.get(titled) : undefined)
      if (!stepId) {
        loose.push(child)
        continue
      }
      byStep.set(stepId, [...(byStep.get(stepId) ?? []), child])
    }
    return {childrenByStep: byStep, unattachedChildren: loose}
  }, [plan, childRuns])

  const toolParts = useMemo(() => {
    const own = new Set([run.id, ...childRuns.map((child) => child.id)])
    return journalToolParts(journal.filter((entry) => own.has(entry.runId)))
  }, [journal, run.id, childRuns])

  const timerFor = (child: RunInfo): RunTimer | undefined => activeRunTimer(child, journal)

  // The journaled call a failed run's terminal error points at (`error.callSeq`), so its error
  // inspector can show the call — name, arguments, result — instead of only the message.
  const failingToolPart = (child: RunInfo): ChatToolPart | undefined => {
    const callSeq = child.error?.callSeq
    if (typeof callSeq !== 'number') return undefined
    return toolParts.find((part) => part.id === `wf-${child.id}:${callSeq}`)
  }
  /**
   * One child, rendered the one way children are rendered — batch peers under a step and children
   * with no home step alike, so a peer can never be told apart from its siblings by its styling.
   */
  const childRow = (child: RunInfo) => (
    <RunChildRow
      run={child}
      ownerTerminal={isTerminal}
      activityDetail={liveState.activity[child.id]?.detail}
      errorToolPart={failingToolPart(child)}
      renderToolPart={renderToolPart}
      timer={timerFor(child)}
      onOpen={child.sessionId && onOpenSession ? () => onOpenSession(child.sessionId!, child.agentId) : undefined}
      onCancel={onCancelRun ? () => onCancelRun(child.id) : undefined}
      cancelPending={cancelPending}
    />
  )

  const [toolsOpen, setToolsOpen] = useState<boolean | undefined>(undefined)
  const showTools = toolsOpen ?? toolParts.length <= OPEN_TOOL_CALLS_LIMIT
  const hasWork = !!(plan?.steps.length || unattachedChildren.length || (toolParts.length && renderToolPart))

  // Nothing to say yet — and an empty flex column would still take vertical space in the card.
  if (!hasWork) return null

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {plan?.steps.length || unattachedChildren.length ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {(plan?.steps ?? []).flatMap((step) => {
            const attached = childrenByStep.get(step.id) ?? []
            // One child: the step IS that child's row — clicking it opens the sub-session.
            // A BATCH (two or more): the step stops privileging any one of them. It falls back to a
            // plain grouping header and every child renders beneath it as a uniform peer, so no
            // sibling is dressed as the step while the rest hang off it.
            const batch = attached.length > 1
            const primary = batch ? undefined : attached[0]
            const peers = batch ? attached : []
            return [
              <PlanStepRow
                key={step.id}
                step={step}
                child={primary}
                compact={compact}
                settle={settle}
                ownerTerminal={isTerminal}
                activityDetail={primary ? liveState.activity[primary.id]?.detail : undefined}
                errorToolPart={primary ? failingToolPart(primary) : undefined}
                renderToolPart={renderToolPart}
                timer={primary ? timerFor(primary) : undefined}
                onOpen={
                  primary?.sessionId && onOpenSession
                    ? () => onOpenSession(primary.sessionId!, primary.agentId)
                    : undefined
                }
                onCancel={primary && onCancelRun ? () => onCancelRun(primary.id) : undefined}
                cancelPending={cancelPending}
              />,
              ...peers.map((child) => (
                <div key={child.id} className="pl-4">
                  {childRow(child)}
                </div>
              )),
            ]
          })}
          {unattachedChildren.map((child) => (
            <React.Fragment key={child.id}>{childRow(child)}</React.Fragment>
          ))}
        </div>
      ) : null}

      {toolParts.length && renderToolPart ? (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            aria-expanded={showTools}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-[11px]"
            onClick={() => setToolsOpen(!showTools)}
          >
            {showTools ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
            Tool calls
            <span className="opacity-70">{toolParts.length}</span>
          </button>
          {showTools ? (
            <div className="min-w-0 [&_.mr-6]:mr-0">
              {toolParts.map((part) => (
                <React.Fragment key={part.id}>{renderToolPart(part)}</React.Fragment>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
