import {type RunInfo, type RunJournalEntryInfo, type RunPlan, type RunStatus} from '@/agents-client'
import {formatElapsed, formatTokenCount} from '@/components/agent-run-status'
import {SessionStatusDot} from '@/components/session-children'
import {useAgentRunTreeSubscription, useCancelRun, useRunTree, useSessionRuns} from '@/models/agents'
import {Button} from '@shm/ui/button'
import {Bot, Check, ChevronDown, ChevronRight, CircleDashed, Loader2, Minus, Workflow, X} from 'lucide-react'
import React, {useEffect, useMemo, useRef, useState} from 'react'

/** Statuses a run can no longer leave. */
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'canceled'])

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
  if (TERMINAL_RUN_STATUSES.has(status)) return 'idle'
  return 'streaming'
}

/**
 * The pinned progress card: what the agent is working through, right now, without scrolling.
 *
 * Durable-first — the latest root run and its tree come from `ListRuns`, and subscribing to
 * `runs/<rootRunId>` replays every run's current state on connect, so a reload or a relaunch
 * mid-workflow rebuilds the card in full. Live partials only animate progress and activity on top of
 * that. With no run at all it falls back to the session's `update_plan` todo list, which is the same
 * step list fed from a different source.
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
  /** `SessionInfo.plan`, rendered as a todo list when no run is active. */
  sessionPlan?: RunPlan
  /** Sidebar sizing: tighter rows, no footer. */
  compact?: boolean
  /** Opens the transcript of an agent child run. */
  onOpenSession?: (sessionId: string, agentId?: string) => void
}) {
  const runs = useSessionRuns(serverUrl, accountUid, sessionId)
  const latestRoot = runs.data?.[0]
  const rootRunId = latestRoot?.rootRunId
  const tree = useRunTree(serverUrl, accountUid, rootRunId)
  const live = useAgentRunTreeSubscription(serverUrl, accountUid, rootRunId)
  const cancelRun = useCancelRun(serverUrl, accountUid)
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  // A newer root run replaces whatever the user dismissed or expanded before it.
  useEffect(() => {
    setTerminalExpanded(false)
    setConfirmingCancel(false)
  }, [rootRunId])

  const runsById = useMemo(() => {
    const merged: Record<string, RunInfo> = {}
    for (const run of tree.data || []) merged[run.id] = run
    if (latestRoot && !merged[latestRoot.id]) merged[latestRoot.id] = latestRoot
    // The socket's replay is at least as fresh as the query, so it wins.
    for (const run of Object.values(live.runs)) merged[run.id] = run
    return merged
  }, [tree.data, live.runs, latestRoot])

  const root = latestRoot ? runsById[latestRoot.id] ?? latestRoot : undefined
  const children = useMemo(
    () =>
      Object.values(runsById)
        .filter((run) => run.id !== root?.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [runsById, root?.id],
  )

  if (!root) {
    if (!sessionPlan?.steps.length) return null
    return (
      <RunCardShell compact={compact}>
        <RunPlanSteps plan={sessionPlan} compact={compact} />
      </RunCardShell>
    )
  }

  const isTerminal = TERMINAL_RUN_STATUSES.has(root.status)
  if (isTerminal && dismissedRunId === root.id) return null

  const plan = root.plan ?? sessionPlan
  const progress = live.progress[root.id]
  const doneChildren = children.filter((child) => TERMINAL_RUN_STATUSES.has(child.status)).length
  const usageTotal = (root.usage?.total ?? 0) + (root.usage?.children?.total ?? 0)

  if (isTerminal && !terminalExpanded) {
    return (
      <RunCardShell compact={compact}>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 text-left text-xs"
          onClick={() => setTerminalExpanded(true)}
        >
          {root.status === 'succeeded' ? (
            <Check className="size-3.5 flex-none text-emerald-600 dark:text-emerald-400" />
          ) : (
            <X className="text-destructive size-3.5 flex-none" />
          )}
          <span className="min-w-0 truncate">
            {root.status === 'succeeded'
              ? [
                  root.title || 'Run finished',
                  plan?.steps.length ? `${plan.steps.length} steps` : null,
                  children.length ? `${children.length} sub-session${children.length === 1 ? '' : 's'}` : null,
                  usageTotal > 0 ? `${formatTokenCount(usageTotal)} tok` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `${RUN_STATUS_LABELS[root.status]}: ${root.error?.message || root.title || 'no details'}`}
          </span>
          <ChevronRight className="text-muted-foreground ml-auto size-3.5 flex-none" />
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex-none"
          aria-label="Dismiss run summary"
          onClick={() => setDismissedRunId(root.id)}
        >
          <X className="size-3.5" />
        </button>
      </RunCardShell>
    )
  }

  const isParked = root.status === 'waiting'

  return (
    <RunCardShell compact={compact} column>
      <div className="flex min-w-0 items-center gap-2">
        {isTerminal ? (
          <button
            type="button"
            aria-label="Collapse run details"
            className="text-muted-foreground hover:text-foreground flex-none"
            onClick={() => setTerminalExpanded(false)}
          >
            <ChevronDown className="size-3.5" />
          </button>
        ) : (
          <Loader2 className="text-muted-foreground size-3.5 flex-none animate-spin" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {isParked && children.length
            ? `Waiting on ${children.length} sub-session${children.length === 1 ? '' : 's'} — ${doneChildren} done`
            : root.title || (root.kind === 'workflow' ? 'Workflow' : 'Agent run')}
        </span>
        <span className={`flex-none rounded-full border px-1.5 py-0.5 text-[10px] ${runStatusClass(root.status)}`}>
          {RUN_STATUS_LABELS[root.status]}
        </span>
        <RunElapsed run={root} />
        {!isTerminal ? (
          confirmingCancel ? (
            <span className="flex flex-none items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelRun.isPending}
                onClick={() => {
                  cancelRun.mutate(root.id)
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
          )
        ) : null}
      </div>

      {progress ? (
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

      {plan?.steps.length ? <RunPlanSteps plan={plan} compact={compact} /> : null}

      {children.length ? (
        <div className="flex flex-col">
          {children.map((child) => (
            <RunChildRow
              key={child.id}
              run={child}
              activityDetail={live.activity[child.id]?.detail}
              onOpen={
                child.sessionId && onOpenSession ? () => onOpenSession(child.sessionId!, child.agentId) : undefined
              }
            />
          ))}
        </div>
      ) : null}

      <RunActivityDrawer journal={live.journal} />

      {!compact && usageTotal > 0 ? (
        <div className="text-muted-foreground border-border flex justify-end border-t pt-1 text-[10px]">
          {formatTokenCount(usageTotal)} tokens
        </div>
      ) : null}
    </RunCardShell>
  )
}

/** How many journal lines the drawer keeps on screen; older ones scroll out of existence. */
const MAX_ACTIVITY_LINES = 100

/** One rendered journal line: what happened, and how loudly to say it. */
type ActivityLine = {key: string; text: string; tone?: 'error' | 'warn'}

/**
 * Renders the journal entries a workflow writes as it runs. Kinds not listed here (`result`,
 * `timer`, `fired`, `now`, `plan`) are replay bookkeeping, not activity, and would drown the log.
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
    }
  }
  if (payload.kind === 'step') {
    const phase = payload.phase === 'start' ? 'start' : payload.ok === false ? 'failed' : 'done'
    return {
      key,
      text: `step: ${payload.label ?? payload.phase ?? ''} (${phase})`,
      tone: phase === 'failed' ? 'error' : undefined,
    }
  }
  if (payload.kind === 'call') {
    if (payload.op === 'agent') return {key, text: 'agent: sub-session'}
    return {key, text: `tool: ${payload.tool ?? 'unknown'}`}
  }
  // Successful results are replay bookkeeping, but a failed result is the one place the error
  // message lives — surface it where someone reading the log is looking for it.
  if (payload.kind === 'result' && payload.status === 'failed') {
    return {
      key,
      text: `failed: ${payload.error?.message ?? payload.error?.code ?? 'action failed'}`,
      tone: 'error',
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
            <div
              key={line.key}
              className={`truncate ${
                line.tone === 'error'
                  ? 'text-destructive'
                  : line.tone === 'warn'
                    ? 'text-amber-700 dark:text-amber-300'
                    : ''
              }`}
              title={line.text}
            >
              {line.text}
            </div>
          ))}
        </div>
      ) : null}
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
  const isTerminal = TERMINAL_RUN_STATUSES.has(run.status)
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

/** The step list, fed by a run's plan or by the session's `update_plan` todo list. */
function RunPlanSteps({plan, compact}: {plan: RunPlan; compact?: boolean}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {plan.title ? (
        <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{plan.title}</span>
      ) : null}
      {plan.steps.map((step) => {
        const Icon = STEP_ICONS[step.status]
        return (
          <div key={step.id} className={`flex min-w-0 items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
            <Icon
              className={`size-3 flex-none ${STEP_CLASSES[step.status]} ${
                step.status === 'running' ? 'animate-spin' : ''
              }`}
            />
            <span className={`min-w-0 truncate ${STEP_CLASSES[step.status]}`}>{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** One child run in the strip: status, what it is, and a way into its transcript. */
function RunChildRow({run, activityDetail, onOpen}: {run: RunInfo; activityDetail?: string; onOpen?: () => void}) {
  const KindIcon = run.kind === 'workflow' ? Workflow : Bot
  const content = (
    <>
      <SessionStatusDot status={runStatusAsSessionStatus(run.status)} className="size-2" />
      <KindIcon className="text-muted-foreground size-3 flex-none" />
      <span className="min-w-0 truncate">{run.title || (run.kind === 'workflow' ? 'Workflow' : 'Sub-session')}</span>
      {activityDetail ? (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">{activityDetail}</span>
      ) : null}
      {run.error ? <span className="text-destructive flex-none text-[10px]">{run.error.message}</span> : null}
    </>
  )
  if (!onOpen) return <div className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-[11px]">{content}</div>
  return (
    <button
      type="button"
      className="hover:bg-muted flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]"
      onClick={onOpen}
    >
      {content}
    </button>
  )
}
