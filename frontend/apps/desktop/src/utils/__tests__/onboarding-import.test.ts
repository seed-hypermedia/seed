import {describe, expect, it} from 'vitest'

import {getImportKeyFilePathError, normalizeImportKeyFilePath} from '../onboarding-import'

describe('normalizeImportKeyFilePath', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeImportKeyFilePath('  /tmp/alice.hmkey.json  ')).toBe('/tmp/alice.hmkey.json')
  })
})

describe('getImportKeyFilePathError', () => {
  it('requires a path', () => {
    expect(getImportKeyFilePathError('')).toBe('Key file path is required')
  })

  it('accepts .hmkey.json files', () => {
    expect(getImportKeyFilePathError('/tmp/alice.hmkey.json')).toBeNull()
  })

  it('rejects other extensions', () => {
    expect(getImportKeyFilePathError('/tmp/alice.txt')).toBe('Key file must end with .hmkey.json')
    expect(getImportKeyFilePathError('/tmp/alice.json')).toBe('Key file must end with .hmkey.json')
  })

  it('requires an absolute path', () => {
    expect(getImportKeyFilePathError('alice.hmkey.json')).toBe('Key file path must be absolute')
    expect(getImportKeyFilePathError('C:\\\\keys\\\\alice.hmkey.json')).toBeNull()
  })
})
