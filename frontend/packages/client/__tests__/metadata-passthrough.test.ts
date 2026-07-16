import {describe, expect, it} from 'vitest'
import {countCustomMetadataFields, HMDocumentMetadataSchema} from '../src/hm-types'

describe('HMDocumentMetadataSchema preserves custom metadata (open attribute map)', () => {
  it('keeps unknown top-level keys through parse', () => {
    const parsed = HMDocumentMetadataSchema.parse({
      name: 'Doc',
      customField: 'hello',
      anotherOne: 42,
      enabled: true,
    })
    expect(parsed.name).toBe('Doc')
    expect((parsed as Record<string, unknown>).customField).toBe('hello')
    expect((parsed as Record<string, unknown>).anotherOne).toBe(42)
    expect((parsed as Record<string, unknown>).enabled).toBe(true)
  })

  it('preserves the whole value of a schema-keyed (ipfs://) field, nested objects included', () => {
    const schemaKey = 'ipfs://bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
    const parsed = HMDocumentMetadataSchema.parse({
      name: 'Doc',
      [schemaKey]: {headline: 'Hi', status: 'draft', nested: {deep: 1}},
    })
    expect((parsed as Record<string, unknown>)[schemaKey]).toEqual({
      headline: 'Hi',
      status: 'draft',
      nested: {deep: 1},
    })
  })

  it('still validates and keeps known fields', () => {
    const parsed = HMDocumentMetadataSchema.parse({name: 'Doc', showOutline: true})
    expect(parsed.name).toBe('Doc')
    expect(parsed.showOutline).toBe(true)
  })
})

describe('countCustomMetadataFields', () => {
  it('counts only custom keys, not built-in HMDocumentMetadataSchema fields', () => {
    expect(
      countCustomMetadataFields({
        name: 'Doc',
        summary: 'built-in',
        cover: 'ipfs://x',
        theme: {headerLayout: 'Center'},
        customA: 'x',
        customB: 3,
      } as never),
    ).toBe(2)
  })

  it('returns 0 with no custom fields (or no metadata)', () => {
    expect(countCustomMetadataFields({name: 'Doc', showOutline: true} as never)).toBe(0)
    expect(countCustomMetadataFields(null)).toBe(0)
    expect(countCustomMetadataFields(undefined)).toBe(0)
    expect(countCustomMetadataFields({} as never)).toBe(0)
  })

  it('ignores custom keys whose value is null/undefined (draft tombstones)', () => {
    expect(countCustomMetadataFields({customA: 'x', removed: null, gone: undefined} as never)).toBe(1)
  })
})
