import * as base64 from '@seed-hypermedia/client/base64'
import * as encryption from '@seed-hypermedia/client/encryption'
import {expect, mock, test} from 'bun:test'
import type {SaveVaultRequest} from '@/api'
import {APIError} from './api-client'
import {createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'
import * as vault from './vault'

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const principal = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

function setup(overrides: Parameters<typeof createMockClient>[0] = {}) {
  const saveVault = mock(async (_request: SaveVaultRequest) => ({success: true as const}))
  const client = createMockClient({saveVault, ...overrides})
  const store = createStore(client, createMockBlockstore())
  store.state.decryptedDEK = new Uint8Array(32)
  store.state.vaultLoaded = true
  store.state.vaultData = vault.createEmpty()
  return {...store, client, saveVault}
}

test('imports an account phrase and persists only the derived key in the encrypted vault', async () => {
  const {state, actions, saveVault} = setup()
  expect(await actions.importAccountFromMnemonic(words)).toBe(principal)
  expect(state.vaultData!.accounts.map(vault.getAccountName)).toEqual([principal])
  expect(state.selectedAccountIndex).toBe(0)
  const request = saveVault.mock.calls[0]![0]
  const saved = await vault.deserialize(
    await encryption.decrypt(base64.decode(request.encryptedData), state.decryptedDEK!),
  )
  expect(saved.accounts.map(vault.getAccountName)).toEqual([principal])
  expect(Object.keys(saved.accounts[0]!)).not.toContain('mnemonic')
})

test('invalid phrases and duplicate imports do not save or change existing accounts', async () => {
  const {state, actions, saveVault} = setup()
  await expect(actions.importAccountFromMnemonic('invalid')).rejects.toThrow('Invalid account recovery phrase')
  expect(saveVault).not.toHaveBeenCalled()
  await actions.importAccountFromMnemonic(words)
  await expect(actions.importAccountFromMnemonic(words)).rejects.toThrow('already exists')
  expect(saveVault).toHaveBeenCalledTimes(1)
  expect(state.vaultData!.accounts.map(vault.getAccountName)).toEqual([principal])
  expect(state.loading).toBe(false)
})

test('requires an unlocked vault', async () => {
  const {state, actions, saveVault} = setup()
  state.decryptedDEK = null
  await expect(actions.importAccountFromMnemonic(words)).rejects.toThrow('Vault must be unlocked first')
  expect(saveVault).not.toHaveBeenCalled()
})

test('rolls back the imported account on a save failure', async () => {
  const {state, actions} = setup({
    saveVault: async () => {
      throw new Error('offline')
    },
  })
  await expect(actions.importAccountFromMnemonic(words)).rejects.toThrow('offline')
  expect(state.vaultData!.accounts).toHaveLength(0)
  expect(state.loading).toBe(false)
})

test('preserves a remotely imported duplicate after a save conflict', async () => {
  const original = setup()
  await original.actions.importAccountFromMnemonic(words)
  const encryptedData = base64.encode(
    await encryption.encrypt(await vault.serialize(original.state.vaultData!), original.state.decryptedDEK!),
  )
  const {state, actions} = setup({
    saveVault: async () => {
      throw new APIError('Conflict', 409)
    },
    getVault: async () => ({encryptedData, version: 2, credentials: []}),
  })
  await expect(actions.importAccountFromMnemonic(words)).rejects.toThrow('already exists')
  expect(state.vaultData!.accounts.map(vault.getAccountName)).toEqual([principal])
})

test('restores the selected account when reloading after a conflict fails', async () => {
  const {state, actions} = setup()
  await actions.importAccountFromMnemonic(words)
  const selected = state.selectedAccountIndex
  const client = setup({
    saveVault: async () => {
      throw new APIError('Conflict', 409)
    },
    getVault: async () => {
      throw new Error('offline')
    },
  })
  client.state.vaultData = state.vaultData
  client.state.selectedAccountIndex = selected
  await expect(client.actions.importAccountFromMnemonic(words, 'other account')).rejects.toThrow('offline')
  expect(client.state.vaultData!.accounts.map(vault.getAccountName)).toEqual([principal])
  expect(client.state.selectedAccountIndex).toBe(selected)
})
