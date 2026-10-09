import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({identity: vi.fn(), request: vi.fn(), publish: vi.fn(), invalidate: vi.fn()}))
vi.mock('@/auth', () => ({keyPairStore: {get: mocks.identity}}))
vi.mock('@/universal-client', () => ({
  webUniversalClient: {request: mocks.request, publishDocument: mocks.publish},
}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: mocks.invalidate}))

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

  it('registers from the current gateway peer and signs the latest home update with the owner delegation', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'destination-peer'}))
      .mockResolvedValueOnce(response({peerId: 'source-peer', addrs: ['/dns4/source.test/tcp/4001']}))
      .mockResolvedValueOnce(response({message: 'Success'}))
    mocks.request
      .mockResolvedValueOnce({type: 'document', document: {...document(), version: 'before-registration'}})
      .mockResolvedValueOnce({type: 'document', document: document()})

    expect(await registerSite('alice', setupUrl)).toBe('https://myspace.hyper.media')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://myspace.hyper.media/hm/api/config',
      'https://hyper.media/hm/api/config',
      'https://myspace.hyper.media/hm/api/register',
    ])
    const options = fetchMock.mock.calls[2]![1]
    expect(options).toMatchObject({method: 'POST', credentials: 'omit', headers: {'Content-Type': 'application/json'}})
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
      changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: 'https://myspace.hyper.media'}}}],
    })
    expect(mocks.invalidate).toHaveBeenCalledTimes(3)
  })

  it('allows same-peer registration without reachable addresses for a local shared daemon', async () => {
    fetchMock
      .mockResolvedValueOnce(response({peerId: 'shared-peer'}))
      .mockResolvedValueOnce(response({peerId: 'shared-peer', addrs: []}))
      .mockResolvedValueOnce(response({message: 'Success'}))
    await registerSite('alice', setupUrl)
    expect(mocks.publish).toHaveBeenCalledOnce()
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

  it('rejects a site registered to another space without changing metadata', async () => {
    fetchMock.mockResolvedValueOnce(response({registeredAccountUid: 'bob'}))
    await expect(registerSite('alice', setupUrl)).rejects.toThrow('another space')
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

  it.each(['javascript:alert(1)', 'https://user:password@myspace.hyper.media'])(
    'rejects invalid setup origin %s',
    async (url) => {
      await expect(registerSite('alice', url)).rejects.toThrow('web address')
      expect(fetchMock).not.toHaveBeenCalled()
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
