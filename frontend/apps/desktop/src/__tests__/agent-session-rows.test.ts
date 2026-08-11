import {describe, expect, it} from 'vitest'
import type {RunInfo, SessionEvent} from '@/agents-client'
import {buildAgentSessionChatRows, interleaveRunRecords, retryableErrorRowKey} from '@/models/agent-session-rows'
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
    expect(row.message.parts?.[0]).toMatchObject({result: 'Not found', isError: true})
  })

  it('marks a validation-failed call as errored so a retried call does not read as a duplicate', () => {
    // Real transcript shape from a live session: the model passed `prompt` instead of `input`,
    // the call bounced, and the retry succeeded — two calls, and the first must look failed.
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'call-1', name: 'sub_session', input: {title: 'Research'}}),
        event(2, {type: 'tool_result', toolCallId: 'call-1', name: 'sub_session', error: 'Validation failed'}),
        event(3, {type: 'tool_call', id: 'call-2', name: 'sub_session', input: {title: 'Research', input: 'Go.'}}),
      ],
      CONTEXT,
    )

    expect(rows).toHaveLength(2)
    const failed = rows[0]!
    if (failed.kind !== 'message') throw new Error('expected a message row')
    expect(failed.message.parts?.[0]).toMatchObject({id: 'call-1', isError: true, result: 'Validation failed'})
    const retried = rows[1]!
    if (retried.kind !== 'message') throw new Error('expected a message row')
    expect(retried.message.parts?.[0]).toMatchObject({id: 'call-2'})
    expect((retried.message.parts?.[0] as {isError?: boolean}).isError).toBeUndefined()
  })

  it('carries window-context lines on the message without leaking them into its text', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {
          type: 'message',
          role: 'user',
          content: 'What is this?',
          contextLines: ['## Current window', 'URL: hm://z6MkDoc/plan', 42, null],
        }),
      ],
      CONTEXT,
    )

    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    // The bubble text is only the user's words; the context reaches the UI as a separate field so
    // the info chip can show exactly what the agent was told.
    expect(row.message.content).toBe('What is this?')
    expect(row.message.contextLines).toEqual(['## Current window', 'URL: hm://z6MkDoc/plan'])
  })

  it('leaves contextLines off messages that carried none', () => {
    const rows = buildAgentSessionChatRows([event(1, {type: 'message', role: 'user', content: 'Hello'})], CONTEXT)
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.contextLines).toBeUndefined()
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

describe('retryableErrorRowKey', () => {
  const rows = (events: SessionEvent[]) => buildAgentSessionChatRows(events, CONTEXT)

  it('offers the trailing error row', () => {
    const built = rows([
      event(1, {type: 'message', role: 'user', content: 'hi'}),
      event(2, {type: 'error', message: 'model call failed'}),
    ])
    expect(retryableErrorRowKey(built, false)).toBe('event-2')
  })

  it('ignores an error the conversation already moved past', () => {
    const built = rows([
      event(1, {type: 'error', message: 'model call failed'}),
      event(2, {type: 'message', role: 'assistant', content: 'recovered'}),
    ])
    expect(retryableErrorRowKey(built, false)).toBeUndefined()
  })

  it('offers nothing while the agent is working', () => {
    const built = rows([event(1, {type: 'error', message: 'model call failed'})])
    expect(retryableErrorRowKey(built, true)).toBeUndefined()
  })

  it('offers nothing on a transcript that never failed', () => {
    const built = rows([event(1, {type: 'message', role: 'assistant', content: 'all good'})])
    expect(retryableErrorRowKey(built, false)).toBeUndefined()
    expect(retryableErrorRowKey([], false)).toBeUndefined()
  })
})

describe('interleaveRunRecords', () => {
  const run = (overrides: Partial<RunInfo> & Pick<RunInfo, 'id' | 'status'>): RunInfo =>
    ({
      account: 'a',
      rootRunId: overrides.id,
      depth: 0,
      kind: 'agent',
      origin: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    }) as RunInfo

  const messageRows = () =>
    buildAgentSessionChatRows(
      [
        event(1, {type: 'message', role: 'user', content: 'go'}),
        event(2, {type: 'message', role: 'assistant', content: 'done'}),
      ],
      CONTEXT,
    )

  it('drops a finished orchestration record after the last event before it completed', () => {
    const rows = interleaveRunRecords(messageRows(), [
      run({id: 'r1', status: 'succeeded', childRunCount: 2, finishedAt: 1_700_000_000_000 + 5}),
    ])
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'run-record'])
  })

  it('places an older record between turns, not at the bottom', () => {
    const rows = interleaveRunRecords(
      buildAgentSessionChatRows(
        [
          event(1, {type: 'message', role: 'user', content: 'first'}),
          event(5, {type: 'message', role: 'user', content: 'later turn'}),
        ],
        CONTEXT,
      ),
      [run({id: 'r1', status: 'succeeded', childRunCount: 1, finishedAt: 1_700_000_000_000 + 3})],
    )
    expect(rows.map((row) => row.kind)).toEqual(['message', 'run-record', 'message'])
  })

  it('skips live runs (the pinned card owns them) and plain turns', () => {
    const rows = interleaveRunRecords(messageRows(), [
      run({id: 'live', status: 'waiting', childRunCount: 3, finishedAt: undefined}),
      run({id: 'plain', status: 'succeeded', finishedAt: 1_700_000_000_000 + 9}),
    ])
    expect(rows.every((row) => row.kind === 'message')).toBe(true)
  })

  it('records a workflow or planned run even with no children', () => {
    const rows = interleaveRunRecords(messageRows(), [
      run({
        id: 'planned',
        status: 'failed',
        plan: {steps: [{id: 's1', label: 'Only step', status: 'failed'}]},
        finishedAt: 1_700_000_000_000 + 9,
      }),
    ])
    expect(rows.at(-1)).toMatchObject({kind: 'run-record', run: {id: 'planned'}})
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

describe('symmetric log actors', () => {
  it('stamps actor on tool parts from the event payload, defaulting historical events to agent', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'u1', name: 'read', input: {address: '~/memory/x'}, actor: 'user'}),
        event(2, {type: 'tool_result', toolCallId: 'u1', name: 'read', output: {summary: 'Read.'}, actor: 'user'}),
        event(3, {type: 'tool_call', id: 'a1', name: 'call', input: {tool: 'search'}}),
      ],
      CONTEXT,
    )
    expect(rows).toHaveLength(2)
    const userRow = rows[0]!
    if (userRow.kind !== 'message') throw new Error('expected a message row')
    expect(userRow.message.parts?.[0]).toMatchObject({type: 'tool', id: 'u1', actor: 'user', result: 'Read.'})
    const agentRow = rows[1]!
    if (agentRow.kind !== 'message') throw new Error('expected a message row')
    expect(agentRow.message.parts?.[0]).toMatchObject({type: 'tool', id: 'a1', actor: 'agent'})
  })

  it('keeps the user actor when the result event omits it', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'u1', name: 'write', input: {address: '~/memory/x'}, actor: 'user'}),
        event(2, {type: 'tool_result', toolCallId: 'u1', name: 'write', output: {summary: 'Wrote.'}}),
      ],
      CONTEXT,
    )
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.parts?.[0]).toMatchObject({actor: 'user'})
  })
})
