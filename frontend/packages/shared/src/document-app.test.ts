import {describe, expect, it, vi} from 'vitest'
import {
  DOCUMENT_APP_CLIENT_SCRIPT,
  DOCUMENT_APP_METHODS,
  DOCUMENT_APP_SDK_VERSION,
  documentAppRuntime,
  parseDocumentAppLink,
  DOCUMENT_APP_MAX_REQUEST_BYTES,
  createDocumentAppMessageListener,
  documentAppContentSecurityPolicy,
  documentAppHostFromDigest,
  documentAppOrigin,
  isDocumentAppURL,
  parseDocumentAppReference,
  parseDocumentAppRequest,
} from './document-app'

const host = 'a'.repeat(40)

describe('document app references and origins', () => {
  it('reads the folder CID from the app attribute', () => {
    expect(parseDocumentAppReference('ipfs://bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e')).toBe(
      'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
    )
    expect(parseDocumentAppReference('bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e')).toBe(
      'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
    )
    expect(parseDocumentAppReference('ipfs://bafy/index.html')).toBeNull()
    expect(parseDocumentAppReference('https://example.com')).toBeNull()
    expect(parseDocumentAppReference(42)).toBeNull()
  })

  it('derives a well-formed host and recognizes app URLs by it', () => {
    const digest = 'ABCDEF0123456789'.repeat(4)
    expect(documentAppHostFromDigest(digest)).toBe(digest.toLowerCase().slice(0, 40))
    expect(() => documentAppHostFromDigest('nope')).toThrow()
    expect(isDocumentAppURL(`seed-app://${host}/`)).toBe(true)
    expect(isDocumentAppURL(`seed-app://${host}/assets/app.js`)).toBe(true)
    expect(isDocumentAppURL('seed-app://localhost/')).toBe(false)
    expect(isDocumentAppURL(`https://${host}/`)).toBe(false)
    expect(isDocumentAppURL('not a url')).toBe(false)
    expect(documentAppOrigin(`seed-app://${host}/index.html`)).toBe(`seed-app://${host}`)
    expect(() => documentAppOrigin('https://example.com/')).toThrow()
  })

  it('keeps the app inside its own folder and names who may embed it', () => {
    const csp = documentAppContentSecurityPolicy(['http://localhost:17654'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain('frame-ancestors http://localhost:17654')
    expect(csp).not.toContain('https:')
    expect(documentAppContentSecurityPolicy([])).toContain("frame-ancestors 'none'")
  })

  it('ships a client that only talks to its parent and defines the read methods', () => {
    expect(DOCUMENT_APP_CLIENT_SCRIPT).toContain('event.source !== host')
    for (const method of ['context', 'resource', 'directory'])
      expect(DOCUMENT_APP_CLIENT_SCRIPT).toContain(`'${method}'`)
  })
})

describe('parseDocumentAppRequest', () => {
  it('accepts well-formed requests and rejects the rest', () => {
    expect(parseDocumentAppRequest({seedApp: 1, id: 'r1', method: 'context'})).toEqual({
      seedApp: 1,
      id: 'r1',
      method: 'context',
      params: undefined,
    })
    expect(parseDocumentAppRequest({seedApp: 2, id: 'r1', method: 'context'})).toBeNull()
    expect(parseDocumentAppRequest({seedApp: 1, id: '', method: 'context'})).toBeNull()
    expect(parseDocumentAppRequest({seedApp: 1, id: 'r1', method: 'write'})).toBeNull()
    expect(
      parseDocumentAppRequest({
        seedApp: 1,
        id: 'r1',
        method: 'resource',
        params: {url: 'x'.repeat(DOCUMENT_APP_MAX_REQUEST_BYTES)},
      }),
    ).toBeNull()
    expect(parseDocumentAppRequest('nope')).toBeNull()
  })
})

describe('createDocumentAppMessageListener', () => {
  const origin = `seed-app://${host}`
  function setup(handle = vi.fn(async () => 'ok')) {
    const contentWindow = {postMessage: vi.fn()}
    const frame = {contentWindow} as unknown as HTMLIFrameElement
    const listener = createDocumentAppMessageListener({frame: () => frame, origin, handle})
    return {listener, contentWindow, handle}
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('answers a request from the app frame at the app origin', async () => {
    const {listener, contentWindow, handle} = setup()
    listener({
      source: contentWindow,
      origin,
      data: {seedApp: 1, id: 'r1', method: 'context'},
    } as unknown as MessageEvent)
    await flush()
    expect(handle).toHaveBeenCalledWith({seedApp: 1, id: 'r1', method: 'context', params: undefined})
    expect(contentWindow.postMessage).toHaveBeenCalledWith({seedApp: 1, id: 'r1', result: 'ok'}, origin)
  })

  it('reports handler errors as error responses', async () => {
    const {listener, contentWindow} = setup(
      vi.fn(async () => {
        throw new Error('nope')
      }),
    )
    listener({
      source: contentWindow,
      origin,
      data: {seedApp: 1, id: 'r2', method: 'resource', params: {}},
    } as unknown as MessageEvent)
    await flush()
    expect(contentWindow.postMessage).toHaveBeenCalledWith({seedApp: 1, id: 'r2', error: 'nope'}, origin)
  })

  it('ignores other windows, other origins and malformed messages', async () => {
    const {listener, contentWindow, handle} = setup()
    const stranger = {postMessage: vi.fn()}
    listener({source: stranger, origin, data: {seedApp: 1, id: 'r3', method: 'context'}} as unknown as MessageEvent)
    listener({
      source: contentWindow,
      origin: 'https://evil.example',
      data: {seedApp: 1, id: 'r4', method: 'context'},
    } as unknown as MessageEvent)
    listener({source: contentWindow, origin, data: {type: 'seed-app-result', value: 1}} as unknown as MessageEvent)
    await flush()
    expect(handle).not.toHaveBeenCalled()
    expect(contentWindow.postMessage).not.toHaveBeenCalled()
    expect(stranger.postMessage).not.toHaveBeenCalled()
  })
})

describe('document app navigation and runtime contract', () => {
  it('preserves explicit servers, document versions and block references', () => {
    for (const url of ['hm://alice/doc?v=revision#block', 'https://private.example/hm/alice/doc?v=revision#block']) {
      expect(parseDocumentAppLink({url, newWindow: true})).toEqual({url, newWindow: true})
    }
    expect(parseDocumentAppLink({url: ' HM://alice/doc '})).toEqual({url: 'hm://alice/doc', newWindow: false})
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://user:password@example.com',
      '/relative',
      'https://exa\nmple.com',
    ]) {
      expect(() => parseDocumentAppLink({url})).toThrow()
    }
    expect(() => parseDocumentAppLink({url: 'hm://alice/doc', newWindow: 'yes'})).toThrow()
    expect(() => parseDocumentAppLink({url: 'hm://alice/doc', account: 'someone'})).toThrow()
  })
  it('reports the implementation fingerprint and honest persistence semantics', async () => {
    const web = await documentAppRuntime('web')
    const desktop = await documentAppRuntime('desktop')
    expect(web.sdkVersion).toBe(DOCUMENT_APP_SDK_VERSION)
    expect(web.sdkDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(desktop.sdkDigest).toBe(web.sdkDigest)
    expect(web.methods).toEqual([...DOCUMENT_APP_METHODS])
    expect(web.storage).toMatchObject({scope: 'viewer/document', persistence: 'device-only', synced: false})
    expect(web.authority).toBe('full-account-session')
  })
})
