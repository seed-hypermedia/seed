import {type AgentSessionTriggerContext, type SessionAttachmentInfo, type SessionEvent} from '@/agents-client'
import {type ChatBubbleMessage} from '@/components/assistant-message-rendering'
import {type ChatToolPart} from '@/models/chat-parts'
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
      triggerContext?: AgentSessionTriggerContext
      triggerInstructions?: string
    }
  | {key: string; kind: 'error'; message: string}
  | {key: string; kind: 'raw'; event: SessionEvent}

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
        message: {
          role: payload.role,
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
      }
      const row: Extract<AgentSessionChatRow, {kind: 'message'}> = {
        key: event.id,
        kind: 'message',
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

    if (payload.type === 'tool_result' && typeof payload.toolCallId === 'string' && typeof payload.name === 'string') {
      const existingRow = toolRowsById.get(payload.toolCallId)
      const resultText = payload.error || getToolResultSummary(payload.output)
      const resultPart: ChatToolPart = {
        type: 'tool',
        id: payload.toolCallId,
        name: payload.name,
        result: resultText,
        rawOutput: payload.output,
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
          message: {
            role: 'assistant',
            parts: [resultPart],
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
        message: payload.message || payload.error || payload.content || 'Unknown agent error',
      })
      continue
    }

    rows.push({key: event.id, kind: 'raw', event})
  }

  return rows
}
