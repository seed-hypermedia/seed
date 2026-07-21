import {describe, expect, it} from 'vitest'
import {ONYX_SCHEMAS, resolveSchema, schemaCid, validate} from '../onyx-engine'
import {bareCid, classifyRef, metadataSchemaOf} from '../onyx-schema-resolve'

const ONYX = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const personCid = schemaCid('example-person')!

describe('hypermedia-metadata semantic field formats', () => {
  // The format that a metadata field's (resolved) schema declares — this is what
  // the value editor keys off to render the richer HM-link / IPFS-file inputs.
  const fieldFormat = (key: string) => {
    const meta = resolveSchema(ONYX_SCHEMAS['hypermedia-metadata']).schema
    return resolveSchema(meta.properties![key]).schema.format
  }
  it('schema and childrenSchema are HM links (hm-url)', () => {
    expect(fieldFormat('schema')).toBe('hm-url')
    expect(fieldFormat('childrenSchema')).toBe('hm-url')
  })
  it('icon, cover, and schemaDefinition are IPFS files (ipfs)', () => {
    expect(fieldFormat('icon')).toBe('ipfs')
    expect(fieldFormat('cover')).toBe('ipfs')
    expect(fieldFormat('schemaDefinition')).toBe('ipfs')
  })
  it('the format-typed reference schemas are valid Onyx schemas', () => {
    expect(validate(ONYX_SCHEMAS['onyx-schema'], ONYX_SCHEMAS['hypermedia-hm-url'])).toEqual([])
    expect(validate(ONYX_SCHEMAS['onyx-schema'], ONYX_SCHEMAS['hypermedia-ipfs'])).toEqual([])
  })
})

describe('bareCid', () => {
  it('extracts a DAG-CBOR CID from ipfs:// and bare forms', () => {
    expect(bareCid(`ipfs://${personCid}`)).toBe(personCid)
    expect(bareCid(personCid)).toBe(personCid)
  })
  it('null for non-CID text', () => {
    expect(bareCid('not-a-cid')).toBeNull()
    expect(bareCid('')).toBeNull()
  })
})

describe('classifyRef', () => {
  it('a bundled schema published under the onyx account is hm-bundled (no fetch)', () => {
    expect(classifyRef(`${ONYX}/example-person`)).toEqual({kind: 'hm-bundled', name: 'example-person'})
    // the base document schema too
    expect(classifyRef(`${ONYX}/hypermedia-document`)).toEqual({kind: 'hm-bundled', name: 'hypermedia-document'})
  })
  it('a primitive kind URL resolves to its bundled schema', () => {
    expect(classifyRef('hm://hyper.media/string')).toEqual({kind: 'hm-bundled', name: 'onyx-string'})
  })
  it('an unknown hm:// document URL needs a fetch (hm-doc)', () => {
    expect(classifyRef('hm://someaccount/people/bob')).toEqual({kind: 'hm-doc', url: 'hm://someaccount/people/bob'})
  })
  it('an ipfs CID is a direct cid ref', () => {
    expect(classifyRef(`ipfs://${personCid}`)).toEqual({kind: 'cid', cid: personCid})
  })
  it('empty / junk is none', () => {
    expect(classifyRef('')).toEqual({kind: 'none'})
    expect(classifyRef(null)).toEqual({kind: 'none'})
    expect(classifyRef('hello')).toEqual({kind: 'none'})
  })
})

describe('metadataSchemaOf', () => {
  it('document-shaped: returns the nested metadata sub-schema (required surname)', () => {
    const meta = metadataSchemaOf(ONYX_SCHEMAS['example-person-doc'])
    expect(meta).toBeTruthy()
    expect(meta!.required).toContain('surname')
    // it is the extended base metadata: standard fields inherited
    expect(meta!.properties).toHaveProperty('name')
    expect(meta!.properties).toHaveProperty('surname')
    // and it validates as a metadata map
    expect(validate(meta!, {surname: 'Vicenti', name: 'x'})).toEqual([])
    expect(validate(meta!, {name: 'x'}).length).toBeGreaterThan(0) // missing surname
  })
  it('flat schema: is its own metadata schema', () => {
    const meta = metadataSchemaOf(ONYX_SCHEMAS['example-person'])
    // example-person is a flat map with required name — used directly
    expect(meta!.required).toContain('name')
    expect(meta!.properties).toHaveProperty('age')
  })
  it('undefined passes through', () => {
    expect(metadataSchemaOf(undefined)).toBeUndefined()
  })
})
