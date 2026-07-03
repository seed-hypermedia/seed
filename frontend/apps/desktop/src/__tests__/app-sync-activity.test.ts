import {beforeEach, describe, expect, it, vi} from 'vitest'
import {queryKeys} from '@shm/shared/models/query-keys'

// ---- Mocks for heavy Electron/gRPC deps ----

const appInvalidateQueriesMock = vi.fn()

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
}))

vi.mock('../app-focus', () => ({
  isAnyWindowFocused: () => true,
  onAppFocusChange: vi.fn(),
}))

vi.mock('../app-trpc', () => ({
  t: {
    procedure: {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockReturnThis(),
      mutation: vi.fn().mockReturnThis(),
      subscription: vi.fn().mockReturnThis(),
    },
    router: vi.fn((routes: any) => routes),
  },
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    activityFeed: {listEvents: vi.fn()},
    resources: {discoverResource: vi.fn(), getResource: vi.fn()},
    documents: {getContact: vi.fn()},
    comments: {getComment: vi.fn().mockRejectedValue(new Error('not mocked'))},
    daemon: {},
    networking: {},
  },
}))

async function getGrpcClientMock() {
  const {grpcClient} = await import('@/grpc-client')
  return grpcClient as any
}

// ---- Helpers to build test events ----

async function loadModule() {
  const mod = await import('../app-sync')
  return mod
}

function makeBlobEvent(blobType: string, resource: string, author: string = 'z6MkAuthor', extraAttrs = '') {
  // We build a plain object that matches the Event shape consumed by processEvents.
  // The real Event class uses a `case`/`value` discriminated union via protobuf-es.
  return {
    data: {
      case: 'newBlob' as const,
      value: {
        cid: `bafytest-${blobType.toLowerCase()}`,
        blobType,
        author,
        resource,
        extraAttrs,
        blobId: BigInt(1),
        isPinned: false,
      },
    },
  } as any
}

describe('activity event processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('extractResource', () => {
    it('extracts resource from newBlob event', async () => {
      const {extractResource} = await loadModule()
      const event = makeBlobEvent('Ref', 'hm://z6MkOwner/some-path?v=abc')
      expect(extractResource(event)).toBe('hm://z6MkOwner/some-path')
    }, 30000)

    it('returns null for events with empty resource', async () => {
      const {extractResource} = await loadModule()
      const event = makeBlobEvent('Ref', '')
      expect(extractResource(event)).toBeNull()
    })
  })

  describe('getUnconditionalInvalidations', () => {
    const expectedProfileInvalidations = [
      [queryKeys.ACCOUNT],
      [queryKeys.LIST_ACCOUNTS],
      [queryKeys.DOCUMENT_COLLABORATORS],
      [queryKeys.SEARCH],
      [queryKeys.ACTIVITY_FEED],
      [queryKeys.FEED],
      [queryKeys.LIBRARY],
      [queryKeys.SITE_LIBRARY],
      [queryKeys.LIST_ROOT_DOCUMENTS],
      [queryKeys.ROOT_DOCUMENTS],
    ]

    it('returns account, collaborator, and name/avatar-ripple invalidations for Profile events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser123')
      expect(getUnconditionalInvalidations(event)).toEqual(expectedProfileInvalidations)
    })

    it('returns empty for non-Profile non-Capability events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      expect(getUnconditionalInvalidations(makeBlobEvent('Ref', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Comment', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Contact', 'hm://z6MkOwner'))).toEqual([])
    })

    it('returns collaborator invalidation for Capability events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      expect(getUnconditionalInvalidations(makeBlobEvent('Capability', 'hm://z6MkOwner/doc'))).toEqual([
        [queryKeys.CAPABILITIES, 'z6MkOwner'],
        [queryKeys.DOCUMENT_COLLABORATORS, 'z6MkOwner'],
      ])
    })

    it('returns the same blanket invalidations regardless of resource', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      // Aliases make per-uid targeting unreliable, so Profile events blanket-invalidate
      const event = makeBlobEvent('Profile', 'hm://z6MkUser?v=abc')
      expect(getUnconditionalInvalidations(event)).toEqual(expectedProfileInvalidations)
    })
  })

  describe('processEvents integration', () => {
    it('ripples profile invalidations across account, collaborators, search, feed, and library', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Profile', 'hm://z6MkProfileUser')])
      // Blanket [ACCOUNT] prefix catches aliases (A→B means [ACCOUNT, A] stores B's data)
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ACCOUNTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS])
      // Mention picker and global search show account names — invalidate so they refetch
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SEARCH])
      // Feed/library rows display author names/avatars derived from the profile
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ROOT_DOCUMENTS])
    })

    it('blanket-invalidates account-derived queries once even for multiple Profile events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Profile', 'hm://z6MkUserA'), makeBlobEvent('Profile', 'hm://z6MkUserB')])
      // Single blanket invalidation covers both profiles + any aliases
      const accountCalls = appInvalidateQueriesMock.mock.calls.filter(
        (call) => Array.isArray(call[0]) && call[0].length === 1 && call[0][0] === queryKeys.ACCOUNT,
      )
      expect(accountCalls).toHaveLength(1)
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ACCOUNTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS])
    })

    it('targets site-library invalidation for child Ref events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Ref', 'hm://z6MkOwner/doc?v=abc')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY, 'z6MkOwner'])
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.LIST_ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('invalidates root-document caches for root Ref events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Ref', 'hm://z6MkOwner?v=abc')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY, 'z6MkOwner'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ROOT_DOCUMENTS])
    })

    it('falls back to broad listing invalidations for malformed Ref resources', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Ref', 'not-an-hm-url')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ROOT_DOCUMENTS])
    })

    it('targets string-keyed comment caches for Comment events when target and author are known', async () => {
      const {processEvents} = await loadModule()
      processEvents([
        makeBlobEvent(
          'Comment',
          'hm://z6MkCommentAuthor/comment-tsid',
          'z6MkCommentAuthor',
          JSON.stringify({target: 'hm://z6MkOwner/doc'}),
        ),
      ])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_DISCUSSION])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.BLOCK_DISCUSSIONS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENTS, 'hm://z6MkOwner/doc'])
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.AUTHORED_COMMENTS, 'hm://z6MkCommentAuthor'])
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.AUTHORED_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([
        queryKeys.DOCUMENT_INTERACTION_SUMMARY,
        'hm://z6MkOwner/doc',
      ])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENT_VERSIONS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('falls back to broad comment index invalidations when Comment target data is missing', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Comment', 'hm://z6MkOwner/doc', '', '')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.AUTHORED_COMMENTS])
    })

    it('batches invalidations for mixed event types', async () => {
      const {processEvents} = await loadModule()
      processEvents([
        makeBlobEvent('Ref', 'hm://z6MkOwner/doc'),
        makeBlobEvent('Profile', 'hm://z6MkUserC'),
        makeBlobEvent('Comment', 'hm://z6MkOwner/doc'),
      ])
      // Profile → blanket account-derived queries
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ACCOUNTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS])
      // Ref → listing caches
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY, 'z6MkOwner'])
      // Comment → comment caches
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_DISCUSSION])
      // Feed → invalidated once for the batch
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('invalidates collaborator caches for Capability events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Capability', 'hm://z6MkOwner/docs/child')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.CAPABILITIES, 'z6MkOwner', 'docs', 'child'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([
        queryKeys.DOCUMENT_COLLABORATORS,
        'z6MkOwner',
        'docs',
        'child',
      ])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS, 'z6MkOwner', 'docs'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS, 'z6MkOwner'])
    })

    it('invalidates CONTACTS, collaborators, search, library, and feed for Contact events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Contact', 'hm://z6MkOwner', 'z6MkContactAuthor')])
      // Targeted: this author's following list
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.CONTACTS_ACCOUNT, 'z6MkContactAuthor'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COLLABORATORS])
      // Blanket: covers site members (useSiteMembers) + follower lists for all subjects,
      // since the contact's subject pubkey row id in extraAttrs isn't a usable uid.
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.CONTACTS_SUBJECT])
      // Contacts carry display-name aliases shown in mention picker and library
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SEARCH])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })
  })

  describe('activity monitor startup', () => {
    it('uses profile discovery ids for profile-scoped subscriptions', async () => {
      vi.useFakeTimers()
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
      const grpcClient = await getGrpcClientMock()
      grpcClient.activityFeed.listEvents.mockReturnValue(new Promise(() => {}))
      grpcClient.resources.discoverResource.mockResolvedValue({version: 'v1'})
      grpcClient.resources.getResource.mockRejectedValue(new Error('not found'))

      const {subscribe} = await loadModule()
      const unsubscribe = subscribe({
        id: {id: 'hm://z6MkProfileUser', uid: 'z6MkProfileUser', path: null},
        scope: 'profile',
      } as any)

      await vi.advanceTimersByTimeAsync(200)

      expect(grpcClient.resources.discoverResource).toHaveBeenCalledWith(
        expect.objectContaining({id: 'hm://z6MkProfileUser/:profile'}),
      )

      unsubscribe()
      randomSpy.mockRestore()
      vi.useRealTimers()
    })

    it('starts the monitor only once when subscriptions are created before the first poll resolves', async () => {
      const grpcClient = await getGrpcClientMock()
      grpcClient.activityFeed.listEvents.mockReturnValue(new Promise(() => {}))

      const {subscribe} = await loadModule()

      const unsubscribeA = subscribe({id: {id: 'hm://z6MkOwner/doc-a', uid: 'z6MkOwner', path: ['doc-a']}} as any)
      const unsubscribeB = subscribe({id: {id: 'hm://z6MkOwner/doc-b', uid: 'z6MkOwner', path: ['doc-b']}} as any)

      expect(grpcClient.activityFeed.listEvents).toHaveBeenCalledTimes(1)

      unsubscribeA()
      unsubscribeB()
    })
  })
})
