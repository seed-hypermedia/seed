import {describe, expect, it} from 'vitest'
import {getVersionHeads} from './entity-id-url'

describe('getVersionHeads', () => {
  it('returns an empty array for null/undefined/empty input', () => {
    expect(getVersionHeads(null)).toEqual([])
    expect(getVersionHeads(undefined)).toEqual([])
    expect(getVersionHeads('')).toEqual([])
  })

  it('returns a single CID when the version has no concurrent heads', () => {
    expect(getVersionHeads('bafyOnlyHead')).toEqual(['bafyOnlyHead'])
  })

  it('splits a dot-joined version into multiple heads', () => {
    expect(getVersionHeads('bafyA.bafyB')).toEqual(['bafyA', 'bafyB'])
    expect(getVersionHeads('bafyA.bafyB.bafyC')).toEqual(['bafyA', 'bafyB', 'bafyC'])
  })

  it('filters out empty segments produced by stray dots', () => {
    expect(getVersionHeads('.bafyA.')).toEqual(['bafyA'])
    expect(getVersionHeads('bafyA..bafyB')).toEqual(['bafyA', 'bafyB'])
  })
})
