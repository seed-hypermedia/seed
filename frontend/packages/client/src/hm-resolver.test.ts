import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveHypermediaUrl, resolveId} from './hm-resolver'

describe('resolveHypermediaUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('resolves domain-based HM references through the cached domain resolver', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const domainResolver = vi.fn(async () => ({registeredAccountUid: 'z6MksiteUid', isGateway: true}))
    const result = await resolveId('hm://hyper.media/agent/guide?v=version-1#intro[2:5]', {domainResolver})
    expect(domainResolver).toHaveBeenCalledWith('hyper.media')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      id: 'hm://z6MksiteUid/agent/guide',
      uid: 'z6MksiteUid',
      path: ['agent', 'guide'],
      version: 'version-1',
      latest: false,
      blockRef: 'intro',
      blockRange: {start: 2, end: 5},
    })
  })

  it('resolves HM domains through HTTPS OPTIONS when not cached and fails unresolved aliases', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', {status: 200, headers: {'x-hypermedia-id': 'hm://z6MksiteUid/agent/guide'}}),
      )
      .mockResolvedValueOnce(new Response('', {status: 404}))
    await expect(resolveId('hm://hyper.media/agent/guide')).resolves.toMatchObject({uid: 'z6MksiteUid'})
    expect(fetchMock).toHaveBeenCalledWith('https://hyper.media/agent/guide', {method: 'OPTIONS'})
    await expect(resolveId('hm://missing.example/doc')).rejects.toThrow(
      'does not appear to be a Seed Hypermedia resource',
    )
  })

  it('distinguishes ordinary successful web responses from failed resolution in strict mode', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', {status: 200}))
      .mockResolvedValueOnce(new Response('', {status: 500}))
    await expect(
      resolveHypermediaUrl('https://ordinary.example/article', {requireSuccessfulResponse: true}),
    ).resolves.toBeNull()
    await expect(
      resolveHypermediaUrl('https://offline.example/article', {requireSuccessfulResponse: true}),
    ).rejects.toThrow('500')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed Hypermedia identity headers in strict mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {status: 200, headers: {'x-hypermedia-id': 'not-an-hm-id'}}),
    )
    await expect(
      resolveHypermediaUrl('https://site.example/article', {requireSuccessfulResponse: true}),
    ).rejects.toThrow('identity')
  })
  it('rejects incomplete Hypermedia metadata and network failures in strict mode', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', {status: 200, headers: {'x-hypermedia-version': 'version-without-id'}}))
      .mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(
      resolveHypermediaUrl('https://site.example/article', {requireSuccessfulResponse: true}),
    ).rejects.toThrow('identity')
    await expect(
      resolveHypermediaUrl('https://offline.example/article', {requireSuccessfulResponse: true}),
    ).rejects.toThrow('Network unavailable')
  })
  it('retains non-strict null behavior for an unsuccessful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', {status: 500}))
    await expect(resolveHypermediaUrl('https://offline.example/article')).resolves.toBeNull()
  })
  it('resolves custom-domain profile URLs from the domain resolver without fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const result = await resolveHypermediaUrl(
      'https://dream-machines-2.hyper.media/:profile/z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt',
      {
        domainResolver: async () => 'z6MksiteUid',
      },
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result?.id).toBe('hm://z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt/:profile')
    expect(result?.hmId.uid).toBe('z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt')
    expect(result?.hmId.path).toEqual([':profile'])
  })

  it('falls back to the domain resolver when the OPTIONS fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const domainResolver = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('z6MksiteUid')

    const result = await resolveHypermediaUrl('https://site.example/projects/seed?v=cid123#blk1[5:15]', {
      domainResolver,
    })

    expect(domainResolver).toHaveBeenCalledTimes(2)
    expect(result?.id).toBe('hm://z6MksiteUid/projects/seed')
    expect(result?.hmId.uid).toBe('z6MksiteUid')
    expect(result?.hmId.path).toEqual(['projects', 'seed'])
    expect(result?.hmId.version).toBe('cid123')
    expect(result?.hmId.blockRef).toBe('blk1')
    expect(result?.hmId.blockRange).toEqual({start: 5, end: 15})
    expect(result?.hmId.hostname).toBe('https://site.example')
  })

  it('uses /hm gateway paths as canonical ids when the domain store marks the domain as a gateway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveHypermediaUrl('https://hyper.media/hm/z6Mktarget/:profile', {
      domainResolver: async () => ({registeredAccountUid: 'z6Mkgateway', isGateway: true}),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolved?.id).toBe('hm://z6Mktarget/:profile')
    expect(resolved?.hmId).toMatchObject({
      uid: 'z6Mktarget',
      path: [':profile'],
      hostname: 'hyper.media',
      latest: true,
    })
  })

  it('keeps /hm paths relative to custom domains that are not gateways', async () => {
    const resolved = await resolveHypermediaUrl('https://example.com/hm/z6Mktarget/:profile', {
      domainResolver: async () => ({registeredAccountUid: 'z6Mkdomain', isGateway: false}),
    })

    expect(resolved?.id).toBe('hm://z6Mkdomain/hm/z6Mktarget/:profile')
    expect(resolved?.hmId).toMatchObject({
      uid: 'z6Mkdomain',
      path: ['hm', 'z6Mktarget', ':profile'],
      hostname: 'https://example.com',
      latest: true,
    })
  })
})
