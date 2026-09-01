import {type SessionContinuationLink, type SessionEvent, type SessionInfo} from './client'
import {type ChatToolPart} from './chat-parts'
import {Markdown} from './markdown'
import {formatTokenCount} from './agent-run-status'
import {useOpenAgentSession} from './open-session-context'
import {Button} from '@shm/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {cn} from '@shm/ui/utils'
import {ArrowRight, ChevronDown, ChevronRight, CornerLeftUp, GitBranch, Info, Split} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

/**
 * Session continuation, as the surfaces show it.
 *
 * A continuation is the agent carrying a conversation into a fresh session: the predecessor keeps
 * its whole transcript and ends with a transition card; the successor opens with a banner naming
 * where it came from and a handoff card (the exact projection the model started from); and a
 * client that was following the predecessor's turn moves to the successor on its own. Everything
 * here is a view over durable state — the `continuedFrom`/`continuedTo` links on SessionInfo, the
 * `continue_session` tool row, and the projection message — so a reload shows the same story.
 */

export const CONTINUATION_REASON_LABELS: Record<string, string> = {
  topic_change: 'New topic',
  phase_change: 'New phase',
  refocus: 'Refocused',
  context_pressure: 'Context was full',
  user_request: 'Requested',
  other: 'Continued',
}

/** The reason as a parenthetical, or nothing when there is nothing specific to say (`other`). */
export function continuationReasonLabel(reason: string | undefined): string | undefined {
  if (!reason || reason === 'other') return undefined
  const label = CONTINUATION_REASON_LABELS[reason]
  return label ? `(${label})` : undefined
}

// ---------------------------------------------------------------------------------------------
// Context usage
// ---------------------------------------------------------------------------------------------

/**
 * How full the model's context was on the session's last completed turn: the prompt size stamped
 * on the newest assistant message (input plus cache reads and writes — the whole prompt as the
 * provider counted it). Undefined until a turn has completed.
 */
export function sessionContextTokens(events: SessionEvent[] | undefined): number | undefined {
  if (!events) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]!.event as {
      type?: string
      role?: string
      meta?: {usage?: {input: number; cacheRead: number; cacheWrite: number}}
    }
    if (payload.type !== 'message' || payload.role !== 'assistant') continue
    const usage = payload.meta?.usage
    if (!usage) continue
    return usage.input + usage.cacheRead + usage.cacheWrite
  }
  return undefined
}

/** Fractions at which the meter changes tone; mirrors the runtime's own pressure thresholds. */
const CONTEXT_WARN_FRACTION = 0.7
const CONTEXT_URGENT_FRACTION = 0.85

/**
 * The context meter: a small pie showing how much of the model's window the last turn used.
 * Muted while there is room, amber as it nears the point where the agent should continue, red
 * when it is nearly full. Just the pie — the exact tokens and percentage live in its hover
 * tooltip. Renders nothing until there is a measurement.
 */
export function ContextUsageMeter({
  tokens,
  contextWindow,
  size = 18,
  className,
}: {
  tokens: number | undefined
  contextWindow: number | undefined
  size?: number
  className?: string
}) {
  if (tokens === undefined || !contextWindow) return null
  const fraction = Math.max(0, Math.min(1, tokens / contextWindow))
  const percent = Math.round(fraction * 100)
  const tone =
    fraction >= CONTEXT_URGENT_FRACTION
      ? 'text-destructive'
      : fraction >= CONTEXT_WARN_FRACTION
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground'
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const label = `Context: ${formatTokenCount(tokens)} of ${formatTokenCount(contextWindow)} tokens used (${percent}%)`
  return (
    <span
      className={cn('inline-flex shrink-0 items-center', tone, className)}
      title={label}
      aria-label={label}
      role="img"
    >
      <svg width={size} height={size} viewBox="0 0 20 20" className="shrink-0">
        <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          strokeLinecap="butt"
          transform="rotate(-90 10 10)"
        />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// The projection message, parsed for display
// ---------------------------------------------------------------------------------------------

/** The successor's opening message, split into the parts the handoff card shows. */
export type ContinuationProjectionView = {
  originSessionId?: string
  predecessorSessionId?: string
  predecessorTitle?: string
  continuationId?: string
  initiatingSeq?: number
  reason?: string
  /** The agent-authored handoff, as markdown. */
  handoffMarkdown: string
  /** The cited and runtime-selected sources, one per line. */
  sources: string[]
  /** Loaded excerpts of the predecessor, verbatim as the model saw them. */
  excerpts: string
  /** The whole message, for the raw view. */
  raw: string
}

const PROJECTION_OPEN = '<session_continuation>'

/** Whether a message is a continuation projection (the runtime's opening message in a successor). */
export function isContinuationProjection(content: string | undefined): boolean {
  return typeof content === 'string' && content.trimStart().startsWith(PROJECTION_OPEN)
}

function attr(block: string, tag: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*?\\b${name}="([^"]*)"`))
  return match ? match[1]!.replace(/&quot;/g, '"') : undefined
}

function inner(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`))
  return match ? unescapeFraming(match[1]!) : undefined
}

/**
 * The runtime escapes `<` in model-authored text it hands back inside a frame (so a handoff line
 * cannot close the frame early); the reader wants the text as written.
 */
function unescapeFraming(text: string): string {
  return text.replace(/\\u003c/g, '<')
}

/** Parses a projection message into its parts; tolerant of anything it does not recognize. */
export function parseContinuationProjection(content: string): ContinuationProjectionView {
  const lineage = inner(content, 'session_continuation') ?? ''
  const initiatingSeq = Number(attr(lineage, 'initiating_event', 'seq'))
  const handoff = inner(content, 'handoff') ?? ''
  const sourcesBlock = inner(content, 'sources') ?? ''
  const sources = sourcesBlock
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
  const excerptStart = content.search(/<(excerpt|recent_exchanges)\b/)
  return {
    originSessionId: attr(lineage, 'origin', 'session'),
    predecessorSessionId: attr(lineage, 'predecessor', 'session'),
    predecessorTitle: attr(lineage, 'predecessor', 'title') || undefined,
    continuationId: attr(lineage, 'predecessor', 'edge'),
    initiatingSeq: Number.isFinite(initiatingSeq) ? initiatingSeq : undefined,
    reason: attr(lineage, 'projection', 'reason'),
    handoffMarkdown: handoff,
    sources,
    excerpts: excerptStart >= 0 ? content.slice(excerptStart) : '',
    raw: content,
  }
}

// ---------------------------------------------------------------------------------------------
// Following a continuation
// ---------------------------------------------------------------------------------------------

/**
 * Moves a client to the successor when the session it is showing gets continued — but only on the
 * TRANSITION, and only for a client that was following the turn.
 *
 * The transition: `continuedTo` was absent when this client loaded the session and then appeared.
 * A session that already had a successor when it was opened is one the person chose to come back
 * to (to read it, or to branch by writing there), and is never redirected — that is what the
 * transition row is for. Following the turn: this client saw the session streaming, or sent the
 * message itself (the send response names the successor directly). Fires once per successor, so
 * Back returns to the predecessor without being redirected again.
 */
export function useFollowContinuation({
  session,
  isStreaming,
  onFollow,
}: {
  session: SessionInfo | undefined
  isStreaming: boolean
  onFollow: (link: SessionContinuationLink) => void
}) {
  const followingRef = useRef(false)
  const followedRef = useRef<string | null>(null)
  /** The successor the session already had when this client first loaded it (null: none). */
  const baselineRef = useRef<{sessionId: string; successorId: string | null} | null>(null)
  const sessionId = session?.id
  const successorId = session?.continuedTo?.sessionId ?? null
  useEffect(() => {
    followingRef.current = false
    followedRef.current = null
    baselineRef.current = null
  }, [sessionId])
  useEffect(() => {
    if (isStreaming) followingRef.current = true
  }, [isStreaming])
  useEffect(() => {
    if (!session) return
    if (baselineRef.current?.sessionId !== session.id) {
      // First sight of this session on this client: whatever successor it has now is history.
      baselineRef.current = {sessionId: session.id, successorId}
      return
    }
    if (!session.continuedTo || !successorId) return
    if (successorId === baselineRef.current.successorId) return
    if (!followingRef.current || followedRef.current === successorId) return
    followedRef.current = successorId
    onFollow(session.continuedTo)
  }, [onFollow, session, successorId])
  return {
    /** Marks this client as following the turn (call when it sends a message). */
    markFollowing: () => {
      followingRef.current = true
    },
    /** Follows a successor the send response named, once. */
    followNow: (link: SessionContinuationLink) => {
      if (followedRef.current === link.sessionId) return
      followedRef.current = link.sessionId
      onFollow(link)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------

/**
 * Banner at the top of a successor session: where it came from, and the way back. The handoff
 * itself is the first card of the transcript, right below.
 */
export function ContinuationHeader({
  link,
  compact,
  onOpenPredecessor,
}: {
  link: SessionContinuationLink
  compact?: boolean
  onOpenPredecessor: () => void
}) {
  return (
    <div
      className={cn('flex flex-none flex-col gap-2', compact ? 'px-3 pt-2' : 'pt-3')}
      aria-label="Continued from a previous session"
    >
      <button
        type="button"
        className="bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground flex max-w-full items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs"
        onClick={onOpenPredecessor}
        title="Back to the previous session"
      >
        <CornerLeftUp className="size-3 flex-none" />
        <span className="min-w-0 break-words">
          Continued from {link.title ? `“${link.title}”` : 'previous session'}
        </span>
      </button>
    </div>
  )
}

/**
 * The handoff as the tool input carries it, in the same markdown shape the runtime compiles into
 * the successor's projection — so the predecessor's card and the successor's card read alike.
 */
export function handoffMarkdownFromArgs(args: Record<string, unknown> | undefined): string {
  const handoff = (args?.handoff ?? {}) as Record<string, unknown>
  const section = (title: string, value: unknown): string[] => {
    if (typeof value === 'string' && value.trim()) return [`## ${title}`, value, '']
    if (Array.isArray(value) && value.length) return [`## ${title}`, ...value.map((item) => `- ${String(item)}`), '']
    return []
  }
  return [
    ...section('Purpose', handoff.purpose),
    ...section('Current request', handoff.currentRequest),
    ...section('Established facts', handoff.establishedFacts),
    ...section('Decisions', handoff.decisions),
    ...section('Open questions', handoff.openQuestions),
    ...section('Next actions', handoff.nextActions),
    ...section('Cautions', handoff.cautions),
  ].join('\n')
}

/** The cited sources as the tool input carries them, one line each, as the projection lists them. */
export function sourceLinesFromArgs(args: Record<string, unknown> | undefined): string[] {
  const sources = Array.isArray(args?.sources) ? (args!.sources as Array<Record<string, unknown>>) : []
  return sources.map((source) => {
    const where =
      source.kind === 'resource'
        ? `resource ${String(source.url ?? '')}`
        : source.kind === 'memory'
          ? `memory ${String(source.path ?? '')}`
          : source.kind === 'session_event'
            ? `thread seq ${String(source.seq ?? '')}`
            : `thread seq ${String(source.fromSeq ?? '')}–${String(source.toSeq ?? '')}`
    return `${where} — ${String(source.relevance ?? '')}`
  })
}

/** One rendering of a handoff for both ends of the edge: the markdown, then the source list. */
export function HandoffBody({handoffMarkdown, sources}: {handoffMarkdown: string; sources: string[]}) {
  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div className="bg-background/70 max-h-96 shrink-0 overflow-auto rounded-md border px-3 py-2 text-xs [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:tracking-[0.12em] [&_h2]:uppercase [&_h2:first-child]:mt-0">
        <Markdown>{handoffMarkdown}</Markdown>
      </div>
      {sources.length ? (
        <div>
          <div className="text-muted-foreground mb-1 text-[10px] font-medium tracking-[0.18em] uppercase">Sources</div>
          <ul className="bg-background/70 rounded-md border px-3 py-2 text-xs">
            {sources.map((source, index) => (
              <li key={index} className="py-0.5 break-all">
                {source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The transition row that ends a predecessor's transcript: the `continue_session` call, rendered
 * as where the conversation went. It reads like a tool row — chevron, one line, a hover info
 * bubble — but stands on its own, because it is a bigger event than any tool call. Expanding
 * shows the handoff; the info bubble opens every detail. A refused call keeps error styling.
 */
export function ContinuationTransitionCard({
  item,
  onOpenSuccessor,
  onInspect,
}: {
  item: ChatToolPart
  onOpenSuccessor?: (sessionId: string) => void
  /** Opens the full-details dialog (owned by the transcript renderer, which has the event metadata). */
  onInspect?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const args = item.args
  const output = (item.rawOutput ?? {}) as {successorSessionId?: string; title?: string}
  const title = String(args?.title ?? output.title ?? 'a new session')
  const reason = typeof args?.reason === 'string' ? args.reason : undefined
  const reasonLabel = continuationReasonLabel(reason)
  const isPending = item.result === undefined && item.rawOutput === undefined
  const successorId = output.successorSessionId
  return (
    <div
      className={cn(
        'group/controw @container my-1.5 mr-6 rounded-lg border px-2 py-1.5 text-xs',
        item.isError
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40',
      )}
    >
      {/* The whole line toggles the handoff; inner buttons stop propagation. The line WRAPS —
          a title must stay readable in the panel's width, not fit or vanish. */}
      <div
        className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 select-none"
        onClick={() => setExpanded((current) => !current)}
      >
        <button
          type="button"
          title={expanded ? 'Hide handoff' : 'Show handoff'}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((current) => !current)
          }}
          className="hover:bg-background/70 rounded p-0.5"
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <Split
          className={cn(
            'size-3.5 shrink-0',
            item.isError ? 'text-destructive' : 'text-violet-700 dark:text-violet-300',
          )}
        />
        <span className="min-w-0 text-sm font-medium break-words">
          {item.isError ? 'Continuation refused' : isPending ? 'Continuing in' : 'Continued in'} “{title}”
        </span>
        {/* The reason is a garnish: hidden where the row is too narrow to carry it. */}
        {reasonLabel ? (
          <span className="text-muted-foreground hidden shrink-0 @[26rem]:inline">{reasonLabel}</span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {successorId && onOpenSuccessor ? (
            <Button
              size="sm"
              variant="default"
              onClick={(event) => {
                event.stopPropagation()
                onOpenSuccessor(successorId)
              }}
            >
              Open session
              <ArrowRight className="ml-1 size-3.5" />
            </Button>
          ) : null}
          <button
            type="button"
            title="View every detail of this handoff"
            onClick={(event) => {
              event.stopPropagation()
              onInspect?.()
            }}
            className="hover:bg-background/70 text-muted-foreground hover:text-foreground bg-background/60 rounded-full border p-0.75 opacity-0 transition-opacity group-hover/controw:opacity-100 focus-visible:opacity-100"
          >
            <Info className="size-3" />
          </button>
        </div>
      </div>
      {item.isError && item.result ? (
        <pre className="text-destructive mt-1 whitespace-pre-wrap">{item.result}</pre>
      ) : null}
      {expanded ? (
        <div className="mt-2 border-t pt-2">
          <HandoffBody handoffMarkdown={handoffMarkdownFromArgs(args)} sources={sourceLinesFromArgs(args)} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * The handoff row that opens a successor's transcript: the projection the model started from,
 * in place of the raw `<session_continuation>` text. Same shape as the transition row on the
 * other end — chevron, one line, a hover info bubble — because it is the same event seen from
 * here. Expanding shows the handoff; the info bubble opens every detail, lineage and excerpts
 * included.
 */
export function ContinuationHandoffCard({
  projection,
  compact,
  onOpenPredecessor,
  id,
}: {
  projection: ContinuationProjectionView
  compact?: boolean
  onOpenPredecessor?: (sessionId: string) => void
  id?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const predecessorId = projection.predecessorSessionId
  const reasonLabel = continuationReasonLabel(projection.reason)
  return (
    <div
      id={id}
      className={cn(
        'group/controw @container my-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs dark:border-violet-900 dark:bg-violet-950/40',
        compact ? '' : 'mr-6',
      )}
    >
      {/* The whole line toggles the handoff and WRAPS; inner buttons stop propagation. */}
      <div
        className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 select-none"
        onClick={() => setExpanded((current) => !current)}
      >
        <button
          type="button"
          title={expanded ? 'Hide handoff' : 'Show handoff'}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((current) => !current)
          }}
          className="hover:bg-background/70 rounded p-0.5"
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <GitBranch className="size-3.5 shrink-0 text-violet-700 dark:text-violet-300" />
        <span className="min-w-0 text-sm font-medium break-words">
          Handoff from {projection.predecessorTitle ? `“${projection.predecessorTitle}”` : 'the previous session'}
        </span>
        {reasonLabel ? (
          <span className="text-muted-foreground hidden shrink-0 @[26rem]:inline">{reasonLabel}</span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {predecessorId && onOpenPredecessor ? (
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                onOpenPredecessor(predecessorId)
              }}
            >
              <CornerLeftUp className="mr-1 size-3.5" />
              Open session
            </Button>
          ) : null}
          <button
            type="button"
            title="View every detail of this handoff"
            onClick={(event) => {
              event.stopPropagation()
              setDetailsOpen(true)
            }}
            className="hover:bg-background/70 text-muted-foreground hover:text-foreground bg-background/60 rounded-full border p-0.75 opacity-0 transition-opacity group-hover/controw:opacity-100 focus-visible:opacity-100"
          >
            <Info className="size-3" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-2 border-t pt-2">
          <HandoffBody handoffMarkdown={projection.handoffMarkdown} sources={projection.sources} />
        </div>
      ) : null}
      <ContinuationProjectionDialog projection={projection} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </div>
  )
}

/**
 * Every detail of a successor's starting point: the lineage (origin, predecessor, edge, the
 * initiating message's seq), the handoff and sources, the exact excerpts that were loaded, and
 * the raw projection text the model was given. The decision's own metadata — model, tokens,
 * timing — lives on the predecessor's transition row, where the decision was made.
 */
function ContinuationProjectionDialog({
  projection,
  open,
  onOpenChange,
}: {
  projection: ContinuationProjectionView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const lineage: Array<[string, string | undefined]> = [
    ['Origin session', projection.originSessionId],
    ['Predecessor session', projection.predecessorSessionId],
    ['Continuation', projection.continuationId],
    ['Initiating message', projection.initiatingSeq !== undefined ? `seq ${projection.initiatingSeq}` : undefined],
    ['Reason', projection.reason],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>
            Handoff from {projection.predecessorTitle ? `“${projection.predecessorTitle}”` : 'the previous session'}
          </DialogTitle>
          <DialogDescription>
            What this session started from — the projection, exactly as the model received it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Lineage</div>
            <div className="bg-muted grid gap-x-4 gap-y-1 rounded-md p-2 sm:grid-cols-2">
              {lineage
                .filter((row): row is [string, string] => !!row[1])
                .map(([label, value]) => (
                  <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className="min-w-0 text-right font-medium break-all" title={value}>
                      {value}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          <HandoffBody handoffMarkdown={projection.handoffMarkdown} sources={projection.sources} />
          {projection.excerpts ? (
            <div className="space-y-1">
              <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                Loaded excerpts
              </div>
              <pre className="bg-muted max-h-64 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
                {projection.excerpts}
              </pre>
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Projection</div>
            <pre className="bg-muted max-h-64 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {projection.raw}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Small chip on a user message a continuation replayed: it is the user's own words, carried over. */
export function ContinuedMessageChip({
  continuedFrom,
  serverUrl,
}: {
  continuedFrom: {sessionId: string; eventId: string}
  serverUrl?: string
}) {
  const openSession = useOpenAgentSession()
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 text-[10px]"
      onClick={() => openSession({sessionId: continuedFrom.sessionId, serverUrl})}
      title="This message was carried over from the previous session"
    >
      <CornerLeftUp className="size-3" />
      From previous session
    </button>
  )
}

/** The chip a session list shows on a predecessor: where it went. */
export function ContinuedListChip({link}: {link: SessionContinuationLink}) {
  return (
    <span className="bg-muted text-muted-foreground mt-2 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs">
      <Split className="size-3 flex-none" />
      <span className="min-w-0 truncate">Continued in {link.title ? `“${link.title}”` : 'a new session'}</span>
    </span>
  )
}
