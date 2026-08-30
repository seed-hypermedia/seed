import {describe, expect, it} from 'vitest'
import {AgentServerError} from '../agents/client'
import {describeAgentError, isNetworkError} from '../agents/errors'

describe('isNetworkError', () => {
  it('recognizes every browser and runtime phrasing of a request that never arrived', () => {
    for (const message of [
      'Failed to fetch',
      'Load failed',
      'fetch failed',
      'NetworkError when attempting to fetch resource.',
    ]) {
      expect(isNetworkError(new TypeError(message))).toBe(true)
    }
  })

  it('never mistakes a server reply for a connection failure', () => {
    expect(isNetworkError(new AgentServerError('Failed to fetch', 500))).toBe(false)
    expect(isNetworkError(new Error('Unauthorized'))).toBe(false)
    expect(isNetworkError('Failed to fetch')).toBe(false)
  })
})

describe('describeAgentError', () => {
  it('names the unreachable server and softens it to a warning', () => {
    const notice = describeAgentError(new TypeError('Failed to fetch'), {
      failed: 'Couldn’t load agents',
      serverLabel: 'agents.example.com',
    })
    expect(notice).toEqual({
      tone: 'warning',
      title: 'Can’t reach agents.example.com',
      detail: 'Couldn’t load agents because the server isn’t responding.',
    })
  })

  it('keeps a refusal from the server as an error, quoting what it said', () => {
    const notice = describeAgentError(new AgentServerError('forbidden', 403), {
      failed: 'Couldn’t load this agent',
      serverLabel: 'Local Agents',
    })
    expect(notice.tone).toBe('error')
    expect(notice.title).toBe('Couldn’t load this agent')
    expect(notice.detail).toBe('Local Agents refused the request: forbidden')
  })

  it('falls back to the raw message without a server label', () => {
    expect(describeAgentError(new Error('boom'), {failed: 'Couldn’t load models'})).toEqual({
      tone: 'error',
      title: 'Couldn’t load models',
      detail: 'boom',
    })
    expect(describeAgentError(undefined, {failed: 'Couldn’t load models'})).toEqual({
      tone: 'error',
      title: 'Couldn’t load models',
      detail: undefined,
    })
  })
})
