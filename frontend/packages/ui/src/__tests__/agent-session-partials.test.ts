import {describe, expect, test} from 'vitest'
import {applyAgentSessionPartial} from '../agents/models'

describe('applyAgentSessionPartial', () => {
  test('an account-wide subscription does not retain partial state for observed sessions', () => {
    const current = {}

    const next = applyAgentSessionPartial(current, 'account/z6MkViewer', 'sessions/background-session', {
      textDelta: 'streamed output',
      usage: {input: 10, output: 4, total: 14},
    })

    expect(next).toBe(current)
    expect(next).toEqual({})
  })

  test('a direct session subscription only accumulates its own partials', () => {
    const first = applyAgentSessionPartial({}, 'sessions/selected', 'sessions/selected', {textDelta: 'hello'})
    const unrelated = applyAgentSessionPartial(first, 'sessions/selected', 'sessions/background', {
      textDelta: 'ignored',
    })
    const done = applyAgentSessionPartial(unrelated, 'sessions/selected', 'sessions/selected', {
      done: true,
      usage: {input: 12, output: 5, total: 17},
    })

    expect(unrelated).toBe(first)
    expect(done).toEqual({selected: {text: 'hello', usage: {input: 12, output: 5, total: 17}}})
  })
})
