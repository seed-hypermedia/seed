import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import type {SessionActor, SessionAttachmentInfo, SessionEventMeta} from './client'

/** A streamed or persisted tool invocation attached to an assistant message. */
export type ChatToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

/** A streamed or persisted tool result attached to an assistant message. */
export type ChatToolResult = {
  id: string
  name: string
  result: string
  rawOutput?: unknown
  isError?: boolean
}

/** A markdown text fragment within an assistant message. */
export type ChatTextPart = {
  type: 'text'
  text: string
}

/**
 * The child a `delegate` call spawned, known from the moment it exists (the `tool_spawn` event).
 * A model child has a session; a script child has only its run.
 */
export type ChatToolChild = {
  runId: string
  sessionId?: string
  title?: string
}

/** A tool item within an assistant message, optionally updated with a result later. */
export type ChatToolPart = {
  type: 'tool'
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  rawOutput?: unknown
  /**
   * The child this delegation is parked on, stamped durably when it spawned — so the row is a way
   * into the child's work for its whole life, not only once its result has come back.
   */
  child?: ChatToolChild
  /**
   * When the agent set out on this step: the stamp of the event just before the call on the log
   * (the previous result, or the message that started the turn). The step's time is measured
   * from here, so it counts the model's deliberation as well as the tool's own run.
   */
  stepStartedAt?: number
  /** Durable timestamp of the call event — when the tool was invoked. */
  calledAt?: number
  /** Sequence of the call event, so a truncated input can be fetched whole with GetSessionEvent. */
  callSeq?: number
  /** The call event's payload was wire-truncated; `args` is a preview of the durable input. */
  callTruncated?: boolean
  /** Sequence of the result event, so a truncated output can be fetched whole with GetSessionEvent. */
  resultSeq?: number
  /** The result event's payload was wire-truncated; `rawOutput` is a preview of the durable output. */
  resultTruncated?: boolean
  /** Durable timestamp of the result event; the row itself stays positioned at the call event. */
  completedAt?: number
  /** The result was an error (validation failure, tool crash) — `result` holds the message. */
  isError?: boolean
  /** Who ran the tool. The log is shared: 'user' marks verbs the user ran themselves. */
  actor?: 'user' | 'agent' | 'system' | 'trigger'
  /**
   * What the log knows about this call's cost and timing. Stamped by the runtime on the result
   * event; on transcripts older than that stamp the duration is derived from the call and result
   * event timestamps instead, which is the same wall time measured from the other side.
   */
  meta?: SessionEventMeta
  /**
   * Display label that outranks the derived summary — a workflow's own description of what a
   * journaled call was doing ("Checking the pricing page"), with the tool name as secondary.
   */
  summaryOverride?: string
}

/** Ordered assistant message content used to interleave text and tool activity. */
export type ChatMessagePart = ChatTextPart | ChatToolPart

/**
 * One message as the chat surfaces read it.
 *
 * This is a data shape, not a rendering concern, so it lives beside the other chat data types
 * rather than in the web renderer: the row model (`agent-session-rows`) and the React Native
 * client both need it without pulling in a DOM component library.
 */
export type ChatBubbleMessage = {
  role?: string
  content?: string
  parts?: ChatMessagePart[]
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>
  toolResults?: Array<{id: string; name: string; result: string; rawOutput?: unknown}>
  errorMessage?: string
  rawMarkdown?: string
  blocks?: HMBlockNode[]
  eventId?: string
  sessionId?: string
  seq?: number
  shareUrl?: string
  /** Client context (e.g. the sender's current window) attached to this message for the model. */
  contextLines?: string[]
  /** Session-private attachments that accompanied this user message. */
  attachments?: SessionAttachmentInfo[]
  /**
   * Who wrote this message on the shared log. `role` says how the model reads it; this says who put
   * it there — and they disagree exactly where it matters, on the runtime's own messages, which the
   * model must read as instruction (role 'user') and the reader must not mistake for the user.
   */
  actor?: SessionActor
  /** User origin or model/provider/usage/timing, as the writer stamped it. */
  meta?: SessionEventMeta
  /** Durable timestamp of the message event — when it was appended to the log. */
  createdAt?: number
}

/** Appends streamed text while coalescing adjacent text fragments into one part. */
export function appendChatTextPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  if (!delta) return parts

  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), {type: 'text', text: lastPart.text + delta}]
  }

  return [...parts, {type: 'text', text: delta}]
}

/** Appends tool calls at their observed position in the assistant response stream. */
export function appendChatToolCalls(parts: ChatMessagePart[], toolCalls: ChatToolCall[]): ChatMessagePart[] {
  if (toolCalls.length === 0) return parts

  return [
    ...parts,
    ...toolCalls.map((toolCall) => ({
      type: 'tool' as const,
      id: toolCall.id,
      name: toolCall.name,
      args: toolCall.args,
    })),
  ]
}

/** Merges tool results into existing tool parts without changing their position. */
export function applyChatToolResults(parts: ChatMessagePart[], toolResults: ChatToolResult[]): ChatMessagePart[] {
  if (toolResults.length === 0) return parts

  const resultsById = new Map(toolResults.map((toolResult) => [toolResult.id, toolResult]))
  const seenResults = new Set<string>()

  const nextParts = parts.map((part) => {
    if (part.type !== 'tool') return part

    const toolResult = resultsById.get(part.id)
    if (!toolResult) return part

    seenResults.add(toolResult.id)
    return {...part, result: toolResult.result, rawOutput: toolResult.rawOutput, isError: toolResult.isError}
  })

  for (const toolResult of toolResults) {
    if (seenResults.has(toolResult.id)) continue

    nextParts.push({
      type: 'tool',
      id: toolResult.id,
      name: toolResult.name,
      result: toolResult.result,
      rawOutput: toolResult.rawOutput,
    })
  }

  return nextParts
}

/** Builds a best-effort ordered part list for legacy assistant messages that predate `parts`. */
export function buildLegacyChatMessageParts(input: {
  content?: string
  toolCalls?: ChatToolCall[]
  toolResults?: ChatToolResult[]
}): ChatMessagePart[] {
  let parts: ChatMessagePart[] = []

  parts = appendChatToolCalls(parts, input.toolCalls || [])
  parts = applyChatToolResults(parts, input.toolResults || [])

  if (input.content) {
    parts = appendChatTextPart(parts, input.content)
  }

  return parts
}

/** A tool part still waiting on its result. */
export function isPendingToolPart(part: ChatToolPart): boolean {
  return part.result === undefined && part.rawOutput === undefined
}

/**
 * Whether a part belongs in the collapsible "Thinking" line: ordinary tool activity by the agent
 * (or the runtime on its behalf). Status updates, continuation handoffs, and verbs the user ran
 * themselves are things the reader is meant to see, so they stay out and split a group.
 */
export function isThinkingToolPart(part: ChatMessagePart): part is ChatToolPart {
  return part.type === 'tool' && part.name !== 'status' && part.name !== 'continue_session' && part.actor !== 'user'
}

/** One render unit of an assistant message: a burst of thinking tool calls, or a single part. */
export type ChatMessageRenderItem =
  | {kind: 'thinking'; parts: ChatToolPart[]}
  | {kind: 'part'; part: ChatMessagePart; index: number}

/** Folds consecutive thinking tool parts into one group, keeping every other part on its own. */
export function groupThinkingParts(parts: ChatMessagePart[]): ChatMessageRenderItem[] {
  const items: ChatMessageRenderItem[] = []
  parts.forEach((part, index) => {
    if (isThinkingToolPart(part)) {
      const previous = items[items.length - 1]
      if (previous?.kind === 'thinking') previous.parts.push(part)
      else items.push({kind: 'thinking', parts: [part]})
      return
    }
    items.push({kind: 'part', part, index})
  })
  return items
}

/**
 * When a settled burst of thinking ended: the latest result on the log, or a call's own duration
 * stamp when the result event is missing. Undefined on transcripts with no timing at all.
 */
export function thinkingGroupCompletedAt(parts: ChatToolPart[]): number | undefined {
  let latest: number | undefined
  for (const part of parts) {
    const completedAt =
      part.completedAt ??
      (part.calledAt !== undefined && part.meta?.durationMs !== undefined
        ? part.calledAt + part.meta.durationMs
        : undefined)
    if (completedAt !== undefined && (latest === undefined || completedAt > latest)) latest = completedAt
  }
  return latest
}

/**
 * How long a step took, from the moment the agent set out on it (`stepStartedAt`, falling back to
 * the call itself) to its result — or to `now` while it is still running. Undefined on a
 * transcript with no timing to go on.
 */
export function toolStepDurationMs(part: ChatToolPart, now?: number): number | undefined {
  const startedAt = part.stepStartedAt ?? part.calledAt
  if (startedAt === undefined) return undefined
  const endedAt = isPendingToolPart(part)
    ? now
    : part.completedAt ??
      (part.calledAt !== undefined && part.meta?.durationMs !== undefined
        ? part.calledAt + part.meta.durationMs
        : undefined)
  if (endedAt === undefined) return undefined
  return Math.max(0, endedAt - startedAt)
}
