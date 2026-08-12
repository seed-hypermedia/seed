import {type AgentRunActivity, type AgentRunUsage} from './client'
import {cn} from '@shm/ui/utils'
import {Loader2} from 'lucide-react'
import {useEffect, useState} from 'react'

/**
 * The one live "what is the agent doing right now" status UI, shared by the full
 * agent session page and the assistant sidebar: spinner, activity phase, tool detail,
 * elapsed time, and token count. Callers hide it while a pending tool-call row is
 * showing its own live progress, so only one spinner is visible at a time.
 */
export function AgentRunStatusBar({
  startedAt,
  activity,
  usage,
  className,
}: {
  startedAt: number | null
  activity?: AgentRunActivity
  usage?: AgentRunUsage
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt])
  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt)
  return (
    <div className={cn('text-muted-foreground flex items-center gap-2 py-2 text-xs', className)} aria-live="polite">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span className="font-medium">{activityLabel(activity)}</span>
      {activity?.detail ? <span className="max-w-64 min-w-0 truncate opacity-75">{activity.detail}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
        <span aria-label="Elapsed time">{formatElapsed(elapsed)}</span>
        {usage && usage.total > 0 ? <span aria-label="Tokens used">{formatTokenCount(usage.total)} tokens</span> : null}
      </span>
    </div>
  )
}

/** Tracks when the current run began: set when `isBusy` turns on, cleared when it turns off. */
export function useRunStartedAt(isBusy: boolean): number | null {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  useEffect(() => {
    if (isBusy) setStartedAt((prev) => prev ?? Date.now())
    else setStartedAt(null)
  }, [isBusy])
  return startedAt
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

/** Formats a token count compactly (e.g. 1234 → "1.2k"). */
export function formatTokenCount(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}
