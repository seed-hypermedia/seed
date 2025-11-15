/**
 * Unit Tests for Cache Configuration
 */

import {describe, it, expect} from 'vitest'
import {graphcacheConfig} from '../cache'

describe('graphcacheConfig', () => {
  it('should have keys configuration', () => {
    expect(graphcacheConfig.keys).toBeDefined()
    expect(typeof graphcacheConfig.keys).toBe('object')
  })

  it('should generate consistent cache keys for Document by IRI', () => {
    const document1 = {
      __typename: 'Document',
      iri: 'hm://account123/path/to/doc',
      account: 'account123',
      path: 'path/to/doc',
    }

    const document2 = {
      __typename: 'Document',
      iri: 'hm://account123/path/to/doc?v=version1',
      account: 'account123',
      path: 'path/to/doc',
    }

    const key1 = graphcacheConfig.keys?.Document?.(document1)
    const key2 = graphcacheConfig.keys?.Document?.(document2)

    // Both should normalize to same cache key (account + path)
    expect(key1).toBe('Account:account123:Resource:path/to/doc')
    expect(key2).toBe('Account:account123:Resource:path/to/doc')
    expect(key1).toBe(key2)
  })

  it('should generate cache key for Profile by accountId', () => {
    const profile = {
      __typename: 'Profile',
      accountId: 'account123',
    }

    const key = graphcacheConfig.keys?.Profile?.(profile)
    expect(key).toBe('Account:account123:Profile')
  })

  it('should not cache embedded block types', () => {
    const blockTypes = [
      'BlocksContent',
      'BlockNode',
      'ParagraphBlock',
      'HeadingBlock',
      'CodeBlock',
      'MathBlock',
      'ImageBlock',
      'VideoBlock',
      'FileBlock',
      'ButtonBlock',
      'EmbedBlock',
      'WebEmbedBlock',
      'NostrBlock',
    ]

    for (const typeName of blockTypes) {
      const keyFn = graphcacheConfig.keys?.[typeName]
      expect(keyFn).toBeDefined()
      const key = keyFn?.({})
      expect(key).toBeNull()
    }
  })
})
