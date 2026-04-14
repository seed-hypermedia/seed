import {describe, expect, it} from 'vitest'
import {getAccountSiteLinkState} from '../account-page'

describe('getAccountSiteLinkState', () => {
  it('hides the link when the account has no site', () => {
    expect(
      getAccountSiteLinkState({
        accountUid: 'alice',
        hasSite: false,
        siteUrl: null,
      }),
    ).toMatchObject({
      kind: 'hidden',
      status: 'default',
      label: 'Open Site',
    })
  })

  it('keeps the legacy internal link when only the home document exists', () => {
    expect(
      getAccountSiteLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: null,
      }),
    ).toMatchObject({
      kind: 'internal',
      status: 'default',
      label: 'Open Site',
    })
  })

  it('uses the external domain link when the domain is verified for the profile account', () => {
    expect(
      getAccountSiteLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: 'https://alice.example',
        registeredAccountUid: 'alice',
      }),
    ).toMatchObject({
      kind: 'external',
      status: 'verified',
      label: 'alice.example',
      hostname: 'alice.example',
      verifiedMessage: 'alice.example is currently working for this profile account.',
    })
  })

  it('falls back to the internal site route when the verified domain belongs to another account', () => {
    expect(
      getAccountSiteLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: 'https://alice.example',
        registeredAccountUid: 'bob',
      }),
    ).toMatchObject({
      kind: 'internal',
      status: 'warning',
      label: 'Open Site',
      hostname: 'alice.example',
      warningMessage: 'alice.example is not resolving to this profile account.',
    })
  })

  it('waits for the domain lookup before showing a warning', () => {
    expect(
      getAccountSiteLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: 'https://alice.example',
        isDomainLoading: true,
      }),
    ).toMatchObject({
      kind: 'internal',
      status: 'default',
      label: 'alice.example',
      hostname: 'alice.example',
    })
  })
})
