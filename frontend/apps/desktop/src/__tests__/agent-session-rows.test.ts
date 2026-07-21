import {describe, expect, it} from 'vitest'
import type {SessionEvent} from '@/agents-client'
import {buildAgentSessionChatRows} from '@/models/agent-session-rows'
import {decodeAssistantSessionRef, encodeAssistantSessionRef} from '@/components/assistant-session-ref'

const CONTEXT = {serverUrl: 'http://localhost:3050', agentId: 'agent-1', sessionId: 'session-1'}

/** Builds a durable session event with a stable id/seq. */
function event(seq: number, payload: Record<string, unknown>): SessionEvent {
  return {
    id: `event-${seq}`,
    sessionId: 'session-1',
    seq,
    event: payload as SessionEvent['event'],
    createdAt: 1_700_000_000_000 + seq,
  }
}

describe('buildAgentSessionChatRows', () => {
  it('pairs a tool result onto the row created by its tool call', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'call-1', name: 'search', input: {query: 'seed'}}),
        event(2, {type: 'tool_result', toolCallId: 'call-1', name: 'search', output: {summary: 'Found 2.'}}),
      ],
      CONTEXT,
    )

    // The result folds into the existing call row rather than appending a second bubble.
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    const part = row.message.parts?.[0]
    expect(part).toMatchObject({type: 'tool', id: 'call-1', name: 'search', result: 'Found 2.'})
    expect(part).toMatchObject({args: {query: 'seed'}})
  })

  it('renders a tool result with no preceding call as its own row', () => {
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'tool_result', toolCallId: 'orphan', name: 'read', output: {summary: 'Read it.'}})],
      CONTEXT,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe('message')
  })

  it('prefers a tool error over the output summary', () => {
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'tool_result', toolCallId: 'call-1', name: 'read', error: 'Not found', output: {summary: 'x'}})],
      CONTEXT,
    )

    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.parts?.[0]).toMatchObject({result: 'Not found'})
  })

  it('hides the trigger context block from the bubble but keeps the full text as raw markdown', () => {
    const content = 'Please review.\n<trigger_context>\n{"a":1}\n</trigger_context>'
    const rows = buildAgentSessionChatRows([event(1, {type: 'message', role: 'user', content})], {
      ...CONTEXT,
      triggerContext: {triggerName: 'Nightly'} as never,
    })

    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.content).toBe('Please review.')
    expect(row.message.rawMarkdown).toBe(content)
    expect(row.triggerContext).toBeDefined()
  })

  it('attaches the trigger card only to the first triggered message', () => {
    const content = 'Go.\n<trigger_context>\n{}\n</trigger_context>'
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'message', role: 'user', content}), event(2, {type: 'message', role: 'user', content})],
      {...CONTEXT, triggerContext: {triggerName: 'Nightly'} as never},
    )

    expect(rows.filter((row) => row.kind === 'message' && row.triggerContext)).toHaveLength(1)
  })

  it('surfaces error events and keeps unknown payloads as raw rows', () => {
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'error', message: 'boom'}), event(2, {type: 'something-new'})],
      CONTEXT,
    )

    expect(rows[0]).toMatchObject({kind: 'error', message: 'boom'})
    expect(rows[1]!.kind).toBe('raw')
  })

  it('omits share links when the agent is unknown', () => {
    const rows = buildAgentSessionChatRows([event(1, {type: 'message', role: 'assistant', content: 'hi'})], {
      ...CONTEXT,
      agentId: undefined,
    })

    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.shareUrl).toBeUndefined()
  })
})

describe('assistant session refs', () => {
  it('round-trips a server URL and session id', () => {
    const ref = {serverUrl: 'https://agentic.seed.hyper.media', sessionId: 'abc-123'}
    expect(decodeAssistantSessionRef(encodeAssistantSessionRef(ref))).toEqual(ref)
  })

  it('rejects a bare session id written by an older build', () => {
    // Older window state stored just the id; decoding must degrade to "nothing selected" rather
    // than inventing a server URL.
    expect(decodeAssistantSessionRef('session-1')).toBeNull()
  })

  it('rejects empty and malformed values', () => {
    expect(decodeAssistantSessionRef(null)).toBeNull()
    expect(decodeAssistantSessionRef('')).toBeNull()
    expect(decodeAssistantSessionRef(' | session-1')).toBeNull()
    expect(decodeAssistantSessionRef('http://localhost:3050 | ')).toBeNull()
  })
})
