import {afterEach, describe, expect, test} from 'bun:test'
import {BrowserTools} from './browser-tools'

const relay = new BrowserTools()
const connectionId = 'test-connection-123456'
afterEach(() => relay.close())

describe('session browser relay', () => {
  test('delivers once and resolves only for its owning session, actor and window', async () => {
    relay.connect('session-a', 'actor-a', connectionId)
    const output = relay.execute('session-a', {action: 'snapshot'})
    const request = await relay.poll('session-a', 'actor-a', connectionId)
    expect(request?.command).toEqual({action: 'snapshot'})
    const result = {
      _: 'ResolveSessionBrowser' as const,
      sessionId: 'session-a',
      connectionId,
      requestId: request!.id,
      output: {text: 'Page contents'},
    }
    expect(() => relay.resolve('session-b', 'actor-a', result)).toThrow('no longer active')
    expect(() => relay.resolve('session-a', 'actor-b', result)).toThrow('no longer active')
    expect(() => relay.resolve('session-a', 'actor-a', {...result, connectionId: 'another-window'})).toThrow(
      'no longer active',
    )
    relay.resolve('session-a', 'actor-a', result)
    expect(await output).toEqual({text: 'Page contents'})
    expect(() => relay.resolve('session-a', 'actor-a', result)).toThrow('no longer pending')
  })

  test('wakes an existing poll and revokes in-flight commands on close', async () => {
    relay.connect('session', 'actor', connectionId)
    const poll = relay.poll('session', 'actor', connectionId)
    const execution = relay.execute('session', {action: 'click', document: 'doc', ref: 'e1'})
    const failure = execution.catch((error: Error) => error)
    expect((await poll)?.command.action).toBe('click')
    relay.disconnect('session', 'actor', connectionId)
    expect(((await failure) as Error).message).toContain('Browser disconnected')
    await expect(relay.execute('session', {action: 'snapshot'})).rejects.toThrow('Browser unavailable')
  })

  test('does not allow a second window to silently take over', async () => {
    relay.connect('session', 'actor', connectionId)
    expect(() => relay.connect('session', 'actor', 'different-window-12345')).toThrow('already has a browser')
    expect(() => relay.disconnect('session', 'other-actor', connectionId)).toThrow('no longer active')
    const poll = relay.poll('session', 'actor', connectionId)
    relay.close()
    expect(await poll).toBeUndefined()
  })
})
