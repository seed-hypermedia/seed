import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  seedClient: {
    baseUrl: 'http://localhost:56004',
    request: vi.fn(),
    publish: vi.fn(),
    publishBlobs: vi.fn(),
    publishDocument: undefined as undefined | ReturnType<typeof vi.fn>,
  },
}))

vi.mock('@seed-hypermedia/client', () => ({
  createSeedClient: vi.fn(() => mocks.seedClient),
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {
      signData: vi.fn(async () => ({signature: new Uint8Array([1, 2, 3])})),
    },
  },
}))

vi.mock('@/models/entities', () => ({
  addSubscribedEntity: vi.fn(),
  getDiscoveryStream: vi.fn(),
  removeSubscribedEntity: vi.fn(),
}))

vi.mock('@/models/recents', () => ({
  deleteRecent: vi.fn(),
  fetchRecents: vi.fn(),
}))

vi.mock('@/trpc', () => ({
  client: {
    drafts: {
      listAccount: {
        query: vi.fn(),
      },
    },
  },
}))

vi.mock('../components/commenting', () => ({
  CommentBox: () => null,
}))

describe('desktopUniversalClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.seedClient.publishDocument = undefined
  })

  it('reports a clear error when the seed client publishDocument method is unavailable', async () => {
    const {desktopUniversalClient} = await import('../desktop-universal-client')

    await expect(
      desktopUniversalClient.publishDocument!({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/test',
        changes: [],
      }),
    ).rejects.toThrow('Seed client publishDocument is not available')
  })

  it('delegates document publishing to the seed client with the desktop signer', async () => {
    const {desktopUniversalClient} = await import('../desktop-universal-client')
    mocks.seedClient.publishDocument = vi.fn(async () => undefined)

    await desktopUniversalClient.publishDocument!({
      signerAccountUid: 'alice',
      account: 'alice',
      path: '/test',
      changes: [],
    })

    expect(mocks.seedClient.publishDocument).toHaveBeenCalledTimes(1)
    expect(mocks.seedClient.publishDocument!.mock.calls[0]?.[0]).toMatchObject({
      account: 'alice',
      path: '/test',
      changes: [],
    })
    expect(mocks.seedClient.publishDocument!.mock.calls[0]?.[1]).toHaveProperty('getPublicKey')
    expect(mocks.seedClient.publishDocument!.mock.calls[0]?.[1]).toHaveProperty('sign')
  })
})
