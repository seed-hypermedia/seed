/**
 * Unit Tests for Type Utilities
 */

import {describe, it, expect} from 'vitest'
import {parseHmIri, buildHmIri} from '../types'

describe('parseHmIri', () => {
  it('should parse basic IRI', () => {
    const result = parseHmIri('hm://account123/path/to/doc')
    expect(result).toEqual({
      account: 'account123',
      path: 'path/to/doc',
    })
  })

  it('should parse IRI with version', () => {
    const result = parseHmIri('hm://account123/path/to/doc?v=version456')
    expect(result).toEqual({
      account: 'account123',
      path: 'path/to/doc',
      version: 'version456',
    })
  })

  it('should return null for invalid IRI', () => {
    expect(parseHmIri('invalid-iri')).toBeNull()
    expect(parseHmIri('https://example.com')).toBeNull()
    expect(parseHmIri('hm://account-only')).toBeNull()
  })
})

describe('buildHmIri', () => {
  it('should build basic IRI', () => {
    const iri = buildHmIri('account123', 'path/to/doc')
    expect(iri).toBe('hm://account123/path/to/doc')
  })

  it('should build IRI with version', () => {
    const iri = buildHmIri('account123', 'path/to/doc', 'version456')
    expect(iri).toBe('hm://account123/path/to/doc?v=version456')
  })

  it('should round-trip with parseHmIri', () => {
    const original = {
      account: 'account123',
      path: 'path/to/doc',
      version: 'version456',
    }

    const iri = buildHmIri(original.account, original.path, original.version)
    const parsed = parseHmIri(iri)

    expect(parsed).toEqual(original)
  })
})
