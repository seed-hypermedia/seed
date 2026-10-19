import * as base64 from '@seed-hypermedia/client/base64'
import {ed25519} from '@noble/curves/ed25519.js'
import * as blobs from '@shm/shared/blobs'
import {describe, expect, mock, test} from 'bun:test'
import {type SyncVaultAccountsRequest, vaultAccountClaimMessage} from '@/api'
import * as localCrypto from './crypto'
import {createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'
import * as vault from './vault'

/** The sync runs in the background after load/save; poll until the client has seen it. */
async function waitForCalls(fn: {mock: {calls: unknown[]}}, count: number) {
  for (let i = 0; i < 100 && fn.mock.calls.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(fn.mock.calls).toHaveLength(count)
}

describe('vault accounts sync', () => {
  test('reports signed vault account claims after loading and after saving the vault', async () => {
    const dek = new Uint8Array(32).fill(3)
    const kp = blobs.generateNobleKeyPair()
    const uid = blobs.principalToString(kp.principal)
    const vaultData: vault.State = {
      version: 2,
      accounts: [{name: uid, seed: kp.seed, createTime: 1234, delegations: []}],
    }
    const encryptedData = await localCrypto.encrypt(await vault.serialize(vaultData), dek)

    const syncVaultAccounts = mock(async (_req: SyncVaultAccountsRequest) => ({success: true}))
    const client = createMockClient({
      getVault: async () => ({encryptedData: base64.encode(encryptedData), version: 1, credentials: []}),
      saveVault: async () => ({success: true}),
      syncVaultAccounts,
    })
    const {state, actions} = createStore(client, createMockBlockstore())
    state.decryptedDEK = dek
    state.session = {authenticated: true, relyingPartyOrigin: 'https://example.com', userId: 'user-1'}
    state.relyingPartyOrigin = 'https://example.com'

    await actions.loadVaultData()
    await waitForCalls(syncVaultAccounts, 1)
    const request = syncVaultAccounts.mock.calls[0]![0]
    expect(request.accounts).toHaveLength(1)
    expect(request.accounts[0]).toMatchObject({uid, createTime: 1234})
    const message = new TextEncoder().encode(vaultAccountClaimMessage('https://example.com', 'user-1', uid))
    expect(ed25519.verify(base64.decode(request.accounts[0]!.signature), message, kp.publicKey)).toBe(true)

    await actions.saveVaultData()
    await waitForCalls(syncVaultAccounts, 2)
  })

  test('does not report accounts before the session is known', async () => {
    const syncVaultAccounts = mock(async (_req: SyncVaultAccountsRequest) => ({success: true}))
    const client = createMockClient({
      getVault: async () => ({encryptedData: '', version: 1, credentials: []}),
      syncVaultAccounts,
    })
    const {state, actions} = createStore(client, createMockBlockstore())
    state.decryptedDEK = new Uint8Array(32)

    await actions.loadVaultData()
    expect(state.vaultLoaded).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(syncVaultAccounts).not.toHaveBeenCalled()
  })

  test('a failing sync does not break vault loading', async () => {
    const client = createMockClient({
      getVault: async () => ({encryptedData: '', version: 1, credentials: []}),
      syncVaultAccounts: async () => {
        throw new Error('offline')
      },
    })
    const {state, actions} = createStore(client, createMockBlockstore())
    state.decryptedDEK = new Uint8Array(32)
    state.session = {authenticated: true, relyingPartyOrigin: 'https://example.com', userId: 'user-1'}
    state.relyingPartyOrigin = 'https://example.com'

    await actions.loadVaultData()
    expect(state.vaultLoaded).toBe(true)
    expect(state.error).toBe('')
  })
})
