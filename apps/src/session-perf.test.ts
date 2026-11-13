import {describe, expect, test} from 'bun:test'

import {sessionPerfRollup, type SessionPerfEventRow, type SessionPerfRunRow} from '@/session-perf'

const SID = 'session-1'

function run(id: string, createdAt: number, startedAt: number | null, finishedAt: number | null): SessionPerfRunRow {
  return {id, status: finishedAt !== null ? 'succeeded' : 'running', createdAt, startedAt, finishedAt}
}

function ev(seq: number, createdAt: number, event: unknown): SessionPerfEventRow {
  return {seq, createdAt, event}
}

describe('sessionPerfRollup', () => {
  test('attributes gaps to model time inside runs and idle time outside them', () => {
    const runs = [run('r1', 1000, 1000, 20_000)]
    const events = [
      ev(1, 1000, {type: 'message', role: 'user', content: 'hi'}),
      // 5s gap before a tool_call inside the run window: the model was thinking.
      ev(2, 6000, {type: 'tool_call', id: 'c1', name: 'call', input: {}}),
      ev(3, 9000, {type: 'tool_result', toolCallId: 'c1', name: 'call', meta: {durationMs: 3000}}),
      // 4s gap before the assistant message: model time again.
      ev(4, 13_000, {type: 'message', role: 'assistant', content: 'done'}),
      // 60s after the run finished, the user speaks: idle, not model.
      ev(5, 80_000, {type: 'message', role: 'user', content: 'next'}),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.totals.modelGapMs).toBe(9000)
    expect(rollup.totals.idleMs).toBe(67_000)
    expect(rollup.totals.activeMs).toBe(19_000)
    expect(rollup.totals.toolMs).toBe(3000)
    expect(rollup.tools.call).toEqual({count: 1, totalMs: 3000, maxMs: 3000})
  })

  test('accumulates exec boot overhead from tool_result outputs', () => {
    const runs = [run('r1', 0, 0, 10_000)]
    const events = [
      ev(1, 100, {
        type: 'tool_result',
        toolCallId: 'c1',
        name: 'call',
        meta: {durationMs: 4000},
        output: {bootMs: 1200},
      }),
      ev(2, 200, {
        type: 'tool_result',
        toolCallId: 'c2',
        name: 'call',
        meta: {durationMs: 3500},
        output: {bootMs: 900},
      }),
      ev(3, 300, {type: 'tool_result', toolCallId: 'c3', name: 'read', meta: {durationMs: 50}, output: {content: 'x'}}),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.totals.execBootMs).toBe(2100)
    expect(rollup.totals.execBootCount).toBe(2)
    expect(rollup.tools.read).toEqual({count: 1, totalMs: 50, maxMs: 50})
  })

  test('deduplicates per-turn timing stamped on several events of the same turn', () => {
    const runs = [run('r1', 0, 0, 30_000)]
    const turnMeta = {turn: {index: 1, ttftMs: 2000, turnMs: 8000}}
    const events = [
      ev(1, 1000, {type: 'tool_call', id: 'c1', name: 'read', input: {}, meta: turnMeta}),
      ev(2, 1001, {type: 'tool_call', id: 'c2', name: 'read', input: {}, meta: turnMeta}),
      ev(3, 1500, {type: 'tool_result', toolCallId: 'c1', name: 'read', meta: {...turnMeta, durationMs: 400}}),
      ev(4, 9000, {
        type: 'message',
        role: 'assistant',
        content: 'x',
        meta: {turn: {index: 2, ttftMs: 1000, turnMs: 5000}},
      }),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.turns.count).toBe(2)
    expect(rollup.turns.totalTurnMs).toBe(13_000)
    expect(rollup.turns.totalTtftMs).toBe(3000)
    expect(rollup.turns.maxTurnMs).toBe(8000)
  })

  test('same turn index in different runs counts separately', () => {
    const runs = [run('r1', 0, 0, 5000), run('r2', 10_000, 10_000, 20_000)]
    const events = [
      ev(1, 1000, {type: 'message', role: 'assistant', content: 'a', meta: {turn: {index: 1, turnMs: 3000}}}),
      ev(2, 11_000, {type: 'message', role: 'assistant', content: 'b', meta: {turn: {index: 1, turnMs: 4000}}}),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.turns.count).toBe(2)
    expect(rollup.turns.totalTurnMs).toBe(7000)
  })

  test('reports dispatch wait per run and survives malformed events', () => {
    const runs = [run('r1', 1000, 61_000, 90_000), run('r2', 95_000, null, null)]
    const events = [
      ev(1, 61_000, {type: 'message', role: 'user', content: 'x'}),
      ev(2, 62_000, 'not-an-object'),
      ev(3, 63_000, {type: 'tool_result'}),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.runs[0]).toEqual({id: 'r1', status: 'succeeded', dispatchWaitMs: 60_000, activeMs: 29_000})
    expect(rollup.runs[1]).toEqual({id: 'r2', status: 'running', dispatchWaitMs: null, activeMs: null})
    expect(rollup.tools.unknown?.count).toBe(1)
    expect(rollup.eventCount).toBe(3)
  })

  test('an unfinished run window attributes ongoing gaps as model time', () => {
    const runs = [run('r1', 0, 0, null)]
    const events = [
      ev(1, 100, {type: 'message', role: 'user', content: 'go'}),
      ev(2, 30_100, {type: 'tool_call', id: 'c1', name: 'write', input: {}}),
    ]
    const rollup = sessionPerfRollup(SID, runs, events)
    expect(rollup.totals.modelGapMs).toBe(30_000)
    expect(rollup.totals.idleMs).toBe(0)
  })
})
