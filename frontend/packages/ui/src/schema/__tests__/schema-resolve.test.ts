import {describe, expect, it} from 'vitest'
import {HM_SCHEMAS, fieldSchema, requiredFieldNames, resolveSchema, schemaCid, validate} from '../engine'
import {bareCid, classifyRef, metadataSchemaOf} from '../schema-resolve'

const LIBRARY = 'hm://hyper.media'
/** Some account's space, not the library. */
const ACCOUNT = 'z6MkSomeAccountTestTestTestTestTestTestTestTest'
const personCid = schemaCid('example/person')!

describe('hypermedia-metadata semantic field formats', () => {
  // The format that a metadata field's (resolved) schema declares — this is what
  // the value editor keys off to render the richer HM-link / IPFS-file inputs.
  const fieldFormat = (key: string) => {
    const meta = resolveSchema(HM_SCHEMAS['metadata']).schema
    return resolveSchema(fieldSchema(meta, key)!).schema.format
  }
  it('attributesSchema and childAttributesSchema are HM links (hm-url)', () => {
    expect(fieldFormat('attributesSchema')).toBe('hm-url')
    expect(fieldFormat('childAttributesSchema')).toBe('hm-url')
  })
  it('icon, cover, and schemaDefinition are IPFS files (ipfs-url)', () => {
    expect(fieldFormat('icon')).toBe('ipfs-url')
    expect(fieldFormat('cover')).toBe('ipfs-url')
    expect(fieldFormat('schemaDefinition')).toBe('ipfs-url')
  })
  it('the format-typed reference schemas are valid Hypermedia schemas', () => {
    expect(validate(HM_SCHEMAS['schema'], HM_SCHEMAS['hm-url'])).toEqual([])
    expect(validate(HM_SCHEMAS['schema'], HM_SCHEMAS['ipfs-url'])).toEqual([])
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
  it('a library schema URL (hm://hyper.media/…) is hm-bundled (no fetch)', () => {
    expect(classifyRef(`${LIBRARY}/example/person`)).toEqual({kind: 'hm-bundled', name: 'example/person'})
    // the base document schema too
    expect(classifyRef(`${LIBRARY}/document`)).toEqual({kind: 'hm-bundled', name: 'document'})
  })
  it('a primitive kind URL resolves to its bundled schema', () => {
    expect(classifyRef('hm://hyper.media/string')).toEqual({
      kind: 'hm-bundled',
      name: 'string',
    })
  })
  it('an unknown hm:// document URL needs a fetch (hm-doc)', () => {
    expect(classifyRef('hm://someaccount/people/bob')).toEqual({kind: 'hm-doc', url: 'hm://someaccount/people/bob'})
  })
  it('an ipfs CID is a direct cid ref', () => {
    expect(classifyRef(`ipfs://${personCid}`)).toEqual({kind: 'cid', cid: personCid})
  })
  it('a gateway/web URL normalizes to its hm:// form', () => {
    // A pasted or search-picked link often arrives as an https gateway URL. An account's document is
    // fetched like any other, even when its path matches a bundled schema name.
    expect(classifyRef(`https://hyper.media/hm/${ACCOUNT}/example/employee`)).toEqual({
      kind: 'hm-doc',
      url: `hm://${ACCOUNT}/example/employee`,
    })
  })
  it('an account URL whose path matches a bundled name is still a document to fetch (hm-doc)', () => {
    expect(classifyRef(`hm://${ACCOUNT}/document`)).toEqual({kind: 'hm-doc', url: `hm://${ACCOUNT}/document`})
    expect(classifyRef(`hm://${ACCOUNT}/string`)).toEqual({kind: 'hm-doc', url: `hm://${ACCOUNT}/string`})
  })
  it('the retired dev authority is an ordinary document URL now, not the bundle', () => {
    expect(classifyRef('hm://seed.hyper.media/string')).toEqual({kind: 'hm-doc', url: 'hm://seed.hyper.media/string'})
  })
  it('empty / junk is none', () => {
    expect(classifyRef('')).toEqual({kind: 'none'})
    expect(classifyRef(null)).toEqual({kind: 'none'})
    expect(classifyRef('hello')).toEqual({kind: 'none'})
  })
})

describe('metadataSchemaOf', () => {
  it('an attributes schema is the struct itself (required surname)', () => {
    const meta = metadataSchemaOf(HM_SCHEMAS['example/person-doc'])
    expect(meta).toBeTruthy()
    expect(requiredFieldNames(meta)).toContain('surname')
    expect(meta!.properties).toHaveProperty('surname')
    expect(meta!.properties).toHaveProperty('givenName')
    // it validates the attributes alone; the base metadata fields are folded in by documentMetadataSchema
    expect(validate(meta!, {surname: 'Vicenti'})).toEqual([])
    expect(validate(meta!, {givenName: 'x'}).length).toBeGreaterThan(0) // missing surname
  })
  it('flat schema: is its own metadata schema', () => {
    const meta = metadataSchemaOf(HM_SCHEMAS['example/person'])
    // example-person is a flat map with required name — used directly
    expect(requiredFieldNames(meta)).toContain('name')
    expect(meta!.properties).toHaveProperty('age')
  })
  it('undefined passes through', () => {
    expect(metadataSchemaOf(undefined)).toBeUndefined()
  })
})
