import {beforeEach, describe, expect, it, vi} from 'vitest'
import {queryKeys} from '@shm/shared/models/query-keys'

// ---- Mocks for heavy Electron/gRPC deps ----

const appInvalidateQueriesMock = vi.fn()
const appInvalidateAccountAndAliasesMock = vi.fn()

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
  appInvalidateAccountAndAliases: appInvalidateAccountAndAliasesMock,
  getInvalidationHandlerCount: () => 0,
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
    documents: {getContact: vi.fn()},
    comments: {getComment: vi.fn().mockRejectedValue(new Error('not mocked'))},
    daemon: {},
    networking: {},
  },
}))

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
  })

  describe('extractResource', () => {
    it('extracts resource from newBlob event', async () => {
      const {extractResource} = await loadModule()
      const event = makeBlobEvent('Ref', 'hm://z6MkOwner/some-path?v=abc')
      expect(extractResource(event)).toBe('hm://z6MkOwner/some-path')
    })

    it('returns null for events with empty resource', async () => {
      const {extractResource} = await loadModule()
      const event = makeBlobEvent('Ref', '')
      expect(extractResource(event)).toBeNull()
    })
  })

  describe('getUnconditionalInvalidations', () => {
    it('returns LIST_ACCOUNTS invalidation for Profile events (per-uid handled separately)', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser123')
      // Targeted per-uid invalidation goes through appInvalidateAccountAndAliases,
      // not the queryKey path. LIST_ACCOUNTS is the only queryKey-based fallout.
      expect(getUnconditionalInvalidations(event)).toEqual([[queryKeys.LIST_ACCOUNTS]])
    })

    it('returns empty for non-Profile non-Capability events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      expect(getUnconditionalInvalidations(makeBlobEvent('Ref', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Comment', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Contact', 'hm://z6MkOwner'))).toEqual([])
    })
  })

  describe('getProfileTargetUids', () => {
    it('extracts the uid from a profile event resource IRI', async () => {
      const {getProfileTargetUids} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser123')
      expect(getProfileTargetUids([event])).toEqual(['z6MkUser123'])
    })

    it('strips the version query string before unpacking', async () => {
      const {getProfileTargetUids} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser?v=abc')
      expect(getProfileTargetUids([event])).toEqual(['z6MkUser'])
    })

    it('dedupes uids across multiple profile events', async () => {
      const {getProfileTargetUids} = await loadModule()
      const events = [makeBlobEvent('Profile', 'hm://z6MkUser'), makeBlobEvent('Profile', 'hm://z6MkUser?v=newver')]
      expect(getProfileTargetUids(events)).toEqual(['z6MkUser'])
    })

    it('skips non-profile events', async () => {
      const {getProfileTargetUids} = await loadModule()
      const events = [makeBlobEvent('Ref', 'hm://z6MkUser/doc'), makeBlobEvent('Comment', 'hm://z6MkUser/doc')]
      expect(getProfileTargetUids(events)).toEqual([])
    })

    it('skips profile events with no resource', async () => {
      const {getProfileTargetUids} = await loadModule()
      expect(getProfileTargetUids([makeBlobEvent('Profile', '')])).toEqual([])
    })
  })

  describe('processEvents integration', () => {
    it('targets the resource uid for Profile events via the alias-aware bridge', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Profile', 'hm://z6MkProfileUser')])
      // No more blanket [ACCOUNT] — per-uid invalidation routes through
      // appInvalidateAccountAndAliases so renderers can scan their caches.
      expect(appInvalidateAccountAndAliasesMock).toHaveBeenCalledWith('z6MkProfileUser')
      expect(appInvalidateQueriesMock).not.toHaveBeenCalledWith([queryKeys.ACCOUNT])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ACCOUNTS])
    })

    it('fires one targeted invalidation per unique profile uid', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Profile', 'hm://z6MkUserA'), makeBlobEvent('Profile', 'hm://z6MkUserB')])
      expect(appInvalidateAccountAndAliasesMock).toHaveBeenCalledWith('z6MkUserA')
      expect(appInvalidateAccountAndAliasesMock).toHaveBeenCalledWith('z6MkUserB')
      expect(appInvalidateAccountAndAliasesMock).toHaveBeenCalledTimes(2)
    })

    it('invalidates listing and feed caches for Ref events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Ref', 'hm://z6MkOwner/doc?v=abc')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ROOT_DOCUMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('invalidates all comment-related caches for Comment events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Comment', 'hm://z6MkOwner/doc')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_DISCUSSION])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.BLOCK_DISCUSSIONS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.AUTHORED_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENT_VERSIONS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('batches invalidations for mixed event types', async () => {
      const {processEvents} = await loadModule()
      processEvents([
        makeBlobEvent('Ref', 'hm://z6MkOwner/doc'),
        makeBlobEvent('Profile', 'hm://z6MkUserC'),
        makeBlobEvent('Comment', 'hm://z6MkOwner/doc'),
      ])
      // Profile → targeted per-uid alias-aware invalidation + LIST_ACCOUNTS
      expect(appInvalidateAccountAndAliasesMock).toHaveBeenCalledWith('z6MkUserC')
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIST_ACCOUNTS])
      // Ref → listing caches
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.LIBRARY])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.SITE_LIBRARY])
      // Comment → comment caches
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_COMMENTS])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DOCUMENT_DISCUSSION])
      // Feed → invalidated once for the batch
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })

    it('invalidates CONTACTS_ACCOUNT and feed for Contact events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Contact', 'hm://z6MkOwner', 'z6MkContactAuthor')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.CONTACTS_ACCOUNT, 'z6MkContactAuthor'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.FEED])
    })
  })
})
