import {describe, expect, it} from 'vitest'
import {draftSchemaDraft, splitLegacySchemaDraft} from '../schema-draft'

describe('schema-draft', () => {
  const SCHEMA = {type: 'struct', properties: {}}

  it('splits an older draft’s metadata into metadata proper and the working schema', () => {
    expect(splitLegacySchemaDraft({name: 'A', schemaDraft: SCHEMA})).toEqual({
      metadata: {name: 'A'},
      schemaDraft: SCHEMA,
    })
    const clean = {name: 'A'}
    expect(splitLegacySchemaDraft(clean).metadata).toBe(clean)
    expect(splitLegacySchemaDraft(clean).schemaDraft).toBeNull()
    expect(splitLegacySchemaDraft(undefined)).toEqual({metadata: undefined, schemaDraft: null})
  })

  it('reads a draft’s working schema from its own field, else the legacy metadata key', () => {
    expect(draftSchemaDraft({schemaDraft: SCHEMA, metadata: {}})).toEqual(SCHEMA)
    expect(draftSchemaDraft({metadata: {schemaDraft: SCHEMA}})).toEqual(SCHEMA)
    expect(draftSchemaDraft({metadata: {name: 'A'}})).toBeNull()
    expect(draftSchemaDraft({schemaDraft: 'nope'})).toBeNull()
    expect(draftSchemaDraft(null)).toBeNull()
  })
})
