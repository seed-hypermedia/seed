// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest'
import {readStickyAgentSession, writeStickyAgentSession} from '../agents/sticky-session'

describe('sticky agent session', () => {
  afterEach(() => window.localStorage.clear())

  it('remembers the open session per server and agent', () => {
    writeStickyAgentSession('https://a.example', 'agent-1', 'session-1')
    writeStickyAgentSession('https://a.example', 'agent-2', 'session-2')
    expect(readStickyAgentSession('https://a.example', 'agent-1')).toBe('session-1')
    expect(readStickyAgentSession('https://a.example', 'agent-2')).toBe('session-2')
    expect(readStickyAgentSession('https://b.example', 'agent-1')).toBeNull()
  })

  it('forgets the session when the list becomes the destination', () => {
    writeStickyAgentSession('https://a.example', 'agent-1', 'session-1')
    writeStickyAgentSession('https://a.example', 'agent-1', null)
    expect(readStickyAgentSession('https://a.example', 'agent-1')).toBeNull()
  })
})
