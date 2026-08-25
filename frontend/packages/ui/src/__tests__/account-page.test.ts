import {describe, expect, it} from 'vitest'
import {getAccountSpaceLinkState} from '../account-page'

describe('getAccountSpaceLinkState', () => {
  it('hides the link when the account has no space', () => {
    expect(
      getAccountSpaceLinkState({
        accountUid: 'alice',
        hasSite: false,
        siteUrl: null,
      }),
    ).toMatchObject({
      kind: 'hidden',
      status: 'default',
      label: 'Open Space',
    })
  })

  it('keeps the legacy internal link when only the home document exists', () => {
    expect(
      getAccountSpaceLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: null,
      }),
    ).toMatchObject({
      kind: 'internal',
      status: 'default',
      label: 'Open Space',
    })
  })

  it('uses the external domain link when the domain is verified for the profile account', () => {
    expect(
      getAccountSpaceLinkState({
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

  it('falls back to the internal space route when the verified domain belongs to another account', () => {
    expect(
      getAccountSpaceLinkState({
        accountUid: 'alice',
        hasSite: true,
        siteUrl: 'https://alice.example',
        registeredAccountUid: 'bob',
      }),
    ).toMatchObject({
      kind: 'internal',
      status: 'warning',
      label: 'Open Space',
      hostname: 'alice.example',
      warningMessage: 'alice.example is not resolving to this profile account.',
    })
  })

  it('waits for the domain lookup before showing a warning', () => {
    expect(
      getAccountSpaceLinkState({
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
