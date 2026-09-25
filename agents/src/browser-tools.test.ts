import {afterEach, describe, expect, test} from 'bun:test'
import {BrowserTools} from './browser-tools'

const relay = new BrowserTools()
const connectionId = 'test-connection-123456'
afterEach(() => relay.close())

describe('session browser relay', () => {
  test('delivers once and resolves only for its owning session, actor and window', async () => {
    relay.connect('session-a', JSON.stringify(['actor-a', 'signer-a']), connectionId)
    const output = relay.execute('session-a', {action: 'snapshot'}, 'actor-a')
    const request = await relay.poll('session-a', JSON.stringify(['actor-a', 'signer-a']), connectionId)
    expect(request?.command).toEqual({action: 'snapshot'})
    const result = {
      _: 'ResolveSessionBrowser' as const,
      sessionId: 'session-a',
      connectionId,
      requestId: request!.id,
      output: {text: 'Page contents'},
    }
    expect(() => relay.resolve('session-b', JSON.stringify(['actor-a', 'signer-a']), result)).toThrow(
      'no longer active',
    )
    expect(() => relay.resolve('session-a', 'actor-b', result)).toThrow('no longer active')
    expect(() =>
      relay.resolve('session-a', JSON.stringify(['actor-a', 'signer-a']), {...result, connectionId: 'another-window'}),
    ).toThrow('no longer active')
    relay.resolve('session-a', JSON.stringify(['actor-a', 'signer-a']), result)
    expect(await output).toEqual({text: 'Page contents'})
    expect(() => relay.resolve('session-a', JSON.stringify(['actor-a', 'signer-a']), result)).toThrow(
      'no longer pending',
    )
  })

  test('wakes an existing poll and revokes in-flight commands on close', async () => {
    relay.connect('session', JSON.stringify(['actor', 'signer']), connectionId)
    const poll = relay.poll('session', JSON.stringify(['actor', 'signer']), connectionId)
    const execution = relay.execute('session', {action: 'click', document: 'doc', ref: 'e1'}, 'actor')
    const failure = execution.catch((error: Error) => error)
    expect((await poll)?.command.action).toBe('click')
    relay.disconnect('session', JSON.stringify(['actor', 'signer']), connectionId)
    expect(((await failure) as Error).message).toContain('Browser disconnected')
    await expect(relay.execute('session', {action: 'snapshot'}, 'actor')).rejects.toThrow('Browser unavailable')
  })

  test('rejects a command from a different account', async () => {
    relay.connect('session', JSON.stringify(['owner', 'signer']), connectionId)
    await expect(relay.execute('session', {action: 'snapshot'}, 'chatter')).rejects.toThrow(
      'interactive runs started by the agent owner',
    )
  })

  test('does not allow a second window to silently take over', async () => {
    relay.connect('session', JSON.stringify(['actor', 'signer']), connectionId)
    expect(() => relay.connect('session', JSON.stringify(['actor', 'signer']), 'different-window-12345')).toThrow(
      'already has a browser',
    )
    expect(() => relay.disconnect('session', 'other-actor', connectionId)).toThrow('no longer active')
    const poll = relay.poll('session', JSON.stringify(['actor', 'signer']), connectionId)
    relay.close()
    expect(await poll).toBeUndefined()
  })
})
