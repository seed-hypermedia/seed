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
    documents: {getContact: vi.fn()},
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
    it('returns ACCOUNT invalidation for Profile events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser123')
      expect(getUnconditionalInvalidations(event)).toEqual([[queryKeys.ACCOUNT, 'z6MkUser123']])
    })

    it('returns empty for non-Profile events', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      expect(getUnconditionalInvalidations(makeBlobEvent('Ref', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Comment', 'hm://z6MkOwner/doc'))).toEqual([])
      expect(getUnconditionalInvalidations(makeBlobEvent('Contact', 'hm://z6MkOwner'))).toEqual([])
    })

    it('handles Profile event with query params in resource', async () => {
      const {getUnconditionalInvalidations} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkUser?v=abc')
      expect(getUnconditionalInvalidations(event)).toEqual([[queryKeys.ACCOUNT, 'z6MkUser']])
    })
  })

  describe('processEvents integration', () => {
    it('calls appInvalidateQueries with ACCOUNT key for Profile events', async () => {
      const {processEvents} = await loadModule()
      const event = makeBlobEvent('Profile', 'hm://z6MkProfileUser')
      processEvents([event])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT, 'z6MkProfileUser'])
    })

    it('calls appInvalidateQueries for each Profile event in a batch', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Profile', 'hm://z6MkUserA'), makeBlobEvent('Profile', 'hm://z6MkUserB')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT, 'z6MkUserA'])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT, 'z6MkUserB'])
    })

    it('does not call appInvalidateQueries for unsubscribed Ref events', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Ref', 'hm://z6MkOwner/doc?v=abc')])
      // With no subscriptions, Ref events should NOT produce any direct invalidation
      expect(appInvalidateQueriesMock).not.toHaveBeenCalled()
    })

    it('handles mixed Profile and Ref events correctly', async () => {
      const {processEvents} = await loadModule()
      processEvents([
        makeBlobEvent('Ref', 'hm://z6MkOwner/doc'),
        makeBlobEvent('Profile', 'hm://z6MkUserC'),
        makeBlobEvent('Comment', 'hm://z6MkOwner/doc'),
      ])
      // Only the Profile event should trigger an unconditional invalidation
      expect(appInvalidateQueriesMock).toHaveBeenCalledTimes(1)
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ACCOUNT, 'z6MkUserC'])
    })

    it('invalidates CONTACTS_ACCOUNT for Contact events with author', async () => {
      const {processEvents} = await loadModule()
      processEvents([makeBlobEvent('Contact', 'hm://z6MkOwner', 'z6MkContactAuthor')])
      expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.CONTACTS_ACCOUNT, 'z6MkContactAuthor'])
    })
  })
})
