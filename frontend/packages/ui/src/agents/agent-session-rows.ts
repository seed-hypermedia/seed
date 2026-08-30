import {
  type AgentSessionTriggerContext,
  type RunInfo,
  type RunPlan,
  type SessionAttachmentInfo,
  type SessionEvent,
  type SessionEventMeta,
  type SessionEventPayload,
} from './client'
import {type ChatBubbleMessage} from './chat-parts'
import {type ChatToolChild, type ChatToolPart} from './chat-parts'
import {sessionEventActor} from '@seed-hypermedia/agents-protocol'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

/**
 * Turns a session's durable event log into renderable chat rows.
 *
 * Extracted from the Agents session page so the assistant sidebar renders identical transcripts from
 * the same events — the sidebar is a session view like any other, just narrower. Kept free of React
 * and of data fetching so it stays directly unit-testable.
 */

/** One rendered row of an agent session transcript. */
export type AgentSessionChatRow =
  | {
      key: string
      kind: 'message'
      message: ChatBubbleMessage
      createdAt?: number
      triggerContext?: AgentSessionTriggerContext
      triggerInstructions?: string
    }
  | {key: string; kind: 'error'; message: string; createdAt?: number}
  | {key: string; kind: 'raw'; event: SessionEvent; createdAt?: number}
  | {
      key: string
      kind: 'run-record'
      run: RunInfo
      /**
       * The checklist this card must render, when it is not the run's own. A model-driven agent run
       * keeps its plan on the session, so freezing the run without carrying the plan across would
       * put a card in the log with the story missing from it.
       */
      plan?: RunPlan
      createdAt?: number
    }

/** Statuses a run can no longer leave (mirrored from the run card; kept dependency-free here). */
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

/** Step statuses a plan step can no longer leave — done, written off, or given up on. */
const TERMINAL_STEP_STATUSES = new Set(['done', 'failed', 'skipped'])

/**
 * Whether a run deserves its own record row in the transcript: it orchestrated something — a
 * workflow, spawned children, or a step plan. A plain chat turn's story is its messages.
 *
 * `plan` is the checklist the card would actually render, which is not always the run's own: a
 * model-driven agent run never carries one (`RunInfo.plan` is written by the workflow host alone),
 * and its checklist lives on the session. The pinned card resolves the same way — `root.plan ??
 * sessionPlan` — so both surfaces agree on what counts as an orchestration.
 */
function isOrchestrationRecord(run: RunInfo, plan?: RunPlan): boolean {
  return run.kind === 'workflow' || (run.childRunCount ?? 0) > 0 || (plan?.steps.length ?? 0) > 0
}

/** A plan with steps, none of which can move again. An empty plan has settled nothing. */
function isPlanFullySettled(plan: RunPlan | undefined): boolean {
  if (!plan?.steps.length) return false
  return plan.steps.every((step) => TERMINAL_STEP_STATUSES.has(step.status))
}

/**
 * A moment in the log where a run's story could have finished being told.
 *
 * A delivered typed result or delegation result closes the orchestration it represents. The plan
 * verb deliberately writes no tool rows — the checklist is session state, rendered as the card
 * rather than as conversation — so the server stamps `RunPlan.settledAt` for that path instead.
 */
type SettleMarker = {kind: 'typed-result' | 'delegation-result'; at: number}

function settleMarkers(rows: AgentSessionChatRow[]): SettleMarker[] {
  const markers: SettleMarker[] = []
  for (const row of rows) {
    if (row.kind !== 'message' || row.createdAt === undefined) continue
    for (const part of row.message.parts ?? []) {
      if (part.type !== 'tool') continue
      const completedAt = part.completedAt ?? row.createdAt
      if (part.name === 'return_result' && !part.isError && (part.result !== undefined || part.rawOutput)) {
        markers.push({kind: 'typed-result', at: completedAt})
      }
      if (
        (part.name === 'delegate' || part.name === 'sub_session' || part.name === 'run_workflow') &&
        (part.result !== undefined || part.rawOutput)
      ) {
        markers.push({kind: 'delegation-result', at: completedAt})
      }
    }
  }
  return markers
}

/** Whether a log moment belongs to this run's lifetime, so its marker can speak for that run. */
function runOwnsMoment(run: RunInfo, at: number): boolean {
  return at >= (run.startedAt ?? run.createdAt) && (run.finishedAt === undefined || at <= run.finishedAt)
}

/**
 * When a run's story stopped changing, or `undefined` while it is still being told.
 *
 * A run ending is the obvious answer, and was for a long time the only one — but it is not the only
 * moment a story completes. A run whose every plan step has settled, or that has delivered the typed
 * result it was spawned to deliver, has said everything it came to say; whatever it does afterwards
 * (a closing summary, a final tool call) belongs to the conversation, not to the card. Freezing at
 * that moment is what lets the card leave the pinned slot mid-session instead of hovering, complete
 * and unchanging, above the composer.
 *
 * Every answer here is a durable timestamp that never moves again — the run's own finish, the
 * server's `settledAt` stamp, or the log position of the result row. Nothing is anchored to
 * `updatedAt`, which advances with every heartbeat and would drag a frozen card down the scroll for
 * as long as its run lived. A settled plan the server never stamped (a workflow plan predating the
 * field) therefore stays pinned: no honest moment, no freeze.
 *
 * Only orchestrations freeze: a plain turn's story is its messages, and always was.
 */
export function runStoryFrozenAt(
  run: RunInfo,
  context: {markers?: SettleMarker[]; plan?: RunPlan} = {},
): number | undefined {
  const {markers = [], plan} = context
  // A server-stamped session plan still belongs to its run after that run finishes. Prefer the
  // plan's settle moment so its completed checklist lands before the closing assistant answer,
  // rather than using finishedAt (which is necessarily a few milliseconds after that answer).
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    const ownedPlan = plan?.ownerRunId === run.id ? plan : run.plan
    if (!isOrchestrationRecord(run, ownedPlan)) return undefined
    if (ownedPlan?.ownerRunId === run.id && isPlanFullySettled(ownedPlan) && ownedPlan.settledAt !== undefined) {
      return ownedPlan.settledAt
    }
    const delegationResult = markers
      .filter((marker) => marker.kind === 'delegation-result' && runOwnsMoment(run, marker.at))
      .at(-1)
    return delegationResult?.at ?? run.finishedAt ?? run.updatedAt
  }
  // A parked run is the one thing on screen that may be waiting on YOU — for an answer, for a
  // budget. Whatever its checklist says, that story is not over, and the place to answer it is the
  // pinned slot above the composer, not somewhere up the scroll.
  if (run.status === 'waiting') return undefined
  if (!isOrchestrationRecord(run, plan)) return undefined
  const typedResult = markers.filter((marker) => marker.kind === 'typed-result' && runOwnsMoment(run, marker.at)).at(-1)
  if (typedResult) return typedResult.at
  return isPlanFullySettled(plan) ? plan?.settledAt : undefined
}

/**
 * Places each run's record card into the transcript at the moment its story stopped changing.
 *
 * This is the second half of the pinned card's contract: while a run's story is still being told it
 * is pinned above the composer; once the story is complete — the run ended, its plan fully settled,
 * or its typed result landed — the same card joins the chat log after the last event that predates
 * that moment, which for the newest run is the bottom of the log. Runs still telling their story are
 * skipped (the pinned card owns them), as are plain turns.
 *
 * `sessionPlan` is the session's own checklist, which is where a model-driven agent's plan lives. It
 * belongs to the newest run — the same run the pinned card would show it on — so only that run may
 * settle by it.
 */
export function interleaveRunRecords(
  rows: AgentSessionChatRow[],
  runs: RunInfo[],
  sessionPlan?: RunPlan,
): AgentSessionChatRow[] {
  const markers = settleMarkers(rows)
  const records = runs
    .flatMap((run, index) => {
      // New plans name their owning run, so the completed checklist stays with the correct turn
      // after it ends. Legacy unstamped plans retain the old live-newest fallback, but are never
      // lent to a finished run where ownership would only be a guess.
      const ownsSessionPlan = sessionPlan?.ownerRunId === run.id
      const borrowsLegacyLivePlan =
        index === 0 && !TERMINAL_RUN_STATUSES.has(run.status) && !run.plan && !sessionPlan?.ownerRunId
      const borrowsSessionPlan = !run.plan && (ownsSessionPlan || borrowsLegacyLivePlan)
      const plan = borrowsSessionPlan ? sessionPlan : run.plan
      const frozenAt = runStoryFrozenAt(run, {markers, plan})
      if (frozenAt === undefined) return []
      // Carried onto the row only when it is the settled checklist the card exists to show.
      const carried = borrowsSessionPlan && isPlanFullySettled(plan) ? plan : undefined
      return [{run, frozenAt, plan: carried}]
    })
    .sort((a, b) => a.frozenAt - b.frozenAt)
  if (!records.length) return rows
  const result = [...rows]
  for (const {run, frozenAt, plan} of records) {
    let index = result.length
    // Insert after the last row that predates the freeze; rows without timestamps keep their place.
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const at = result[i]?.createdAt
      if (at !== undefined && at <= frozenAt) {
        index = i + 1
        break
      }
      if (at !== undefined) index = i
    }
    result.splice(index, 0, {key: `run-${run.id}`, kind: 'run-record', run, plan, createdAt: frozenAt})
  }
  return result
}

/**
 * The runs whose card already lives in the transcript, so no surface repeats them.
 *
 * The pinned slot reads this: a run frozen into the log is told there and only there, even while it
 * is still running. Two copies of one card — one pinned, one in the scroll — is the same story told
 * twice, and the pinned one is the copy that has stopped meaning anything.
 */
export function frozenRunIds(rows: AgentSessionChatRow[]): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) if (row.kind === 'run-record') ids.add(row.run.id)
  return ids
}

/**
 * Whether a durable event arriving over the socket is the server's echo of an optimistic row the
 * user's own send left in the cache — the one case where the pending row must be dropped rather
 * than duplicated.
 *
 * Content equality alone is not enough, because `role: 'user'` no longer means "a person typed
 * this". The runtime writes to the log as a user turn too (continuation prompts, unmet-obligation
 * notices), and those arrive mid-run over the same stream; matching one against a message the user
 * is still waiting on would delete their own words from the transcript. The actor is what separates
 * them, so it is checked first.
 */
export function isOptimisticUserEcho(incoming: SessionEventPayload, optimistic: SessionEventPayload): boolean {
  const arrived = incoming as {
    type?: unknown
    role?: unknown
    content?: unknown
    rawMarkdown?: unknown
    clientMessageId?: unknown
  }
  if (arrived.type !== 'message' || arrived.role !== 'user') return false
  if (sessionEventActor(incoming) !== 'user') return false
  const pending = optimistic as {
    type?: unknown
    role?: unknown
    content?: unknown
    rawMarkdown?: unknown
    clientMessageId?: unknown
  }
  if (pending.type !== 'message' || pending.role !== 'user') return false
  // By identity when the server echoes the id the send stamped — exact regardless of content.
  if (typeof arrived.clientMessageId === 'string' && typeof pending.clientMessageId === 'string') {
    return arrived.clientMessageId === pending.clientMessageId
  }
  // Older servers echo no id; match on `rawMarkdown`, which round-trips verbatim. `content` does
  // not: the server re-serializes the message blocks through its own markdown writer, which
  // disagrees with the client's on multi-paragraph spacing — comparing it would leave the pending
  // row next to its own echo, flashing the message twice.
  if (typeof arrived.rawMarkdown === 'string' && typeof pending.rawMarkdown === 'string') {
    return arrived.rawMarkdown === pending.rawMarkdown
  }
  return pending.content === arrived.content
}

/**
 * The error row a retry may be offered on, if any.
 *
 * Only the transcript's final row qualifies: an error the conversation already moved past is
 * history, and re-running the turn behind it is not what "retry" means there. Nothing is offered
 * while the agent is working either — the server rejects a retry on a live run, so the button would
 * only be a way to get an error message.
 */
export function retryableErrorRowKey(rows: AgentSessionChatRow[], isBusy: boolean): string | undefined {
  if (isBusy) return undefined
  const last = rows[rows.length - 1]
  return last?.kind === 'error' ? last.key : undefined
}

/** Identifies which session the events belong to, for building per-event share links. */
export type AgentSessionRowContext = {
  serverUrl: string
  agentId?: string
  sessionId: string
  triggerContext?: AgentSessionTriggerContext | null
}

/** Removes the `<trigger_context>` / `<trigger_instructions>` blocks appended to a trigger's first message. */
export function stripTriggerContextBlock(content: string): string {
  const index = content.indexOf('<trigger_context>')
  if (index === -1) return content
  return content.slice(0, index).trimEnd()
}

/** Pulls the model-facing `<trigger_instructions>` text out of a trigger's first message, if present. */
export function extractTriggerInstructions(content: string): string | undefined {
  const match = content.match(/<trigger_instructions>\n?([\s\S]*?)\n?<\/trigger_instructions>/)
  const text = match?.[1]?.trim()
  return text ? text : undefined
}

/** Builds the shareable link to a session on its agent server. */
export function buildAgentSessionUrl(
  serverUrl: string,
  agentId: string | undefined,
  sessionId: string,
): string | undefined {
  if (!agentId) return undefined
  return `${serverUrl.replace(/\/+$/, '')}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(
    sessionId,
  )}`
}

/** Builds the deep link to one event, used by the per-message share action. */
export function buildAgentSessionEventUrl(
  serverUrl: string,
  agentId: string | undefined,
  sessionId: string,
  eventId: string,
): string | undefined {
  const sessionUrl = buildAgentSessionUrl(serverUrl, agentId, sessionId)
  return sessionUrl ? `${sessionUrl}#event=${encodeURIComponent(eventId)}` : undefined
}

/** True when the row contains a tool call still waiting for its result (i.e. currently executing). */
export function chatRowHasPendingToolCall(row: AgentSessionChatRow): boolean {
  if (row.kind !== 'message') return false
  return (row.message.parts ?? []).some(
    (part) => part.type === 'tool' && part.result === undefined && part.rawOutput === undefined,
  )
}

/** Parses the `#event=<id>` hash used to focus a shared event. */
export function getSharedEventIdFromHash(hash: string): string | null {
  const match = hash.match(/^#event=(.+)$/)
  return match ? decodeURIComponent(match[1] || '') : null
}

function getToolResultSummary(output: unknown): string {
  if (isRecord(output)) {
    if (typeof output.summary === 'string') return output.summary
    if (typeof output.title === 'string') return output.title
  }
  return 'Complete'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * A tool row's provenance, preferring what the runtime stamped and filling only the gap it left.
 * The call event carries the issuing turn's model/provider/usage, the result event the execution
 * span — one row needs both, with the result's word winning wherever they overlap.
 *
 * Returns nothing at all when nothing is known, so the info dialog can tell "no stats" from "stats
 * that are all blank" — a legacy row with no timings must render no section, not empty labels.
 */
function resolveToolMeta(
  callStamped: SessionEventMeta | undefined,
  resultStamped: SessionEventMeta | undefined,
  derivedDurationMs: number | undefined,
): SessionEventMeta | undefined {
  const durationMs = resultStamped?.durationMs ?? callStamped?.durationMs ?? derivedDurationMs
  if (!callStamped && !resultStamped && durationMs === undefined) return undefined
  return {...callStamped, ...resultStamped, ...(durationMs === undefined ? {} : {durationMs})}
}

/** Converts durable session events into chat rows, pairing tool calls with their results. */
export function buildAgentSessionChatRows(
  events: SessionEvent[],
  context: AgentSessionRowContext,
): AgentSessionChatRow[] {
  const rows: AgentSessionChatRow[] = []
  const toolRowsById = new Map<string, Extract<AgentSessionChatRow, {kind: 'message'}>>()
  let triggerCardAttached = false

  for (const event of events) {
    const payload = event.event as {
      type?: string
      role?: string
      content?: string
      message?: string
      id?: string
      toolCallId?: string
      name?: string
      input?: unknown
      output?: unknown
      error?: string
      rawMarkdown?: string
      blocks?: HMBlockNode[]
      contextLines?: unknown
      attachments?: unknown
      meta?: SessionEventMeta
      /** tool_spawn: the child run and (for a model child) its session. */
      runId?: string
      sessionId?: string
      title?: string
    }

    if (payload.type === 'message' && typeof payload.content === 'string') {
      // The first user message of a triggered session embeds a <trigger_context> block for the model.
      // Hide it from the bubble and surface a friendly trigger card instead; the full text stays
      // available through the raw-markdown dialog.
      const hasTriggerBlock = payload.role === 'user' && payload.content.includes('<trigger_context>')
      const attachTriggerCard = hasTriggerBlock && !triggerCardAttached
      if (attachTriggerCard) triggerCardAttached = true
      const displayContent = hasTriggerBlock ? stripTriggerContextBlock(payload.content) : payload.content
      const triggerInstructions = attachTriggerCard ? extractTriggerInstructions(payload.content) : undefined
      // Client context (e.g. the sidebar's current window) rides on the event as a separate field:
      // it never renders as message text, but the bubble surfaces it behind an info chip so the
      // user can see exactly what the agent was told.
      const contextLines = Array.isArray(payload.contextLines)
        ? payload.contextLines.filter((line): line is string => typeof line === 'string')
        : undefined
      rows.push({
        key: event.id,
        kind: 'message',
        createdAt: event.createdAt,
        message: {
          role: payload.role,
          // Who wrote it, on a log that four kinds of actor write to. Stamped on the message and not
          // only on its tool parts: a message the runtime itself authored (a continuation prompt, an
          // unmet-obligation notice) carries role 'user' so the model reads it as instruction, and
          // without the actor the transcript would show it as something the user typed.
          actor: sessionEventActor(event.event),
          meta: payload.meta,
          createdAt: event.createdAt,
          content: displayContent,
          rawMarkdown: typeof payload.rawMarkdown === 'string' ? payload.rawMarkdown : payload.content,
          blocks: Array.isArray(payload.blocks) ? payload.blocks : undefined,
          contextLines: contextLines?.length ? contextLines : undefined,
          attachments: Array.isArray(payload.attachments)
            ? (payload.attachments as SessionAttachmentInfo[])
            : undefined,
          eventId: event.id,
          sessionId: event.sessionId,
          seq: event.seq,
          shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
        },
        ...(attachTriggerCard && context.triggerContext
          ? {triggerContext: context.triggerContext, triggerInstructions}
          : {}),
      })
      continue
    }

    if (payload.type === 'tool_call' && typeof payload.id === 'string' && typeof payload.name === 'string') {
      const toolPart: ChatToolPart = {
        type: 'tool',
        id: payload.id,
        name: payload.name,
        args: isRecord(payload.input) ? payload.input : {input: payload.input},
        actor: sessionEventActor(event.event),
        calledAt: event.createdAt,
        callSeq: event.seq,
        ...(event.truncated ? {callTruncated: true} : {}),
        ...(payload.meta ? {meta: payload.meta} : {}),
      }
      const row: Extract<AgentSessionChatRow, {kind: 'message'}> = {
        key: event.id,
        kind: 'message',
        createdAt: event.createdAt,
        message: {
          role: 'assistant',
          parts: [toolPart],
          eventId: event.id,
          sessionId: event.sessionId,
          seq: event.seq,
          shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
        },
      }
      rows.push(row)
      toolRowsById.set(payload.id, row)
      continue
    }

    if (payload.type === 'tool_spawn' && typeof payload.toolCallId === 'string' && typeof payload.runId === 'string') {
      // The child's identity, folded onto the call it answers. The call event always lands first
      // (it is appended when the tool starts, the spawn while it runs), but a transcript that lost
      // the call still gets a row: the child exists, and this is the only way into it.
      const child: ChatToolChild = {
        runId: payload.runId,
        ...(typeof payload.sessionId === 'string' ? {sessionId: payload.sessionId} : {}),
        ...(typeof payload.title === 'string' ? {title: payload.title} : {}),
      }
      const existingRow = toolRowsById.get(payload.toolCallId)
      if (existingRow) {
        const existingPart = existingRow.message.parts?.[0] as ChatToolPart | undefined
        existingRow.message = {
          ...existingRow.message,
          parts: [{...(existingPart || {type: 'tool', id: payload.toolCallId, name: 'delegate'}), child}],
        }
      } else {
        const row: Extract<AgentSessionChatRow, {kind: 'message'}> = {
          key: event.id,
          kind: 'message',
          createdAt: event.createdAt,
          message: {
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                id: payload.toolCallId,
                name: typeof payload.name === 'string' ? payload.name : 'delegate',
                child,
                actor: sessionEventActor(event.event),
              },
            ],
            eventId: event.id,
            sessionId: event.sessionId,
            seq: event.seq,
            shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
          },
        }
        rows.push(row)
        toolRowsById.set(payload.toolCallId, row)
      }
      continue
    }

    if (payload.type === 'tool_result' && typeof payload.toolCallId === 'string' && typeof payload.name === 'string') {
      const existingRow = toolRowsById.get(payload.toolCallId)
      const resultText = payload.error || getToolResultSummary(payload.output)
      // Only an EXPLICIT actor on the result event may override the call part's actor at merge
      // time: deriving a default here would stamp 'agent' onto results of user-run calls whose
      // result events omit the field, silently clobbering the attribution.
      const explicitResultActor = (event.event as {actor?: ChatToolPart['actor']}).actor
      // How long the call took: the runtime's own stamp when it left one, otherwise the distance
      // between the call and its result on the log — the same wall time, measured from outside.
      const derivedDurationMs =
        existingRow?.createdAt !== undefined ? Math.max(0, event.createdAt - existingRow.createdAt) : undefined
      const callStampedMeta = (existingRow?.message.parts?.[0] as ChatToolPart | undefined)?.meta
      const meta = resolveToolMeta(callStampedMeta, payload.meta, derivedDurationMs)
      const resultPart: ChatToolPart = {
        type: 'tool',
        id: payload.toolCallId,
        name: payload.name,
        result: resultText,
        rawOutput: payload.output,
        ...(explicitResultActor ? {actor: explicitResultActor} : {}),
        completedAt: event.createdAt,
        resultSeq: event.seq,
        ...(event.truncated ? {resultTruncated: true} : {}),
        ...(meta ? {meta} : {}),
        ...(payload.error ? {isError: true} : {}),
      }

      if (existingRow) {
        existingRow.message = {
          ...existingRow.message,
          parts: [{...((existingRow.message.parts?.[0] as ChatToolPart | undefined) || resultPart), ...resultPart}],
        }
      } else {
        rows.push({
          key: event.id,
          kind: 'message',
          createdAt: event.createdAt,
          message: {
            role: 'assistant',
            parts: [{...resultPart, actor: resultPart.actor ?? sessionEventActor(event.event)}],
            eventId: event.id,
            sessionId: event.sessionId,
            seq: event.seq,
            shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
          },
        })
      }
      continue
    }

    if (payload.type === 'error') {
      rows.push({
        key: event.id,
        kind: 'error',
        createdAt: event.createdAt,
        message: payload.message || payload.error || payload.content || 'Unknown agent error',
      })
      continue
    }

    rows.push({key: event.id, kind: 'raw', event, createdAt: event.createdAt})
  }

  return rows
}
