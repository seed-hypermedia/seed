import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {EXTENSION_MESSAGE_TAG, EXTENSION_PROTOCOL_VERSION, ExtensionError} from '@seed-hypermedia/client/extensions'
import type {
  ExtensionContext,
  ExtensionErrorPayload,
  ExtensionMessage,
  ExtensionRequestMessage,
} from '@seed-hypermedia/client/extensions'
import {connect, createWindowTransport, hmRef, type ExtensionTransport} from './connect'
import {base64Encode} from './base64'

const context: ExtensionContext = {
  protocol: EXTENSION_PROTOCOL_VERSION,
  platform: 'web',
  extensionId: 'hm://z6MkExt/hello',
  extensionVersion: 'bafyv1',
  manifest: {
    manifestVersion: 1,
    kind: 'page',
    version: '0.1.0',
    entry: 'ipfs://bafyentry',
    permissions: ['sign', 'storage'],
  },
  site: {uid: 'z6MkSite', name: 'Test site'},
  mountPath: 'hello',
  subPath: [],
  query: {},
  settings: {},
  user: {accountId: 'z6MkUser', name: 'Alice'},
  theme: 'light',
  permissions: ['sign', 'storage'],
  dev: false,
}

/** An in-memory host: records posted requests and lets the test answer them. */
function fakeHost() {
  let handler: ((message: ExtensionMessage) => void) | null = null
  const posted: ExtensionRequestMessage[] = []
  const transport: ExtensionTransport = {
    post(message) {
      posted.push(message as ExtensionRequestMessage)
    },
    listen(h) {
      handler = h
      return () => {
        handler = null
      }
    },
  }
  const tag = {[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION} as const
  return {
    transport,
    posted,
    get listening() {
      return handler !== null
    },
    reply(id: number, result: unknown) {
      handler?.({...tag, type: 'response', id, result})
    },
    fail(id: number, error: ExtensionErrorPayload) {
      handler?.({...tag, type: 'response', id, error})
    },
    emit(event: 'context', data: unknown) {
      handler?.({...tag, type: 'event', event, data})
    },
    /** Answer the pending hello (whatever its id) with the context. */
    answerHello() {
      const hello = posted.find((m) => m.method === 'hello')
      if (!hello) throw new Error('no hello posted')
      this.reply(hello.id, context)
    },
    last() {
      const m = posted[posted.length - 1]
      if (!m) throw new Error('nothing posted')
      return m
    },
  }
}

async function connected() {
  const host = fakeHost()
  const promise = connect({transport: host.transport})
  host.answerHello()
  const seed = await promise
  return {host, seed}
}

describe('connect handshake', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends hello with the protocol version and resolves with the context', async () => {
    const host = fakeHost()
    const promise = connect({transport: host.transport, sdkVersion: 'test'})
    expect(host.posted).toHaveLength(1)
    const hello = host.last()
    expect(hello).toMatchObject({
      [EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION,
      type: 'request',
      method: 'hello',
      params: {protocol: EXTENSION_PROTOCOL_VERSION, sdkVersion: 'test'},
    })
    host.reply(hello.id, context)
    const seed = await promise
    expect(seed.context).toEqual(context)
    expect(seed.user?.accountId).toBe('z6MkUser')
  })

  it('retries hello until the host answers, then stops', async () => {
    const host = fakeHost()
    const promise = connect({transport: host.transport, helloIntervalMs: 250})
    expect(host.posted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(host.posted).toHaveLength(3)
    // Every retry re-posts the same id so any one answer completes the handshake.
    expect(new Set(host.posted.map((m) => m.id)).size).toBe(1)
    host.answerHello()
    await promise
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.posted).toHaveLength(3)
  })

  it('ignores a duplicate answer to a retried hello', async () => {
    const host = fakeHost()
    const promise = connect({transport: host.transport})
    host.answerHello()
    host.answerHello()
    await expect(promise).resolves.toBeTruthy()
  })

  it('rejects with not_supported when no host answers in time', async () => {
    const host = fakeHost()
    const promise = connect({transport: host.transport, timeoutMs: 1000, helloIntervalMs: 100})
    const outcome = promise.then(
      () => 'resolved',
      (e) => e,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const error = await outcome
    expect(error).toBeInstanceOf(ExtensionError)
    expect((error as ExtensionError).code).toBe('not_supported')
    expect(host.listening).toBe(false)
  })
})

describe('requests and responses', () => {
  it('matches responses to requests by id, in any order', async () => {
    const {host, seed} = await connected()
    const a = seed.call('storage.get', {key: 'a'})
    const b = seed.call('storage.get', {key: 'b'})
    const [reqA, reqB] = host.posted.slice(-2)
    expect(reqA?.params).toEqual({key: 'a'})
    expect(reqB?.params).toEqual({key: 'b'})
    expect(reqA?.id).not.toBe(reqB?.id)
    host.reply(reqB!.id, {value: 'B'})
    host.reply(reqA!.id, {value: 'A'})
    expect(await a).toEqual({value: 'A'})
    expect(await b).toEqual({value: 'B'})
  })

  it('maps error payloads to ExtensionError with the code preserved', async () => {
    const {host, seed} = await connected()
    const call = seed.sign.comment({targetId: 'hm://z6MkSite', markdown: 'hi'})
    host.fail(host.last().id, {code: 'user_rejected', message: 'nope', data: {reason: 'x'}})
    const error = await call.catch((e) => e)
    expect(error).toBeInstanceOf(ExtensionError)
    expect(error.code).toBe('user_rejected')
    expect(error.message).toBe('nope')
    expect(error.data).toEqual({reason: 'x'})
  })

  it('ignores responses for unknown ids and stray requests', async () => {
    const {host, seed} = await connected()
    host.reply(9999, {value: 'x'})
    expect(seed.context).toEqual(context)
  })

  it('wraps the convenience methods around the right bridge calls', async () => {
    const {host, seed} = await connected()

    const resource = seed.getResource('hm://z6MkSite/doc', {version: 'v1'})
    expect(host.last()).toMatchObject({
      method: 'api.query',
      params: {key: 'Resource', input: {id: 'hm://z6MkSite/doc?v=v1'}},
    })
    host.reply(host.last().id, {type: 'not-found'})
    expect(await resource).toEqual({type: 'not-found'})

    const search = seed.search('needle', {accountUid: 'z6MkSite'})
    expect(host.last()).toMatchObject({
      method: 'api.query',
      params: {key: 'Search', input: {query: 'needle', accountUid: 'z6MkSite'}},
    })
    host.reply(host.last().id, {entities: [], searchQuery: 'needle', nextPageToken: ''})
    expect((await search).entities).toEqual([])

    const url = seed.fileUrl('bafy1')
    expect(host.last()).toMatchObject({method: 'file.url', params: {cid: 'bafy1'}})
    host.reply(host.last().id, {url: 'https://example.com/ipfs/bafy1'})
    expect(await url).toBe('https://example.com/ipfs/bafy1')

    const file = seed.readFile('bafy2')
    host.reply(host.last().id, {base64: base64Encode(new Uint8Array([1, 2, 3]))})
    expect(await file).toEqual(new Uint8Array([1, 2, 3]))

    const nav = seed.navigate('hm://z6MkSite', {replace: true})
    expect(host.last()).toMatchObject({method: 'navigate', params: {url: 'hm://z6MkSite', replace: true}})
    host.reply(host.last().id, null)
    await nav

    const route = seed.setRoute(['card', '1'], {tab: 'x'})
    expect(host.last()).toMatchObject({method: 'route.set', params: {subPath: ['card', '1'], query: {tab: 'x'}}})
    host.reply(host.last().id, null)
    await route

    const keys = seed.storage.keys()
    expect(host.last()).toMatchObject({method: 'storage.keys', params: {}})
    host.reply(host.last().id, {keys: ['a']})
    expect(await keys).toEqual(['a'])

    const set = seed.storage.set('a', '1')
    expect(host.last()).toMatchObject({method: 'storage.set', params: {key: 'a', value: '1'}})
    host.reply(host.last().id, null)
    await set

    const toast = seed.toast('hi', 'success')
    expect(host.last()).toMatchObject({method: 'ui.toast', params: {message: 'hi', kind: 'success'}})
    host.reply(host.last().id, null)
    await toast
  })

  it('sign.data base64-encodes input and decodes the signature', async () => {
    const {host, seed} = await connected()
    const call = seed.sign.data('hello', 'Prove it')
    expect(host.last()).toMatchObject({method: 'sign.data', params: {base64: 'aGVsbG8=', purpose: 'Prove it'}})
    host.reply(host.last().id, {
      signature: base64Encode(new Uint8Array([9, 8, 7])),
      signer: 'z6MkDevice',
      accountId: 'z6MkUser',
    })
    const result = await call
    expect(result.signature).toEqual(new Uint8Array([9, 8, 7]))
    expect(result.signer).toBe('z6MkDevice')
    expect(result.accountId).toBe('z6MkUser')

    seed.sign.data(new Uint8Array([255]), 'bytes')
    expect(host.last().params).toMatchObject({base64: '/w=='})
  })
})

describe('context events', () => {
  it('onContext fires immediately and on every context event until unsubscribed', async () => {
    const {host, seed} = await connected()
    const seen: ExtensionContext[] = []
    const stop = seed.onContext((c) => seen.push(c))
    expect(seen).toHaveLength(1)

    const next = {...context, theme: 'dark' as const, user: null}
    host.emit('context', next)
    expect(seen).toHaveLength(2)
    expect(seed.context.theme).toBe('dark')
    expect(seed.user).toBeNull()

    stop()
    host.emit('context', context)
    expect(seen).toHaveLength(2)
    expect(seed.context).toEqual(context)
  })

  it('hasPermission reflects the granted permissions', async () => {
    const {host, seed} = await connected()
    expect(seed.hasPermission('sign')).toBe(true)
    expect(seed.hasPermission('navigate')).toBe(false)
    host.emit('context', {...context, permissions: ['navigate']})
    expect(seed.hasPermission('sign')).toBe(false)
    expect(seed.hasPermission('navigate')).toBe(true)
  })
})

describe('disconnect', () => {
  it('rejects pending and future calls and stops listening', async () => {
    const {host, seed} = await connected()
    const pending = seed.call('getContext', {})
    seed.disconnect()
    await expect(pending).rejects.toMatchObject({code: 'internal'})
    await expect(seed.call('getContext', {})).rejects.toBeInstanceOf(ExtensionError)
    expect(host.listening).toBe(false)
  })
})

describe('hmRef', () => {
  it('appends the version as the v query parameter', () => {
    expect(hmRef('hm://a/b')).toEqual({id: 'hm://a/b'})
    expect(hmRef('hm://a/b', 'v 1')).toEqual({id: 'hm://a/b?v=v%201'})
    expect(hmRef('hm://a/b?l', 'v1')).toEqual({id: 'hm://a/b?l&v=v1'})
  })
})

describe('window transport', () => {
  it('posts to window.parent with "*" and only accepts messages from it', () => {
    const parent = {postMessage: vi.fn()}
    const original = Object.getOwnPropertyDescriptor(window, 'parent')
    Object.defineProperty(window, 'parent', {value: parent, configurable: true})
    try {
      const transport = createWindowTransport()
      const message: ExtensionMessage = {
        [EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION,
        type: 'request',
        id: 1,
        method: 'hello',
        params: {},
      }
      transport.post(message)
      expect(parent.postMessage).toHaveBeenCalledWith(message, '*')

      const received: ExtensionMessage[] = []
      const stop = transport.listen((m) => received.push(m))
      const response: ExtensionMessage = {
        [EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION,
        type: 'response',
        id: 1,
        result: null,
      }
      const dispatch = (data: unknown, source: unknown) => {
        const event = new MessageEvent('message', {data})
        Object.defineProperty(event, 'source', {value: source})
        window.dispatchEvent(event)
      }
      dispatch(response, {}) // someone else
      dispatch({hello: 'world'}, parent) // not a bridge message
      expect(received).toHaveLength(0)
      dispatch(response, parent)
      expect(received).toEqual([response])
      stop()
      dispatch(response, parent)
      expect(received).toHaveLength(1)
    } finally {
      if (original) Object.defineProperty(window, 'parent', original)
    }
  })
})
