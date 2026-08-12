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
import type {ChatToolPart} from '@/models/chat-parts'
import {Bot, Check, ChevronDown, ChevronRight, CircleDashed, Loader2, Minus, Workflow, X} from 'lucide-react'
import React, {useMemo, useState} from 'react'

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled'])

export const isTerminalRun = (status: RunStatus) => TERMINAL_RUN_STATUSES.has(status)

/** A run's own title, or what it is when it never got one. */
export function runTitle(run: RunInfo): string {
  if (run.title) return run.title
  if (run.kind === 'workflow') return 'Workflow'
  return run.parentRunId ? 'Sub-session' : 'Agent turn'
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
function ChildRunPresence({run, live, activityDetail}: {run: RunInfo; live: boolean; activityDetail?: string}) {
  const KindIcon = run.kind === 'workflow' ? Workflow : Bot
  const status = runStatusAsSessionStatus(run.status)
  return (
    <>
      {/* A stale "still running" child under a finished parent gets the quiet dot, never the pulse. */}
      <SessionStatusDot status={status === 'streaming' && !live ? 'idle' : status} className="size-2 flex-none" />
      <KindIcon className="text-muted-foreground size-3 flex-none" />
      {live && activityDetail ? (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">{activityDetail}</span>
      ) : null}
      {run.error ? (
        <span className="text-destructive min-w-0 flex-1 truncate text-[10px]" title={run.error.message}>
          {run.error.message}
        </span>
      ) : null}
    </>
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
      {child ? <ChildRunPresence run={child} live={childLive} activityDetail={activityDetail} /> : null}
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
  onOpen,
  onCancel,
  cancelPending,
}: {
  run: RunInfo
  ownerTerminal?: boolean
  activityDetail?: string
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
      <ChildRunPresence run={run} live={isLive} activityDetail={activityDetail} />
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
  /**
   * One child, rendered the one way children are rendered — batch peers under a step and children
   * with no home step alike, so a peer can never be told apart from its siblings by its styling.
   */
  const childRow = (child: RunInfo) => (
    <RunChildRow
      run={child}
      ownerTerminal={isTerminal}
      activityDetail={liveState.activity[child.id]?.detail}
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
          {plan?.title ? (
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{plan.title}</span>
          ) : null}
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
