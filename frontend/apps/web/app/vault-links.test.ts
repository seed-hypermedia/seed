import {describe, expect, it} from 'vitest'
import {getVaultAccountSettingsUrl} from './vault-links'

describe('getVaultAccountSettingsUrl', () => {
  it('maps a delegated vault session URL to the vault account route', () => {
    expect(
      getVaultAccountSettingsUrl({
        vaultUrl: 'https://vault.example.com/vault/delegate?client_id=https%3A%2F%2Fsite.example.com#ignored',
        accountUid: 'z6MkrealAccountUid',
      }),
    ).toBe('https://vault.example.com/vault#/a/z6MkrealAccountUid')
  })

  it('preserves custom vault base paths while removing the delegate suffix', () => {
    expect(
      getVaultAccountSettingsUrl({
        vaultUrl: 'https://accounts.example.com/custom/vault/delegate/',
        accountUid: 'account with spaces',
      }),
    ).toBe('https://accounts.example.com/custom/vault#/a/account%20with%20spaces')
  })

  it('returns null without a stored delegated account and vault URL', () => {
    expect(
      getVaultAccountSettingsUrl({
        vaultUrl: 'https://vault.example.com/vault/delegate',
      }),
    ).toBeNull()
    expect(
      getVaultAccountSettingsUrl({
        accountUid: 'z6MkrealAccountUid',
      }),
    ).toBeNull()
    expect(
      getVaultAccountSettingsUrl({
        vaultUrl: 'not a url',
        accountUid: 'z6MkrealAccountUid',
      }),
    ).toBeNull()
  })
})
