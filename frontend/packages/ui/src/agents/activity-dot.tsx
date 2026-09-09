import {cn} from '../utils'

/** Which of the three indicator colors an agent activity summary resolves to. */
export type AgentActivityTone = 'agent' | 'user' | 'busy'

/**
 * What the agents entry point should show about recent activity, or null for nothing. Computed
 * by `summarizeAgentActivity` in ./activity; kept here, import-light, so the site header can
 * render the dot without pulling the agents models into the initial bundle.
 */
export type AgentActivityIndicator = {
  tone: AgentActivityTone
  /** True for an unread message (agent or user tone); false while merely busy. */
  unread: boolean
  serverUrl: string
  agentId: string
  agentName: string
  sessionId: string
  /** One sentence for tooltips and screen readers, e.g. "Researcher replied". */
  label: string
}

const TONE_CLASS: Record<AgentActivityTone, string> = {
  agent: 'bg-red-500',
  user: 'bg-blue-500',
  busy: 'bg-amber-500 animate-pulse',
}

/**
 * The small colored dot on an agents entry point: red for an unread agent reply, blue for an
 * unread message from a person or a trigger, pulsing amber while an agent is working. Positioned
 * like the notifications bell's dot; the parent must be `relative`.
 */
export function AgentActivityDot({
  indicator,
  className,
}: {
  indicator: AgentActivityIndicator | null | undefined
  className?: string
}) {
  if (!indicator) return null
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="agent-activity-dot"
        data-tone={indicator.tone}
        className={cn('absolute top-1 right-1 size-2 rounded-full', TONE_CLASS[indicator.tone], className)}
      />
      <span className="sr-only">{indicator.label}</span>
    </>
  )
}

/**
 * The same colored dot inline, for a list row that has something unread (or an agent that is
 * working): sits in the flow next to a name rather than on a button's corner.
 */
export function AgentActivityMark({
  tone,
  label,
  className,
}: {
  tone: AgentActivityTone | null | undefined
  /** Screen-reader text; the tooltip, if any, is the caller's. */
  label?: string
  className?: string
}) {
  if (!tone) return null
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="agent-activity-mark"
        data-tone={tone}
        className={cn('inline-block size-2 shrink-0 rounded-full', TONE_CLASS[tone], className)}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  )
}
