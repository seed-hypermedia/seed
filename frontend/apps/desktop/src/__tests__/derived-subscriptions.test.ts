import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../app-grpc', () => ({
  grpcClient: {
    daemon: {listKeys: vi.fn()},
    documents: {listContacts: vi.fn()},
    subscriptions: {listSubscriptions: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn()},
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}))

describe('derived subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('subscribes local accounts without waiting for their first sync', async () => {
    const {grpcClient} = (await import('../app-grpc')) as any
    // A fresh database has the vault keys but no subscriptions yet.
    grpcClient.daemon.listKeys.mockResolvedValue({keys: [{accountId: 'z6MkFirst'}, {accountId: 'z6MkSecond'}]})
    grpcClient.documents.listContacts.mockResolvedValue({contacts: []})
    grpcClient.subscriptions.listSubscriptions.mockResolvedValue({subscriptions: []})
    grpcClient.subscriptions.subscribe.mockResolvedValue({})

    const {initDerivedSubscriptions} = await import('../derived-subscriptions')
    await initDerivedSubscriptions()

    expect(grpcClient.subscriptions.subscribe.mock.calls.map(([request]: [unknown]) => request)).toEqual([
      {account: 'z6MkFirst', recursive: true, path: '', async: true},
      {account: 'z6MkSecond', recursive: true, path: '', async: true},
    ])
    expect(grpcClient.subscriptions.unsubscribe).not.toHaveBeenCalled()
  })
})
