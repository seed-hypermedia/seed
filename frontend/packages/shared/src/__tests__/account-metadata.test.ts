import {Struct} from '@bufbuild/protobuf'
import {describe, expect, test} from 'vitest'
import {accountMetadataFromAccount} from '../account-metadata'

describe('accountMetadataFromAccount', () => {
  test('prefers profile fields over home metadata fields', () => {
    const metadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
      layout: 'Seed/Experimental/Newspaper',
    })

    const result = accountMetadataFromAccount({
      metadata,
      profile: {
        name: 'Profile Name',
        icon: 'profile-icon',
        description: 'Profile Description',
      },
    })

    expect(result.name).toBe('Profile Name')
    expect(result.icon).toBe('profile-icon')
    expect(result.summary).toBe('Profile Description')
    expect(result.layout).toBe('Seed/Experimental/Newspaper')
  })

  test('drops home metadata name/icon/summary when profile fields are missing or empty', () => {
    const homeMetadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
    })

    const result = accountMetadataFromAccount({
      homeDocumentInfo: {metadata: homeMetadata},
      profile: {
        name: '',
        icon: 'profile-icon',
        description: '   ',
      },
    })

    // Empty/whitespace profile fields yield undefined even when the home
    // document carries a value for the same field.
    expect(result.name).toBeUndefined()
    expect(result.icon).toBe('profile-icon')
    expect(result.summary).toBeUndefined()
  })

  test('name/icon/summary are undefined when no profile is present, even with home metadata', () => {
    const metadata = Struct.fromJson({
      name: 'Deprecated Metadata Name',
    })
    const homeMetadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
    })

    const result = accountMetadataFromAccount({
      metadata,
      homeDocumentInfo: {metadata: homeMetadata},
    })

    expect(result.name).toBeUndefined()
    expect(result.icon).toBeUndefined()
    expect(result.summary).toBeUndefined()
  })

  test('name/icon/summary are undefined when only legacy metadata is present', () => {
    const metadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
    })

    const result = accountMetadataFromAccount({metadata})

    expect(result.name).toBeUndefined()
    expect(result.icon).toBeUndefined()
    expect(result.summary).toBeUndefined()
  })

  test('non-identity fields still come through from home metadata', () => {
    const homeMetadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
      layout: 'Seed/Experimental/Newspaper',
      siteUrl: 'https://example.com',
    })

    const result = accountMetadataFromAccount({
      homeDocumentInfo: {metadata: homeMetadata},
      profile: {name: 'Profile Name'},
    })

    expect(result.name).toBe('Profile Name')
    expect(result.layout).toBe('Seed/Experimental/Newspaper')
    expect(result.siteUrl).toBe('https://example.com')
  })
})
