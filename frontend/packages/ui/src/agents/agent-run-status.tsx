import {type AgentRunActivity, type AgentRunUsage} from './client'
import {cn} from '@shm/ui/utils'
import {Loader2} from 'lucide-react'
import {useServerNow} from './server-clock'

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
  className?: string
}) {
  const now = useServerNow(serverUrl, startedAt !== undefined)
  const elapsed = startedAt === undefined ? undefined : Math.max(0, now - startedAt)
  return (
    <div className={cn('text-muted-foreground flex items-center gap-2 py-2 text-xs', className)} aria-live="polite">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span className="font-medium">{activityLabel(activity)}</span>
      {activity?.detail ? <span className="max-w-64 min-w-0 truncate opacity-75">{activity.detail}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
        {elapsed !== undefined ? <span aria-label="Elapsed time">{formatElapsed(elapsed)}</span> : null}
        {usage && usage.total > 0 ? <span aria-label="Tokens used">{formatTokenCount(usage.total)} tokens</span> : null}
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
