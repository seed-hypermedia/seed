import {describe, expect, it, vi} from 'vitest'
import {Code, ConnectError} from '@connectrpc/connect'
import {Struct, Timestamp} from '@bufbuild/protobuf'
import {deserialize} from 'superjson'
import {handleApiRequest} from './api-server'
import {MentionCandidates} from './api-mention-candidates'
import type {GRPCClient} from './grpc-client'
import {Contact, Account} from './client/.generated/documents/v3alpha/documents_pb'
import {Capability, Role} from './client/.generated/documents/v3alpha/access_control_pb'
import {Event} from './client/.generated/activity/v1alpha/activity_pb'
import {rankMentionCandidates} from './models/mention-ranking'
import {hmId} from './utils/entity-id-url'

// The remote daemon is the boundary; use realistic gRPC shapes and assert the public result.
function daemon() {
  return {
    entities: {
      searchEntities: vi.fn(async () => ({
        entities: [
          {id: 'hm://alice', type: 'profile', content: 'Alice'},
          {id: 'hm://space', type: 'document', content: 'Old home title'},
        ],
      })),
    },
    documents: {
      getAccount: vi.fn(async ({id}: {id: string}) => new Account({id, profile: {name: 'Alice'}})),
      getDocumentInfo: vi.fn(async ({account, path}: {account: string; path: string}) => ({
        account,
        path,
        version: 'current-head',
        metadata: Struct.fromJson({name: 'Current home'}),
        updateTime: Timestamp.fromDate(new Date('2026-09-10')),
      })),
      listDocuments: vi.fn(async () => ({documents: []})),
      listAccounts: vi.fn(async () => ({accounts: [] as Account[]})),
      listContacts: vi.fn(async () => ({contacts: [] as Contact[]})),
    },
    activityFeed: {listEvents: vi.fn(async () => ({events: [] as Event[]}))},
    accessControl: {listCapabilities: vi.fn(async () => ({capabilities: [] as Capability[]}))},
  }
}
describe('mention candidate service', () => {
  it('serves account candidates through the HTTP route with editor context', async () => {
    const client = daemon()
    const url = new URL('http://localhost/api/MentionCandidates')
    url.searchParams.set('mode', 'account')
    url.searchParams.set('query', 'Alice')
    url.searchParams.set('perspectiveAccountUid', 'viewer')
    url.searchParams.set('siteUid', 'space')
    url.searchParams.set('documentId', JSON.stringify(hmId('space', {path: ['page']})))
    url.searchParams.set('seedIds', JSON.stringify([hmId('alice', {path: [':profile']})]))
    const result = await handleApiRequest(url, client as unknown as GRPCClient, vi.fn())
    expect(result.status).toBe(200)
    expect(deserialize(JSON.parse(result.body))).toEqual([
      expect.objectContaining({type: 'account', id: expect.objectContaining({uid: 'alice'})}),
      expect.objectContaining({type: 'account', sameSite: true, id: expect.objectContaining({uid: 'space'})}),
    ])
    expect(client.documents.getDocumentInfo).not.toHaveBeenCalled()
  })

  it('returns profile-only accounts without resolving a home document', async () => {
    const client = daemon()
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: 'Alice'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result.map((c) => [c.type, c.id.uid])).toEqual([['account', 'alice']])
    expect(client.documents.getDocumentInfo).not.toHaveBeenCalled()
  })
  it('uses the verified document head and latest flag, never a profile search hit', async () => {
    const client = daemon()
    client.entities.searchEntities.mockResolvedValue({
      entities: [{id: 'hm://space', type: 'title', content: 'Old home title'}],
    })
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'document', query: 'home'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'document',
      title: 'Current home',
      id: {uid: 'space', path: [], version: 'current-head', latest: true},
    })
  })
  it('omits unpublished or inaccessible documents instead of producing account links', async () => {
    const client = daemon()
    client.documents.getDocumentInfo.mockRejectedValue(new Error('not found'))
    expect(
      await MentionCandidates.getData(client as unknown as GRPCClient, {mode: 'document', query: 'home'}, async () => {
        throw new Error('unexpected daemon query')
      }),
    ).toEqual([])
  })
  it('accepts document title matches and verifies profile hits as home documents', async () => {
    const client = daemon()
    client.entities.searchEntities.mockResolvedValue({
      entities: [
        {id: 'hm://space/page', type: 'title', content: 'Page'},
        {id: 'hm://alice', type: 'profile', content: 'Alice'},
      ],
    })
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'document', query: 'a'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result.map((c) => c.id.uid).sort()).toEqual(['alice', 'space'])
  })
  it('limits simultaneous metadata lookups to eight', async () => {
    const client = daemon()
    let active = 0
    let peak = 0
    client.documents.getAccount.mockImplementation(async ({id}) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return new Account({id, profile: {name: id}})
    })
    await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: '', seedIds: Array.from({length: 20}, (_, i) => hmId(`a${i}`))},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(peak).toBe(8)
  })
  it('does not let a full following list exclude an active external account', async () => {
    const client = daemon()
    client.documents.listContacts.mockResolvedValue({
      contacts: Array.from({length: 100}, (_, i) => new Contact({subject: `contact${i}`, name: `Person ${i}`})),
    })
    client.activityFeed.listEvents.mockResolvedValue({
      events: [
        new Event({
          account: 'external',
          eventTime: Timestamp.fromDate(new Date()),
          data: {case: 'newBlob', value: {blobType: 'Comment', author: 'external'}},
        }),
      ],
    })
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: '', perspectiveAccountUid: 'viewer'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result.some((candidate) => candidate.id.uid === 'external')).toBe(true)
  })
  it('preserves an exact petname match beside a full page of broad public matches', async () => {
    const client = daemon()
    client.entities.searchEntities.mockResolvedValue({
      entities: Array.from({length: 100}, (_, i) => ({
        id: `hm://public${i}`,
        type: 'profile',
        content: 'Alice Person',
      })),
    })
    client.documents.listContacts.mockResolvedValue({contacts: [new Contact({subject: 'friend', name: 'Buddy'})]})
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: 'Buddy', perspectiveAccountUid: 'viewer'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(rankMentionCandidates(result, 'Buddy', [])[0]?.id.uid).toBe('friend')
  })
  it('resolves aliases while preserving the acting account petname', async () => {
    const client = daemon()
    client.documents.getAccount.mockImplementation(
      async ({id}) => new Account({id, aliasAccount: id === 'alias' ? 'canonical' : '', profile: {name: 'Public'}}),
    )
    client.documents.listContacts.mockResolvedValue({contacts: [new Contact({subject: 'alias', name: 'Friend'})]})
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: '', perspectiveAccountUid: 'viewer'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result[0]).toMatchObject({
      id: {uid: 'canonical'},
      sourceAccountUid: 'alias',
      petname: 'Friend',
      publicName: 'Public',
      issuedContact: true,
    })
  })
  it('offers known accounts when there is no query, following or recorded activity', async () => {
    const client = daemon()
    client.documents.listAccounts.mockResolvedValue({accounts: [new Account({id: 'quiet', profile: {name: 'Quiet'}})]})
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: ''},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result.map((c) => c.id.uid)).toEqual(['quiet'])
  })
  it('preserves a matching petname returned by search beyond the first contacts page', async () => {
    const client = daemon()
    client.entities.searchEntities.mockResolvedValue({
      entities: [{id: 'hm://friend', type: 'contact', content: 'Buddy'}],
    })
    const result = await MentionCandidates.getData(
      client as unknown as GRPCClient,
      {mode: 'account', query: 'Buddy', perspectiveAccountUid: 'viewer'},
      async () => {
        throw new Error('unexpected daemon query')
      },
    )
    expect(result[0]).toMatchObject({title: 'Buddy', petname: 'Buddy', issuedContact: true})
  })
  it.each([Code.Unavailable, Code.DeadlineExceeded])(
    'retains a verified document head on retryable refresh failure %s',
    async (code) => {
      const client = daemon()
      const input = {mode: 'document' as const, query: '', seedIds: [hmId('space', {path: ['page']})]}
      const queryDaemon = async () => {
        throw new Error('unexpected daemon query')
      }
      vi.useFakeTimers()
      try {
        const first = await MentionCandidates.getData(client as unknown as GRPCClient, input, queryDaemon)
        expect(first[0]?.id.version).toBe('current-head')
        vi.setSystemTime(Date.now() + 16_000)
        client.documents.getDocumentInfo.mockRejectedValue(new ConnectError('offline', code))
        const offline = await MentionCandidates.getData(client as unknown as GRPCClient, input, queryDaemon)
        expect(offline[0]?.id).toMatchObject({version: 'current-head', latest: true})
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it.each([Code.NotFound, Code.PermissionDenied])(
    'does not retain a document head after definitive access failure %s',
    async (code) => {
      const client = daemon()
      const input = {mode: 'document' as const, query: '', seedIds: [hmId('space', {path: ['page']})]}
      const queryDaemon = async () => {
        throw new Error('unexpected daemon query')
      }
      vi.useFakeTimers()
      try {
        expect(await MentionCandidates.getData(client as unknown as GRPCClient, input, queryDaemon)).toHaveLength(1)
        vi.setSystemTime(Date.now() + 16_000)
        client.documents.getDocumentInfo.mockRejectedValue(new ConnectError('gone', code))
        expect(await MentionCandidates.getData(client as unknown as GRPCClient, input, queryDaemon)).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    },
  )
})

it('distinguishes site editors, document editors, followers and the owner', async () => {
  const client = daemon()
  client.documents.listContacts.mockResolvedValue({
    contacts: [new Contact({account: 'follower', metadata: Struct.fromJson({subscribe: {site: true}})})],
  })
  client.accessControl.listCapabilities.mockResolvedValue({
    capabilities: [
      new Capability({delegate: 'editor', path: '', role: Role.WRITER}),
      new Capability({delegate: 'local', path: '/page', role: Role.WRITER}),
      new Capability({delegate: 'root-only', path: '', isExact: true, role: Role.WRITER}),
      new Capability({delegate: 'editor', path: '/page', role: Role.WRITER}),
    ],
  })
  const result = await MentionCandidates.getData(
    client as unknown as GRPCClient,
    {
      mode: 'account',
      query: '',
      siteUid: 'site',
      documentId: hmId('site', {path: ['page']}),
    },
    vi.fn(),
  )
  expect(Object.fromEntries(result.map((c) => [c.id.uid, c.accountRole]))).toEqual({
    site: 'site-owner',
    follower: 'site-follower',
    editor: 'site-editor',
    local: 'document-editor',
    'root-only': 'document-editor',
  })
})
