import {describe, expect, it, vi} from 'vitest'
import {
  DOCUMENT_PAGE_CLIENT_SCRIPT,
  DOCUMENT_PAGE_METHODS,
  DOCUMENT_PAGE_SDK_VERSION,
  documentPageRuntime,
  parseDocumentPageLink,
  DOCUMENT_PAGE_MAX_REQUEST_BYTES,
  createDocumentPageMessageListener,
  documentPageContentSecurityPolicy,
  documentPageOrigin,
  isDocumentPageURL,
  parseDocumentPageReference,
  parseDocumentPageRequest,
} from './document-page'

const host = 'a'.repeat(40)

describe('document page references and origins', () => {
  it('reads the folder CID from the page attribute', () => {
    expect(parseDocumentPageReference('ipfs://bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e')).toBe(
      'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
    )
    expect(parseDocumentPageReference('bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e')).toBe(
      'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
    )
    expect(parseDocumentPageReference('ipfs://bafy/index.html')).toBeNull()
    expect(parseDocumentPageReference('https://example.com')).toBeNull()
    expect(parseDocumentPageReference(42)).toBeNull()
  })

  it('recognizes well-formed page URLs', () => {
    expect(isDocumentPageURL(`seed-page://${host}/`)).toBe(true)
    expect(isDocumentPageURL(`seed-page://${host}/assets/page.js`)).toBe(true)
    expect(isDocumentPageURL('seed-page://localhost/')).toBe(false)
    expect(isDocumentPageURL(`https://${host}/`)).toBe(false)
    expect(isDocumentPageURL('not a url')).toBe(false)
    expect(documentPageOrigin(`seed-page://${host}/index.html`)).toBe(`seed-page://${host}`)
    expect(() => documentPageOrigin('https://example.com/')).toThrow()
  })

  it('keeps the page inside its own folder and names who may embed it', () => {
    const csp = documentPageContentSecurityPolicy(['http://localhost:17654'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain('frame-ancestors http://localhost:17654')
    expect(csp).not.toContain('https:')
    expect(documentPageContentSecurityPolicy([])).toContain("frame-ancestors 'none'")
  })

  it('ships a client that only talks to its parent and defines the read methods', () => {
    expect(DOCUMENT_PAGE_CLIENT_SCRIPT).toContain('event.source !== host')
    for (const method of ['context', 'resource', 'directory'])
      expect(DOCUMENT_PAGE_CLIENT_SCRIPT).toContain(`'${method}'`)
  })
})

describe('parseDocumentPageRequest', () => {
  it('accepts well-formed requests and rejects the rest', () => {
    expect(parseDocumentPageRequest({seedPage: 1, id: 'r1', method: 'context'})).toEqual({
      seedPage: 1,
      id: 'r1',
      method: 'context',
      params: undefined,
    })
    expect(parseDocumentPageRequest({seedPage: 2, id: 'r1', method: 'context'})).toBeNull()
    expect(parseDocumentPageRequest({seedPage: 1, id: '', method: 'context'})).toBeNull()
    expect(parseDocumentPageRequest({seedPage: 1, id: 'r1', method: 'write'})).toBeNull()
    expect(
      parseDocumentPageRequest({
        seedPage: 1,
        id: 'r1',
        method: 'resource',
        params: {url: 'x'.repeat(DOCUMENT_PAGE_MAX_REQUEST_BYTES)},
      }),
    ).toBeNull()
    expect(parseDocumentPageRequest('nope')).toBeNull()
  })
})

describe('createDocumentPageMessageListener', () => {
  const origin = `seed-page://${host}`
  function setup(handle = vi.fn(async () => 'ok')) {
    const contentWindow = {postMessage: vi.fn()}
    const frame = {contentWindow} as unknown as HTMLIFrameElement
    const listener = createDocumentPageMessageListener({frame: () => frame, origin, handle})
    return {listener, contentWindow, handle}
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('answers a request from the page frame at the page origin', async () => {
    const {listener, contentWindow, handle} = setup()
    listener({
      source: contentWindow,
      origin,
      data: {seedPage: 1, id: 'r1', method: 'context'},
    } as unknown as MessageEvent)
    await flush()
    expect(handle).toHaveBeenCalledWith({seedPage: 1, id: 'r1', method: 'context', params: undefined})
    expect(contentWindow.postMessage).toHaveBeenCalledWith({seedPage: 1, id: 'r1', result: 'ok'}, origin)
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
      data: {seedPage: 1, id: 'r2', method: 'resource', params: {}},
    } as unknown as MessageEvent)
    await flush()
    expect(contentWindow.postMessage).toHaveBeenCalledWith({seedPage: 1, id: 'r2', error: 'nope'}, origin)
  })

  it('ignores other windows, other origins and malformed messages', async () => {
    const {listener, contentWindow, handle} = setup()
    const stranger = {postMessage: vi.fn()}
    listener({source: stranger, origin, data: {seedPage: 1, id: 'r3', method: 'context'}} as unknown as MessageEvent)
    listener({
      source: contentWindow,
      origin: 'https://evil.example',
      data: {seedPage: 1, id: 'r4', method: 'context'},
    } as unknown as MessageEvent)
    listener({source: contentWindow, origin, data: {type: 'seed-page-result', value: 1}} as unknown as MessageEvent)
    await flush()
    expect(handle).not.toHaveBeenCalled()
    expect(contentWindow.postMessage).not.toHaveBeenCalled()
    expect(stranger.postMessage).not.toHaveBeenCalled()
  })
})

describe('document page navigation and runtime contract', () => {
  it('preserves explicit servers, document versions and block references', () => {
    for (const url of ['hm://alice/doc?v=revision#block', 'https://private.example/hm/alice/doc?v=revision#block']) {
      expect(parseDocumentPageLink({url, newWindow: true})).toEqual({url, newWindow: true})
    }
    expect(parseDocumentPageLink({url: ' HM://alice/doc '})).toEqual({url: 'hm://alice/doc', newWindow: false})
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://user:password@example.com',
      '/relative',
      'https://exa\nmple.com',
    ]) {
      expect(() => parseDocumentPageLink({url})).toThrow()
    }
    expect(() => parseDocumentPageLink({url: 'hm://alice/doc', newWindow: 'yes'})).toThrow()
    expect(() => parseDocumentPageLink({url: 'hm://alice/doc', account: 'someone'})).toThrow()
  })
  it('reports the implementation fingerprint and honest persistence semantics', async () => {
    const web = await documentPageRuntime('web')
    const desktop = await documentPageRuntime('desktop')
    expect(web.sdkVersion).toBe(DOCUMENT_PAGE_SDK_VERSION)
    expect(web.sdkDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(desktop.sdkDigest).toBe(web.sdkDigest)
    expect(web.methods).toEqual([...DOCUMENT_PAGE_METHODS])
    expect(web.storage).toMatchObject({scope: 'viewer/document', persistence: 'device-only', synced: false})
    expect(web.authority).toBe('scoped-page-permissions')
  })
})
