import {type AgentRunActivity, type AgentRunUsage} from './client'
import {cn} from '@shm/ui/utils'
import {Clock, Loader2} from 'lucide-react'
import {useServerNow} from './server-clock'
import type {SessionChildWait} from './agent-session-rows'
import {useOpenAgentSession} from './open-session-context'

/**
 * The one live "what is the agent doing right now" status UI, shared by the full
 * agent session page and the assistant sidebar: spinner, activity phase, tool detail,
 * elapsed time, and token count. Callers hide it while a pending tool-call row is
 * showing its own live progress, so only one spinner is visible at a time.
 */
export function AgentRunStatusBar({
  startedAt,
  serverUrl,
  activity,
  usage,
  queuedSince,
  childWait,
  className,
}: {
  /**
   * When the turn began, by the server's clock (see `sessionTurnStartedAt`). Undefined until the
   * server has said — the timer waits rather than counting from a guess.
   */
  startedAt: number | undefined
  /** The server whose clock the timer counts against. */
  serverUrl?: string
  activity?: AgentRunActivity
  usage?: AgentRunUsage
  /**
   * Since when the run has been waiting for a worker (see `sessionQueuedSince`). While set, the
   * bar says so instead of "Working…": the server caps concurrent runs, and a person watching a
   * spinner labelled as work forms expectations the queue cannot meet.
   */
  queuedSince?: number
  /**
   * The delegated children the run is parked on (see `sessionChildWait`). The session reads as
   * idle while its run waits on a child, so this is the only line that says the work is still going
   * — and names the child, which is where the reader can watch it.
   */
  childWait?: SessionChildWait
  className?: string
}) {
  const openSession = useOpenAgentSession()
  const queued = queuedSince !== undefined
  const waitingOnChildren = !queued && childWait !== undefined
  const countFrom = queued ? queuedSince : waitingOnChildren ? childWait.since : startedAt
  const now = useServerNow(serverUrl, countFrom !== undefined)
  const elapsed = countFrom === undefined ? undefined : Math.max(0, now - countFrom)
  const childCount = childWait ? Math.max(childWait.pendingChildren ?? 0, childWait.children.length) : 0
  const mode = queued ? 'queued' : waitingOnChildren ? 'children' : 'active'
  return (
    <div
      className={cn('text-muted-foreground flex items-center gap-2 py-2 text-xs', className)}
      aria-live="polite"
      data-run-status={mode}
    >
      {mode === 'active' ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Clock className="size-3.5 shrink-0" />
      )}
      <span className="font-medium">
        {queued
          ? 'Waiting to run…'
          : waitingOnChildren
            ? childCount > 1
              ? `Waiting on ${childCount} child runs…`
              : 'Waiting on a child run…'
            : activityLabel(activity)}
      </span>
      {queued ? (
        <span
          className="max-w-64 min-w-0 truncate opacity-75"
          title="The server runs a limited number of agents at once"
        >
          Queued behind other runs on this server
        </span>
      ) : waitingOnChildren ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {childWait.children.map((child) =>
            child.sessionId ? (
              <button
                key={child.runId}
                type="button"
                className="hover:text-foreground min-w-0 truncate underline decoration-dotted underline-offset-2"
                title="Open the child session"
                onClick={(event) => openSession({sessionId: child.sessionId!, serverUrl, event})}
              >
                {child.title || 'Untitled child'}
              </button>
            ) : (
              <span key={child.runId} className="min-w-0 truncate opacity-75">
                {child.title || 'Untitled child'}
              </span>
            ),
          )}
        </span>
      ) : activity?.detail ? (
        <span className="max-w-64 min-w-0 truncate opacity-75">{activity.detail}</span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
        {elapsed !== undefined ? (
          <span aria-label={mode === 'active' ? 'Elapsed time' : 'Time waiting'}>{formatElapsed(elapsed)}</span>
        ) : null}
        {mode === 'active' && usage && usage.total > 0 ? (
          <span aria-label="Tokens used">{formatTokenCount(usage.total)} tokens</span>
        ) : null}
      </span>
    </div>
  )
}

/** Human-readable label for the agent's current activity phase. */
function activityLabel(activity?: AgentRunActivity): string {
  switch (activity?.phase) {
    case 'starting':
      return 'Starting…'
    case 'responding':
      return 'Responding…'
    case 'tool':
      return activity.toolName ? `Running ${activity.toolName}…` : 'Running tool…'
    case 'finalizing':
      return 'Finishing…'
    case 'thinking':
      return 'Thinking…'
    default:
      return 'Working…'
  }
}

/** Formats elapsed milliseconds as m:ss for the live run timer. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Formats a step's wall time compactly: "0.4s", "12s", "1m 5s", "1h 2m". */
export function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Formats a settled thinking span in words ("12 seconds", "3 minutes", "1 hour 5 minutes"). */
export function formatThinkingDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 1) return 'less than a second'
  if (seconds < 60) return plural(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour')
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/** Formats a token count compactly (e.g. 1234 → "1.2k"). */
export function formatTokenCount(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}
