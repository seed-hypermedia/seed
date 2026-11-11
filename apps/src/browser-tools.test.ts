import {afterEach, describe, expect, test} from 'bun:test'
import {BrowserTools, browserCommandDeadlineMs} from './browser-tools'

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
    expect(relay.resolve('session-a', JSON.stringify(['actor-a', 'signer-a']), result)).toBe(true)
    expect(await output).toEqual({text: 'Page contents'})
    expect(relay.resolve('session-a', JSON.stringify(['actor-a', 'signer-a']), result)).toBe(false)
  })

  test('gives archive and navigate the long deadline and the page commands the short one', () => {
    expect(browserCommandDeadlineMs({action: 'archive', document: 'doc'})).toBe(120000)
    expect(browserCommandDeadlineMs({action: 'navigate', document: 'doc', url: 'https://example.com'})).toBe(120000)
    expect(browserCommandDeadlineMs({action: 'snapshot'})).toBe(45000)
    expect(browserCommandDeadlineMs({action: 'click', document: 'doc', ref: 'e1'})).toBe(45000)
  })

  test('ignores a late answer to a command that already timed out and keeps the connection', async () => {
    const slow = new BrowserTools({deadline: () => 20})
    try {
      const actor = JSON.stringify(['actor', 'signer'])
      slow.connect('session', actor, connectionId)
      const execution = slow.execute('session', {action: 'archive', document: 'doc'}, 'actor')
      const request = await slow.poll('session', actor, connectionId)
      await expect(execution).rejects.toThrow('timed out')
      const late = {_: 'ResolveSessionBrowser' as const, sessionId: 'session', connectionId, requestId: request!.id}
      expect(slow.resolve('session', actor, {...late, output: {draftId: 'draft'}})).toBe(false)
      const next = slow.execute('session', {action: 'snapshot'}, 'actor')
      const retry = await slow.poll('session', actor, connectionId)
      expect(slow.resolve('session', actor, {...late, requestId: retry!.id, output: {text: 'ok'}})).toBe(true)
      expect(await next).toEqual({text: 'ok'})
    } finally {
      slow.close()
    }
  })

  test('keeps the lease alive while the desktop is busy with a long command', async () => {
    const quick = new BrowserTools({leaseMs: 30, deadline: () => 300})
    try {
      const actor = JSON.stringify(['actor', 'signer'])
      quick.connect('session', actor, connectionId)
      const poll = quick.poll('session', actor, connectionId)
      const execution = quick.execute(
        'session',
        {action: 'navigate', document: 'doc', url: 'https://a.example'},
        'actor',
      )
      const request = await poll
      await new Promise((resolve) => setTimeout(resolve, 90))
      const answer = {_: 'ResolveSessionBrowser' as const, sessionId: 'session', connectionId, requestId: request!.id}
      expect(quick.resolve('session', actor, {...answer, output: {url: 'https://a.example'}})).toBe(true)
      expect(await execution).toEqual({url: 'https://a.example'})
      // Idle again: the plain lease applies and the desktop that stops polling is dropped.
      await quick.poll('session', actor, connectionId).then(
        () => {},
        () => {},
      )
      await new Promise((resolve) => setTimeout(resolve, 90))
      expect(() => quick.resolve('session', actor, {...answer, output: {}})).toThrow('no longer active')
    } finally {
      quick.close()
    }
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
