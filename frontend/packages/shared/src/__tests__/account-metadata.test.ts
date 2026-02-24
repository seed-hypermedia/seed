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

  test('falls back per field to home metadata when profile fields are missing', () => {
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

    expect(result.name).toBe('Home Name')
    expect(result.icon).toBe('profile-icon')
    expect(result.summary).toBe('Home Summary')
  })

  test('uses home document metadata when available', () => {
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

    expect(result.name).toBe('Home Name')
    expect(result.icon).toBe('home-icon')
    expect(result.summary).toBe('Home Summary')
  })

  test('uses legacy metadata when home metadata is not present', () => {
    const metadata = Struct.fromJson({
      name: 'Home Name',
      icon: 'home-icon',
      summary: 'Home Summary',
    })

    const result = accountMetadataFromAccount({metadata})

    expect(result.name).toBe('Home Name')
    expect(result.icon).toBe('home-icon')
    expect(result.summary).toBe('Home Summary')
  })
})
