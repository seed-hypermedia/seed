import {beforeEach, describe, expect, it, vi} from 'vitest'

const {invalidateQueriesMock} = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {},
  },
}))

vi.mock('@/trpc', () => ({
  client: {},
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
}))

import {getVaultStatusCacheBustKey, invalidateVaultDependentQueries} from '../models/daemon'
import {queryKeys} from '@shm/shared/models/query-keys'

describe('daemon model vault helpers', () => {
  beforeEach(() => {
    invalidateQueriesMock.mockReset()
  })

  it('includes vault versions and connection state in the cache-bust key', () => {
    expect(
      getVaultStatusCacheBustKey({
        backendMode: 2,
        connectionStatus: 2,
        remoteVaultUrl: 'https://vault.example',
        syncStatus: {
          localVersion: BigInt(7),
          remoteVersion: BigInt(11),
        },
      } as any),
    ).toBe('2:2:https://vault.example:7:11')
  })

  it('returns null when vault status is unavailable', () => {
    expect(getVaultStatusCacheBustKey(null)).toBeNull()
    expect(getVaultStatusCacheBustKey(undefined)).toBeNull()
  })

  it('invalidates both vault status and local account queries together', () => {
    invalidateVaultDependentQueries()

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2)
    expect(invalidateQueriesMock).toHaveBeenNthCalledWith(1, [queryKeys.GET_VAULT_STATUS])
    expect(invalidateQueriesMock).toHaveBeenNthCalledWith(2, [queryKeys.LOCAL_ACCOUNT_ID_LIST])
  })
})
