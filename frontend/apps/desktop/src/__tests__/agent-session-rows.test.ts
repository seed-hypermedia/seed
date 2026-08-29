import {describe, expect, it} from 'vitest'
import type {RunInfo, SessionEvent} from '@shm/ui/agents/client'
import {
  buildAgentSessionChatRows,
  frozenRunIds,
  interleaveRunRecords,
  isOptimisticUserEcho,
  retryableErrorRowKey,
} from '@shm/ui/agents/agent-session-rows'
import {decodeAssistantSessionRef, encodeAssistantSessionRef} from '@shm/ui/agents/assistant-session-ref'

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

  it('folds a tool_spawn onto its delegate call, naming the child before any result exists', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'd1', name: 'delegate', input: {title: 'Researcher', brief: 'Go.'}}),
        event(2, {
          type: 'tool_spawn',
          toolCallId: 'd1',
          name: 'delegate',
          runId: 'run-child',
          sessionId: 'session-child',
          title: 'Researcher',
        }),
      ],
      CONTEXT,
    )

    // One row, still pending (the spawn is not a result), but it already knows its child.
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    const part = row.message.parts?.[0]
    expect(part).toMatchObject({
      type: 'tool',
      id: 'd1',
      args: {title: 'Researcher', brief: 'Go.'},
      child: {runId: 'run-child', sessionId: 'session-child', title: 'Researcher'},
    })
    expect(part && 'result' in part ? part.result : undefined).toBeUndefined()
  })

  it('keeps the spawned child on the row once the delegate result lands', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'd1', name: 'delegate', input: {title: 'Researcher'}}),
        event(2, {type: 'tool_spawn', toolCallId: 'd1', name: 'delegate', runId: 'run-child', title: 'Researcher'}),
        event(3, {type: 'tool_result', toolCallId: 'd1', name: 'delegate', output: {status: 'succeeded'}}),
      ],
      CONTEXT,
    )

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.parts?.[0]).toMatchObject({
      id: 'd1',
      rawOutput: {status: 'succeeded'},
      child: {runId: 'run-child', title: 'Researcher'},
    })
  })

  it('a tool_spawn whose call event is missing still becomes a row into the child', () => {
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'tool_spawn', toolCallId: 'd1', name: 'delegate', runId: 'run-child', sessionId: 's-child'})],
      CONTEXT,
    )

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect(row.message.parts?.[0]).toMatchObject({
      type: 'tool',
      id: 'd1',
      name: 'delegate',
      child: {runId: 'run-child', sessionId: 's-child'},
    })
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

  it('places an owned completed plan before the closing answer and carries the checklist with it', () => {
    const ownedPlan = {
      ownerRunId: 'r1',
      settledAt: 1_700_000_000_001.5,
      title: 'Madrid weather check',
      steps: [{id: 'wait', label: 'Wait five minutes and recheck', status: 'done' as const}],
    }
    const rows = interleaveRunRecords(
      messageRows(),
      [
        run({
          id: 'r1',
          status: 'succeeded',
          childRunCount: 1,
          startedAt: 1_700_000_000_000,
          finishedAt: 1_700_000_000_003,
        }),
      ],
      ownedPlan,
    )
    expect(rows.map((row) => row.kind)).toEqual(['message', 'run-record', 'message'])
    expect(rows[1]).toMatchObject({kind: 'run-record', plan: ownedPlan})
  })

  it('places a child-work record at the delivered delegation result rather than after the closing answer', () => {
    const rows = interleaveRunRecords(
      buildAgentSessionChatRows(
        [
          event(1, {type: 'message', role: 'user', content: 'go'}),
          event(2, {type: 'tool_call', id: 'd1', name: 'delegate', input: {title: 'Wait'}}),
          event(6, {type: 'tool_result', toolCallId: 'd1', name: 'delegate', output: {status: 'succeeded'}}),
          event(8, {type: 'message', role: 'assistant', content: 'done'}),
        ],
        CONTEXT,
      ),
      [run({id: 'r1', status: 'succeeded', childRunCount: 1, finishedAt: 1_700_000_000_009})],
    )
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'run-record', 'message'])
    const delegate = rows[1]
    expect(delegate.kind === 'message' ? delegate.message.parts?.[0] : undefined).toMatchObject({
      completedAt: 1_700_000_000_006,
    })
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

  /**
   * A transcript around a live run whose checklist has already finished.
   *
   * Deliberately free of plan rows: the plan verb writes none — the checklist is session state,
   * rendered as the card rather than as conversation — so the settle moment can only come from the
   * server's `settledAt` stamp.
   */
  const settledPlanRows = () =>
    buildAgentSessionChatRows(
      [
        event(1, {type: 'message', role: 'user', content: 'go'}),
        event(3, {type: 'message', role: 'assistant', content: 'Working on it.'}),
        event(8, {type: 'message', role: 'assistant', content: 'And here is the summary.'}),
      ],
      CONTEXT,
    )

  const SETTLED_AT = 1_700_000_000_004

  const settledPlan = {
    settledAt: SETTLED_AT,
    steps: [
      {id: 's1', label: 'Research', status: 'done' as const},
      {id: 's2', label: 'Draft', status: 'skipped' as const},
    ],
  }

  it('freezes a live agent run at the moment the server stamped its session plan settled', () => {
    // A model-driven run carries no plan of its own — its checklist is the session's, which is why
    // the session plan has to reach this decision the same way it reaches the pinned card.
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [run({id: 'live', status: 'running', childRunCount: 2, updatedAt: 1_700_000_000_999})],
      settledPlan,
    )
    // Between the two assistant turns, where it settled — not at the bottom, and not dragged down by
    // `updatedAt`, which keeps advancing while the run finishes talking.
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'run-record', 'message'])
    expect(rows[2]).toMatchObject({kind: 'run-record', run: {id: 'live'}, createdAt: SETTLED_AT})
  })

  it('carries the session checklist onto the frozen row, so the card still has its story', () => {
    // `RunInfo.plan` is written by the workflow host alone. Without carrying the session's plan
    // across, an agent run's frozen card would render a title and no steps.
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [run({id: 'live', status: 'running', childRunCount: 2})],
      settledPlan,
    )
    expect(rows[2]).toMatchObject({kind: 'run-record', plan: {steps: settledPlan.steps}})
  })

  it('freezes a workflow run on its own settled plan', () => {
    const rows = interleaveRunRecords(settledPlanRows(), [
      run({id: 'wf', status: 'running', kind: 'workflow', plan: settledPlan, updatedAt: 1_700_000_000_999}),
    ])
    expect(rows[2]).toMatchObject({kind: 'run-record', run: {id: 'wf'}, createdAt: SETTLED_AT})
  })

  it('lends the session checklist only to the newest run', () => {
    // ListRuns is newest-first, and the session's checklist belongs to whichever run is writing it
    // now — the same run the pinned card would show it on. An older turn does not settle by it.
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [
        run({id: 'newest', status: 'running', childRunCount: 1}),
        run({id: 'older', status: 'running', childRunCount: 1}),
      ],
      settledPlan,
    )
    const frozen = frozenRunIds(rows)
    expect(frozen.has('newest')).toBe(true)
    expect(frozen.has('older')).toBe(false)
  })

  it('leaves a run with an unfinished step pinned, exactly as before', () => {
    const rows = interleaveRunRecords(settledPlanRows(), [run({id: 'live', status: 'running', childRunCount: 2})], {
      steps: [...settledPlan.steps, {id: 's3', label: 'Publish', status: 'running'}],
    })
    expect(rows.every((row) => row.kind !== 'run-record')).toBe(true)
    expect(frozenRunIds(rows).size).toBe(0)
  })

  it('stays pinned when a settled plan carries no stamp, rather than inventing a moment', () => {
    // A plan settled before the server recorded when. There is no honest position for the card, and
    // `updatedAt` would drag it down the scroll on every heartbeat — so it keeps its pinned slot.
    const {settledAt: _unstamped, ...unstampedPlan} = settledPlan
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [run({id: 'live', status: 'running', childRunCount: 2, updatedAt: 1_700_000_000_999})],
      unstampedPlan,
    )
    expect(frozenRunIds(rows).size).toBe(0)
  })

  it('freezes a live run once it delivers its typed result', () => {
    const rows = interleaveRunRecords(
      buildAgentSessionChatRows(
        [
          event(1, {type: 'message', role: 'user', content: 'go'}),
          event(4, {type: 'tool_call', id: 'r1', name: 'return_result', input: {output: {ok: true}}}),
          event(5, {type: 'tool_result', toolCallId: 'r1', name: 'return_result', output: {summary: 'Delivered.'}}),
          event(9, {type: 'message', role: 'assistant', content: 'Anything else?'}),
        ],
        CONTEXT,
      ),
      // No settled plan and no terminal status: the delivered result is what completes the story.
      [
        run({
          id: 'live',
          status: 'running',
          childRunCount: 1,
          plan: {steps: [{id: 's1', label: 'Do', status: 'running'}]},
        }),
      ],
    )
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'run-record', 'message'])
  })

  it('keeps a parked run pinned even with a fully settled plan — it is asking you something', () => {
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [
        run({
          id: 'parked',
          status: 'waiting',
          childRunCount: 1,
          wait: {reason: 'event', answerWith: 'approval'},
        }),
      ],
      settledPlan,
    )
    expect(frozenRunIds(rows).size).toBe(0)
  })

  it('never freezes a plain turn, however settled it looks', () => {
    // No children, no workflow, and the session checklist is empty: nothing to put on a card.
    const rows = interleaveRunRecords(settledPlanRows(), [run({id: 'plain', status: 'running'})], {
      settledAt: SETTLED_AT,
      steps: [],
    })
    expect(frozenRunIds(rows).size).toBe(0)
  })

  it('does not lend a settled session checklist to a finished plain turn', () => {
    // The session's plan may have settled during a later turn. A finished turn is judged on what it
    // carried itself, or an old plain reply would sprout an orchestration card it never earned.
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [run({id: 'done', status: 'succeeded', finishedAt: 1_700_000_000_006})],
      settledPlan,
    )
    expect(frozenRunIds(rows).size).toBe(0)
  })

  it('names the frozen runs so the pinned card can stop repeating them', () => {
    const rows = interleaveRunRecords(
      settledPlanRows(),
      [run({id: 'live', status: 'running', childRunCount: 2})],
      settledPlan,
    )
    const frozen = frozenRunIds(rows)
    expect(frozen.size).toBe(1)
    expect(frozen.has('live')).toBe(true)
  })
})

describe('isOptimisticUserEcho', () => {
  const pending = {type: 'message', role: 'user', content: 'Finish the plan.'} as never

  it('recognises the server echoing back the message the user just sent', () => {
    expect(isOptimisticUserEcho({type: 'message', role: 'user', content: 'Finish the plan.'} as never, pending)).toBe(
      true,
    )
  })

  it('never mistakes a runtime-authored turn for the user`s pending message', () => {
    // The runtime writes mid-run, as `role: 'user'`, over the very socket the optimistic row is
    // waiting on. Matching on shape alone would delete the user's own words from the transcript.
    expect(
      isOptimisticUserEcho(
        {type: 'message', role: 'user', actor: 'system', content: 'Finish the plan.'} as never,
        pending,
      ),
    ).toBe(false)
  })

  it('matches the echo by clientMessageId regardless of content', () => {
    const stamped = {
      type: 'message',
      role: 'user',
      content: 'first para\nsecond para',
      rawMarkdown: 'first para\nsecond para',
      clientMessageId: 'cm-1',
    } as never
    // The server re-serialized everything, but the identity round-tripped.
    expect(
      isOptimisticUserEcho(
        {type: 'message', role: 'user', content: 'first para\n\nsecond para', clientMessageId: 'cm-1'} as never,
        stamped,
      ),
    ).toBe(true)
    // Identical text under a different id is a different message (e.g. sent twice on purpose).
    expect(
      isOptimisticUserEcho(
        {
          type: 'message',
          role: 'user',
          content: 'first para\nsecond para',
          rawMarkdown: 'first para\nsecond para',
          clientMessageId: 'cm-2',
        } as never,
        stamped,
      ),
    ).toBe(false)
  })

  it('matches the echo by verbatim rawMarkdown when the server re-serialized content', () => {
    // A multi-paragraph message: the server stores `content` from its own markdown writer
    // ("a\n\nb") while the client's optimistic row carries the composer's markdown ("a\nb").
    // The verbatim rawMarkdown is what round-trips.
    const multiPending = {
      type: 'message',
      role: 'user',
      content: 'first para\nsecond para',
      rawMarkdown: 'first para\nsecond para',
    } as never
    expect(
      isOptimisticUserEcho(
        {
          type: 'message',
          role: 'user',
          content: 'first para\n\nsecond para',
          rawMarkdown: 'first para\nsecond para',
        } as never,
        multiPending,
      ),
    ).toBe(true)
    // A different message is still not an echo, even with rawMarkdown on both sides.
    expect(
      isOptimisticUserEcho(
        {type: 'message', role: 'user', content: 'other', rawMarkdown: 'other'} as never,
        multiPending,
      ),
    ).toBe(false)
  })

  it('leaves rows that are not the user`s message alone', () => {
    expect(
      isOptimisticUserEcho({type: 'message', role: 'assistant', content: 'Finish the plan.'} as never, pending),
    ).toBe(false)
    expect(isOptimisticUserEcho({type: 'message', role: 'user', content: 'Something else.'} as never, pending)).toBe(
      false,
    )
    expect(isOptimisticUserEcho({type: 'tool_call', id: 'c1', name: 'plan'} as never, pending)).toBe(false)
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

  it('stamps the message row with its author, so a runtime-written turn is not read as the user', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'message', role: 'user', content: 'Go.'}),
        // The runtime asks as a user turn so the model obeys it — the actor is the only thing that
        // says nobody typed this.
        event(2, {type: 'message', role: 'user', content: 'Two plan steps are still open.', actor: 'system'}),
        event(3, {type: 'message', role: 'assistant', content: 'On it.'}),
      ],
      CONTEXT,
    )
    expect(rows.map((row) => (row.kind === 'message' ? row.message.actor : null))).toEqual(['user', 'system', 'agent'])
  })

  it('carries the runtime stamp onto assistant messages and leaves legacy ones bare', () => {
    const meta = {model: 'gpt-5-mini', provider: 'openai', durationMs: 1420}
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'message', role: 'assistant', content: 'Stamped.', meta}),
        event(2, {type: 'message', role: 'assistant', content: 'Legacy.'}),
      ],
      CONTEXT,
    )
    expect(rows.map((row) => (row.kind === 'message' ? row.message.meta : null))).toEqual([meta, undefined])
  })

  it('derives a tool call duration from its own two log entries when the runtime stamped none', () => {
    const rows = buildAgentSessionChatRows(
      [
        event(1, {type: 'tool_call', id: 'c1', name: 'read', input: {address: '~/memory/x'}}),
        // event(n).createdAt is base + n, so this result lands 3ms after the call.
        event(4, {type: 'tool_result', toolCallId: 'c1', name: 'read', output: {summary: 'Read.'}}),
        event(5, {type: 'tool_call', id: 'c2', name: 'call', input: {tool: 'search'}}),
        event(6, {
          type: 'tool_result',
          toolCallId: 'c2',
          name: 'call',
          output: {summary: 'Found.'},
          meta: {durationMs: 8_000, model: 'gpt-5-mini'},
        }),
      ],
      CONTEXT,
    )
    const metas = rows.map((row) => (row.kind === 'message' ? row.message.parts?.[0] : null))
    expect(metas[0]).toMatchObject({meta: {durationMs: 3}})
    // A stamped duration is the truth about the tool, not the truth about the log's clock.
    expect(metas[1]).toMatchObject({meta: {durationMs: 8_000, model: 'gpt-5-mini'}})
  })

  it('merges the call stamp (model/provider/usage) with the result stamp (duration) into one tool meta', () => {
    const usage = {input: 1200, output: 40, cacheRead: 0, cacheWrite: 0, total: 1240}
    const rows = buildAgentSessionChatRows(
      [
        event(1, {
          type: 'tool_call',
          id: 'c1',
          name: 'read',
          input: {address: '~/memory/x'},
          meta: {model: 'gpt-5-mini', provider: 'openai', usage},
        }),
        event(3, {
          type: 'tool_result',
          toolCallId: 'c1',
          name: 'read',
          output: {summary: 'Read.'},
          meta: {durationMs: 950},
        }),
      ],
      CONTEXT,
    )
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    const part = row.message.parts?.[0] as {meta?: unknown; calledAt?: number; completedAt?: number}
    expect(part.meta).toEqual({model: 'gpt-5-mini', provider: 'openai', usage, durationMs: 950})
    // The absolute times bound the execution: the info dialog shows both, not just the span.
    expect(part.calledAt).toBe(row.createdAt)
    expect(part.completedAt).toBe(part.calledAt! + 2)
  })

  it('leaves a tool row with nothing to say carrying no stat block at all', () => {
    const rows = buildAgentSessionChatRows(
      [event(1, {type: 'tool_result', toolCallId: 'orphan', name: 'read', output: {summary: 'Read.'}})],
      CONTEXT,
    )
    const row = rows[0]!
    if (row.kind !== 'message') throw new Error('expected a message row')
    expect((row.message.parts?.[0] as {meta?: unknown}).meta).toBeUndefined()
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
