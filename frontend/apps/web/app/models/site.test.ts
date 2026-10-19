import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  request: vi.fn(),
  publish: vi.fn(),
  invalidate: vi.fn(),
  refreshHosting: vi.fn(),
}))
vi.mock('@/auth', () => ({keyPairStore: {get: mocks.identity}}))
vi.mock('@/universal-client', () => ({
  webUniversalClient: {request: mocks.request, publishDocument: mocks.publish},
}))
vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: mocks.invalidate,
  getQueryClient: () => ({invalidateQueries: mocks.refreshHosting}),
}))

import {registerSite, removeSite, updateHomeDocument, updateMovedSitePublication} from './site'

const identity = {id: 'session-key', delegatedAccountUid: 'alice', capabilityCid: 'owner-session-capability'}
const setupUrl = 'https://myspace.hyper.media/hm/register?secret=setup-secret'
const oldUrl = 'https://old.hyper.media'
const newUrl = 'https://new.hyper.media'

function document(siteUrl = oldUrl) {
  return {
    account: 'alice',
    path: '',
    version: 'latest-version',
    genesis: 'home-genesis',
    generationInfo: {generation: 12n},
    metadata: {name: 'My Space', siteUrl},
    visibility: 'PUBLIC',
  } as HMDocument
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}})
}

describe('browser site publication', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.identity.mockReturnValue(identity)
    mocks.request.mockResolvedValue({type: 'document', document: document()})
    mocks.publish.mockResolvedValue(undefined)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {location: {origin: 'https://hyper.media'}})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('merges identity edits with latest metadata and leaves root content/navigation unchanged', async () => {
    const latest = {
      ...document('https://concurrent.example'),
      metadata: {
        name: 'My Space',
        siteUrl: 'https://concurrent.example',
        customField: 'concurrent value',
        theme: {headerLayout: 'Center'},
      },
      content: [{block: {id: 'body', text: 'Existing home content'}}],
      detachedBlocks: {navigation: {children: [{block: {id: 'nav', type: 'Link', link: 'https://example.com'}}]}},
    }
    mocks.request.mockResolvedValue({type: 'document', document: latest})
    await updateHomeDocument('alice', {updateMetadata: (current) => ({...current, name: 'Updated name'})})
    const publication = mocks.publish.mock.calls[0]![0]
    expect(publication).toMatchObject({baseVersion: 'latest-version', capability: 'owner-session-capability'})
    expect(publication.changes).toHaveLength(1)
    expect(publication.changes[0].op).toMatchObject({
      case: 'setAttribute',
      value: {blockId: '', key: ['name'], value: {case: 'stringValue', value: 'Updated name'}},
    })
  })

  it('preserves the current identity and links when only changing content width', async () => {
    await updateHomeDocument('alice', {updateMetadata: (current) => ({...current, contentWidth: 'M'})})
    const changes = mocks.publish.mock.calls[0]![0].changes
    expect(changes).toHaveLength(1)
    expect(changes[0].op).toMatchObject({
      case: 'setAttribute',
      value: {key: ['contentWidth'], value: {case: 'stringValue', value: 'M'}},
    })
  })

  it('rejects settings edits if the account changes during the latest-home request', async () => {
    mocks.request.mockImplementation(async () => {
      mocks.identity.mockReturnValue({...identity, delegatedAccountUid: 'bob'})
      return {type: 'document', document: document()}
    })
    await expect(
      updateHomeDocument('alice', {updateMetadata: (current) => ({...current, name: 'New'})}),
    ).rejects.toThrow('Your account changed')
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each(['https://myspace.hyper.media', 'https://my-own-server.example:8443'])(
    'registers %s from the current gateway peer and signs with the owner delegation',
    async (origin) => {
      fetchMock
        .mockResolvedValueOnce(response({peerId: 'destination-peer'}))
        .mockResolvedValueOnce(response({peerId: 'source-peer', addrs: ['/dns4/source.test/tcp/4001']}))
        .mockResolvedValueOnce(response({message: 'Success'}))
      mocks.request
        .mockResolvedValueOnce({type: 'document', document: {...document(), version: 'before-registration'}})
        .mockResolvedValueOnce({type: 'document', document: document()})

      expect(await registerSite('alice', `${origin}/hm/register?secret=setup-secret`)).toBe(origin)
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${origin}/hm/api/config`,
        'https://hyper.media/hm/api/config',
        `${origin}/hm/api/register`,
      ])
      const options = fetchMock.mock.calls[2]![1]
      expect(options).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        headers: {'Content-Type': 'application/json'},
      })
      expect(JSON.parse(options.body)).toEqual({
        registrationSecret: 'setup-secret',
        accountUid: 'alice',
        peerId: 'source-peer',
        addrs: ['/dns4/source.test/tcp/4001'],
      })
      expect(mocks.publish).toHaveBeenCalledWith({
        account: 'alice',
        signerAccountUid: 'alice',
        capability: 'owner-session-capability',
        baseVersion: 'latest-version',
        genesis: 'home-genesis',
        generation: 12n,
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: origin}}}],
      })
      expect(mocks.invalidate).toHaveBeenCalledTimes(3)
    },
  )

  it('allows same-peer registration without reachable addresses for a local shared daemon', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'shared-peer'}))
      .mockResolvedValueOnce(response({peerId: 'shared-peer', addrs: []}))
      .mockResolvedValueOnce(response({message: 'Success'}))
    await registerSite('alice', setupUrl)
    expect(mocks.publish).toHaveBeenCalledOnce()
  })

  it('refreshes the authenticated hosting list after registration before returning publication success', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'shared-peer'}))
      .mockResolvedValueOnce(response({peerId: 'shared-peer', addrs: []}))
      .mockResolvedValueOnce(response({message: 'Success'}))
    let finishRefresh!: () => void
    mocks.refreshHosting.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )
    let complete = false
    const publication = registerSite('alice', setupUrl).then((url) => {
      complete = true
      return url
    })
    await vi.waitFor(() =>
      expect(mocks.refreshHosting).toHaveBeenCalledExactlyOnceWith({
        queryKey: ['HOST_SITES', SEED_HOST_URL],
      }),
    )
    expect(mocks.publish.mock.invocationCallOrder[0]).toBeLessThan(mocks.refreshHosting.mock.invocationCallOrder[0]!)
    expect(complete).toBe(false)
    finishRefresh()
    expect(await publication).toBe('https://myspace.hyper.media')
  })

  it('removes the publishing peer suffix from real gateway addresses before registration appends it', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'destination-peer'}))
      .mockResolvedValueOnce(
        response({
          peerId: 'source-peer',
          addrs: [
            '/dns4/dev.hyper.media/tcp/56001/p2p/source-peer',
            '/dns4/dev.hyper.media/udp/56001/quic-v1/p2p/source-peer',
            '/dns4/relay.test/tcp/4001/p2p/relay-peer/p2p-circuit/p2p/source-peer',
            '/dns4/bare.test/tcp/4001',
          ],
        }),
      )
      .mockResolvedValueOnce(response({message: 'Success'}))
    await registerSite('alice', setupUrl)
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).addrs).toEqual([
      '/dns4/dev.hyper.media/tcp/56001',
      '/dns4/dev.hyper.media/udp/56001/quic-v1',
      '/dns4/relay.test/tcp/4001/p2p/relay-peer/p2p-circuit',
      '/dns4/bare.test/tcp/4001',
    ])
  })

  it('recovers metadata publication after registration already succeeded without needing its consumed secret', async () => {
    fetchMock.mockResolvedValueOnce(response({registeredAccountUid: 'alice'}))
    await registerSite('alice', 'https://myspace.hyper.media')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledOnce()
  })

  it('retries self-host publication after registration succeeds without consuming the secret again', async () => {
    const origin = 'https://self-host.example'
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'destination'}))
      .mockResolvedValueOnce(response({peerId: 'source', addrs: ['/dns4/gateway.example/tcp/4001']}))
      .mockResolvedValueOnce(response({message: 'Success'}))
      .mockResolvedValueOnce(response({registeredAccountUid: 'alice'}))
    mocks.publish.mockRejectedValueOnce(new Error('Publication temporarily failed'))
    await expect(registerSite('alice', `${origin}/hm/register?secret=one-use-secret`)).rejects.toThrow(
      'Publication temporarily failed',
    )
    mocks.request.mockResolvedValue({type: 'document', document: {...document(), version: 'retry-version'}})
    await expect(registerSite('alice', origin)).resolves.toBe(origin)
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capability: 'owner-session-capability',
        baseVersion: 'retry-version',
      }),
    )
  })

  it('rejects a site registered to another space without changing metadata', async () => {
    fetchMock.mockResolvedValueOnce(response({registeredAccountUid: 'bob'}))
    await expect(registerSite('alice', setupUrl)).rejects.toThrow(
      'https://myspace.hyper.media is already registered to another space.',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('does not publish metadata when gateway registration fails', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'destination'}))
      .mockResolvedValueOnce(response({peerId: 'source', addrs: ['/dns4/source.test/tcp/4001']}))
      .mockResolvedValueOnce(response({message: 'Invalid registration secret'}, 403))
    await expect(registerSite('alice', setupUrl)).rejects.toThrow('Invalid registration secret')
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('requires a setup secret for an unregistered site', async () => {
    fetchMock.mockResolvedValueOnce(response({peerId: 'destination'}))
    await expect(registerSite('alice', 'https://myspace.hyper.media')).rejects.toThrow('registration secret')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each([{addrs: []}, {peerId: '', addrs: []}, {peerId: 'source', addrs: []}])(
    'does not register without a reachable source identity: %j',
    async (source) => {
      fetchMock.mockResolvedValueOnce(response({peerId: 'destination'})).mockResolvedValueOnce(response(source))
      await expect(registerSite('alice', setupUrl)).rejects.toThrow('reachable peer')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(mocks.publish).not.toHaveBeenCalled()
    },
  )

  it.each([null, {id: 'local-only'}, {...identity, delegatedAccountUid: 'bob'}, {...identity, capabilityCid: ''}])(
    'requires a delegated space owner before contacting hosting: %j',
    async (current) => {
      mocks.identity.mockReturnValue(current)
      await expect(registerSite('alice', setupUrl)).rejects.toThrow('space owner')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )

  it.each([
    {type: 'not-found'},
    {type: 'redirect'},
    {type: 'document', document: {...document(), visibility: 'PRIVATE'}},
  ])('does not register an unpublished, redirect, or private space ($type)', async (resource) => {
    mocks.request.mockResolvedValue(resource)
    await expect(registerSite('alice', setupUrl)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not consume a secret after an account change during config loading', async () => {
    fetchMock.mockResolvedValueOnce(response({peerId: 'destination'})).mockImplementationOnce(async () => {
      mocks.identity.mockReturnValue(null)
      return response({peerId: 'source', addrs: ['/dns4/source.test/tcp/4001']})
    })
    await expect(registerSite('alice', setupUrl)).rejects.toThrow('account changed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('does not sign with a changed account after gateway registration succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'destination'}))
      .mockResolvedValueOnce(response({peerId: 'source', addrs: ['/dns4/source.test/tcp/4001']}))
      .mockImplementationOnce(async () => {
        mocks.identity.mockReturnValue({...identity, id: 'new-session'})
        return response({message: 'Success'})
      })
    await expect(registerSite('alice', setupUrl)).rejects.toThrow('account changed')
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each([
    'not a URL?secret=hidden',
    'javascript:alert(1)',
    'file:///tmp/site?secret=hidden',
    'ftp://hosting.example',
    'https://user:password@myspace.hyper.media',
  ])('rejects invalid setup origin %s', async (url) => {
    await expect(registerSite('alice', url)).rejects.toThrow('web address')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each(['http://hosting.example', 'http://192.168.1.20:3000', 'http://localhost.example:3000'])(
    'explains HTTPS mixed-content failure before contacting %s',
    async (origin) => {
      await expect(registerSite('alice', `${origin}/hm/register?secret=hidden`)).rejects.toThrow('Enable HTTPS')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )

  it.each(['http://localhost:3000', 'http://site.localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'allows loopback HTTP development from an HTTPS page: %s',
    async (origin) => {
      fetchMock.mockResolvedValueOnce(response({registeredAccountUid: 'alice'}))
      await expect(registerSite('alice', origin)).resolves.toBe(origin)
      expect(fetchMock).toHaveBeenCalledWith(`${origin}/hm/api/config`, {credentials: 'omit'})
      expect(mocks.publish).toHaveBeenCalledOnce()
    },
  )

  it('allows HTTP hosting from an HTTP development page', async () => {
    vi.stubGlobal('window', {location: {origin: 'http://localhost:3000'}})
    fetchMock.mockResolvedValueOnce(response({registeredAccountUid: 'alice'}))
    await expect(registerSite('alice', 'http://192.168.1.20:3000')).resolves.toBe('http://192.168.1.20:3000')
  })

  it.each(['destination config', 'source config', 'registration'])(
    'explains an unreachable %s without exposing the setup secret',
    async (failureAt) => {
      if (failureAt !== 'destination config') fetchMock.mockResolvedValueOnce(response({peerId: 'destination'}))
      if (failureAt === 'registration') {
        fetchMock.mockResolvedValueOnce(response({peerId: 'source', addrs: ['/dns4/gateway.example/tcp/4001']}))
      }
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch https://self-host.example?secret=hidden'))
      const error = await registerSite('alice', 'https://self-host.example/hm/register?secret=hidden').catch(
        (error: unknown) => error,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Could not connect to')
      expect((error as Error).message).toContain('CORS')
      expect((error as Error).message).not.toContain('hidden')
      expect((error as Error).message).not.toContain('secret=')
      expect(mocks.publish).not.toHaveBeenCalled()
    },
  )

  it('updates a moved address against fresh metadata and keeps only the siteUrl mutation', async () => {
    await updateMovedSitePublication(hmId('alice', {version: 'stale-version'}), oldUrl, newUrl)
    expect(mocks.request).toHaveBeenCalledWith(
      'Resource',
      expect.objectContaining({uid: 'alice', version: null, latest: true}),
    )
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 'latest-version',
        capability: 'owner-session-capability',
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: newUrl}}}],
      }),
    )
  })

  it.each(['https://custom.example', newUrl, ''])(
    'preserves changed publication choice %s during move repair',
    async (siteUrl) => {
      mocks.request.mockResolvedValue({type: 'document', document: document(siteUrl)})
      await updateMovedSitePublication(hmId('alice'), oldUrl, newUrl)
      expect(mocks.publish).not.toHaveBeenCalled()
    },
  )

  it('propagates publication failure so move or domain recovery can retain durable intent', async () => {
    mocks.publish.mockRejectedValue(new Error('publication failed'))
    await expect(updateMovedSitePublication(hmId('alice'), oldUrl, newUrl)).rejects.toThrow('publication failed')
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('unpublishes the web address without deleting hosting or document data', async () => {
    expect(await removeSite(hmId('alice'))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: ''}}}],
      }),
    )
  })

  it('rejects child paths instead of silently modifying their root', async () => {
    const child = hmId('alice', {path: ['child']})
    await expect(removeSite(child)).rejects.toThrow('space home')
    await expect(updateMovedSitePublication(child, oldUrl, newUrl)).rejects.toThrow('space home')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
