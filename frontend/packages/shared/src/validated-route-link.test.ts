import {describe, expect, it} from 'vitest'
import {getValidatedWebSeedLinkState} from './validated-route-link'

describe('getValidatedWebSeedLinkState', () => {
  it('keeps the external href when the destination domain is verified', () => {
    expect(
      getValidatedWebSeedLinkState({
        href: 'https://alice.example/hm/alice/post',
        fallbackHref: '/hm/alice/post',
        hostname: 'alice.example',
        expectedAccountUid: 'alice',
        registeredAccountUid: 'alice',
        isSeedLink: true,
      }),
    ).toEqual({
      kind: 'verified',
      href: 'https://alice.example/hm/alice/post',
    })
  })

  it('falls back to the same-domain href when the domain resolves to another account', () => {
    expect(
      getValidatedWebSeedLinkState({
        href: 'https://alice.example/hm/alice/post',
        fallbackHref: '/hm/alice/post',
        hostname: 'alice.example',
        expectedAccountUid: 'alice',
        registeredAccountUid: 'bob',
        isSeedLink: true,
      }),
    ).toEqual({
      kind: 'fallback',
      href: '/hm/alice/post',
    })
  })

  it('falls back while the domain lookup is still loading', () => {
    expect(
      getValidatedWebSeedLinkState({
        href: 'https://alice.example/hm/alice/post',
        fallbackHref: '/hm/alice/post',
        hostname: 'alice.example',
        expectedAccountUid: 'alice',
        isDomainLoading: true,
        isSeedLink: true,
      }),
    ).toEqual({
      kind: 'fallback',
      href: '/hm/alice/post',
    })
  })

  it('passes through non-Seed external URLs unchanged', () => {
    expect(
      getValidatedWebSeedLinkState({
        href: 'https://example.com',
        fallbackHref: '/hm/alice/post',
        isSeedLink: false,
      }),
    ).toEqual({
      kind: 'passthrough',
      href: 'https://example.com',
    })
  })
})
