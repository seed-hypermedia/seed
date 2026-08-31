import {
  EXTENSION_MESSAGE_TAG,
  EXTENSION_PROTOCOL_VERSION,
  ExtensionError,
  type ExtensionContext,
  type ExtensionMessage,
  type ExtensionResponseMessage,
} from '@seed-hypermedia/client/extensions'
import {describe, expect, it, vi} from 'vitest'
import {createExtensionBridgeServer, toExtensionErrorPayload} from '../extensions/bridge-server'

const TRUSTED = {name: 'iframe-window'}
const UNTRUSTED = {name: 'other-window'}

function makeContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    protocol: EXTENSION_PROTOCOL_VERSION,
    platform: 'web',
    extensionId: 'hm://z6MkAuthor/kanban',
    extensionVersion: 'bafyVersion',
    manifest: {
      manifestVersion: 1,
      kind: 'page',
      version: '0.1.0',
      entry: 'ipfs://bafkEntry',
      permissions: ['navigate'],
    },
    site: {uid: 'z6MkSite', name: 'Site'},
    mountPath: 'board',
    subPath: [],
    query: {},
    settings: {},
    user: null,
    theme: 'light',
    permissions: ['navigate'],
    dev: false,
    ...overrides,
  }
}

function request(id: number, method: string, params: unknown, source: unknown = TRUSTED): MessageEvent {
  return {
    source,
    data: {[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION, type: 'request', id, method, params},
  } as unknown as MessageEvent
}

function setup(opts: {context?: ExtensionContext; handlers?: Record<string, (p: unknown) => Promise<unknown>>} = {}) {
  const posted: ExtensionMessage[] = []
  const context = opts.context ?? makeContext()
  const server = createExtensionBridgeServer({
    post: (msg) => posted.push(msg),
    isTrustedSource: (s) => s === TRUSTED,
    getContext: () => context,
    handlers: (opts.handlers ?? {}) as never,
    onError: () => {},
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const responses = () => posted.filter((m): m is ExtensionResponseMessage => m.type === 'response')
  return {server, posted, flush, responses}
}

describe('createExtensionBridgeServer', () => {
  it('answers hello and getContext with the current context', async () => {
    const {server, flush, responses} = setup()
    server.handleMessage(request(1, 'hello', {protocol: 1, sdkVersion: '0.0.1'}))
    server.handleMessage(request(2, 'getContext', {}))
    await flush()
    expect(responses()).toHaveLength(2)
    expect(responses()[0]).toMatchObject({id: 1, result: {extensionId: 'hm://z6MkAuthor/kanban'}})
    expect(responses()[1]).toMatchObject({id: 2, result: {mountPath: 'board'}})
  })

  it('ignores untrusted sources and non-extension messages', async () => {
    const {server, flush, posted} = setup()
    server.handleMessage(request(1, 'hello', {protocol: 1}, UNTRUSTED))
    server.handleMessage({source: TRUSTED, data: {hello: 'world'}} as unknown as MessageEvent)
    server.handleMessage({source: TRUSTED, data: 'string'} as unknown as MessageEvent)
    server.handleMessage({
      source: TRUSTED,
      data: {[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION, type: 'response', id: 9},
    } as unknown as MessageEvent)
    await flush()
    expect(posted).toHaveLength(0)
  })

  it('rejects unknown methods with unknown_method', async () => {
    const {server, flush, responses} = setup()
    server.handleMessage(request(1, 'nope.method', {}))
    await flush()
    expect(responses()[0]?.error).toMatchObject({code: 'unknown_method'})
  })

  it('validates params and answers invalid_params', async () => {
    const handler = vi.fn(async () => ({url: 'x'}))
    const {server, flush, responses} = setup({handlers: {'file.url': handler}})
    server.handleMessage(request(1, 'file.url', {}))
    server.handleMessage(request(2, 'api.query', {key: 'PublishBlobs', input: {}}))
    await flush()
    expect(responses()[0]?.error?.code).toBe('invalid_params')
    expect(responses()[1]?.error?.code).toBe('invalid_params')
    expect(handler).not.toHaveBeenCalled()
  })

  it('enforces method permissions against the live context', async () => {
    const signHandler = vi.fn(async () => ({signature: 's', signer: 'z', accountId: 'a'}))
    const navHandler = vi.fn(async () => null)
    const {server, flush, responses} = setup({
      handlers: {'sign.data': signHandler, navigate: navHandler},
    })
    server.handleMessage(request(1, 'sign.data', {base64: 'AA==', purpose: 'test'}))
    server.handleMessage(request(2, 'navigate', {url: '/x'}))
    await flush()
    expect(responses()[0]?.error).toMatchObject({code: 'permission_denied', data: {permission: 'sign'}})
    expect(signHandler).not.toHaveBeenCalled()
    expect(responses()[1]).toMatchObject({id: 2, result: null})
    expect(navHandler).toHaveBeenCalledWith({url: '/x'})
  })

  it('maps ExtensionError to its payload and other errors to internal without a stack', async () => {
    const {server, flush, responses} = setup({
      handlers: {
        'file.url': async () => {
          throw new ExtensionError('not_supported', 'nope', {why: 'test'})
        },
        'ui.toast': async () => {
          throw new Error('boom')
        },
      },
    })
    server.handleMessage(request(1, 'file.url', {cid: 'bafk'}))
    server.handleMessage(request(2, 'ui.toast', {message: 'hi'}))
    await flush()
    expect(responses()[0]?.error).toEqual({code: 'not_supported', message: 'nope', data: {why: 'test'}})
    expect(responses()[1]?.error).toEqual({code: 'internal', message: 'boom'})
    expect(JSON.stringify(responses()[1])).not.toContain('at ')
  })

  it('answers not_supported when a known method has no handler', async () => {
    const {server, flush, responses} = setup()
    server.handleMessage(request(1, 'ui.setTitle', {title: 'x'}))
    await flush()
    expect(responses()[0]?.error?.code).toBe('not_supported')
  })

  it('responds exactly once per request id and converts undefined results to null', async () => {
    const {server, flush, responses} = setup({handlers: {'ui.toast': async () => undefined}})
    server.handleMessage(request(7, 'ui.toast', {message: 'x'}))
    await flush()
    expect(responses()).toHaveLength(1)
    expect(responses()[0]).toEqual({
      [EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION,
      type: 'response',
      id: 7,
      result: null,
    })
  })

  it('emits events and stops after dispose', async () => {
    const {server, posted, flush} = setup()
    const context = makeContext({theme: 'dark'})
    server.emit('context', context)
    expect(posted[0]).toEqual({
      [EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION,
      type: 'event',
      event: 'context',
      data: context,
    })
    server.dispose()
    server.emit('context', context)
    server.handleMessage(request(1, 'hello', {protocol: 1}))
    await flush()
    expect(posted).toHaveLength(1)
  })
})

describe('dispose is final (StrictMode double-mount)', () => {
  it('a disposed server never answers again; a fresh server created per effect does', async () => {
    // React StrictMode runs mount → cleanup → mount in development. ExtensionFrame
    // therefore creates the server inside the effect: a server disposed by the
    // first cleanup must stay dead, and the remounted effect's new server must
    // answer `hello` on its own.
    const posted: ExtensionMessage[] = []
    const context = makeContext()
    const make = () =>
      createExtensionBridgeServer({
        post: (msg) => posted.push(msg),
        isTrustedSource: (s) => s === TRUSTED,
        getContext: () => context,
        handlers: {},
      })
    const first = make()
    first.dispose()
    first.handleMessage(request(1, 'hello', {protocol: 1}))
    first.emit('context', context)
    await new Promise((r) => setTimeout(r, 0))
    expect(posted).toHaveLength(0)

    const second = make()
    second.handleMessage(request(1, 'hello', {protocol: 1}))
    await new Promise((r) => setTimeout(r, 0))
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({type: 'response', id: 1, result: {mountPath: 'board'}})
    second.dispose()
  })
})

describe('toExtensionErrorPayload', () => {
  it('accepts error-shaped plain objects with known codes', () => {
    expect(toExtensionErrorPayload({code: 'user_rejected', message: 'no'})).toEqual({
      code: 'user_rejected',
      message: 'no',
      data: undefined,
    })
    expect(toExtensionErrorPayload({code: 'weird', message: 'no'})).toEqual({
      code: 'internal',
      message: 'Unknown error',
    })
    expect(toExtensionErrorPayload('str')).toEqual({code: 'internal', message: 'str'})
  })
})
