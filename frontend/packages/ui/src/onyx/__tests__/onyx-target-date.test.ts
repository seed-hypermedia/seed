// The `target` key and the built-in date types, through the engine:
//   - a `{ref, target}` include keeps its format AND gains the target;
//   - extension inherits leaf refinements (format/pattern/bounds);
//   - the world-builder kit's typed documents expose them per field;
//   - a malformed date fails with a format-specific message.
import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, it} from 'vitest'
import {nameToUrl, ONYX_SCHEMAS, resolveSchema, validate} from '../onyx-engine'
import {onyxSubschema} from '../onyx-schema-context'
import {metadataSchemaOf} from '../onyx-schema-resolve'

const PLACE = nameToUrl('example-place-doc')!
const STATS = nameToUrl('example-stats')!

describe('target references', () => {
  it('a bare include with a target keeps the format and carries the target', () => {
    const {schema} = resolveSchema({ref: nameToUrl('hypermedia-ipfs')!, target: 'hm://acme/stats'})
    expect(schema.format).toBe('ipfs')
    expect(schema.target).toBe('hm://acme/stats')
  })

  it('extension inherits leaf refinements and can add a target', () => {
    const {schema} = resolveSchema({ref: nameToUrl('onyx-date')!, enum: ['2026-01-01'], target: 'hm://x'})
    expect(schema.format).toBe('date')
    expect(schema.pattern).toMatch(/^\^/)
    expect(schema.enum).toEqual(['2026-01-01'])
    expect(schema.target).toBe('hm://x')
  })

  it('a character document exposes date, link and object fields with targets', () => {
    const meta = metadataSchemaOf(ONYX_SCHEMAS['example-character-doc'])!
    const at = (key: string) => onyxSubschema(meta, [key], {}) as Record<string, any>
    expect(at('born').format).toBe('date')
    expect(at('born').pattern).toBeTruthy()
    expect(at('home')).toMatchObject({format: 'hm-url', target: PLACE})
    expect(at('stats')).toMatchObject({format: 'ipfs', target: STATS})
    expect(at('notes').format).toBe('ipfs')
    expect(at('notes').target).toBeUndefined()
    expect(at('role').enum).toContain('hero')
  })

  it('a target does not change what values are valid', () => {
    const field = {ref: nameToUrl('hypermedia-ipfs')!, target: STATS}
    expect(validate(field, 'ipfs://bafyfoo')).toEqual([])
    expect(validate(field, 42)).toHaveLength(1)
  })
})

describe('date types', () => {
  const date = ONYX_SCHEMAS['onyx-date']!
  const dateTime = ONYX_SCHEMAS['onyx-date-time']!

  it('accepts ISO calendar dates and rejects other shapes with a format message', () => {
    expect(validate(date, '2026-08-26')).toEqual([])
    expect(validate(date, '2026-13-01')).toEqual(['$: does not match pattern for format "date"'])
    expect(validate(date, '26/08/2026')).toHaveLength(1)
    expect(validate(date, '2026-08-26T10:00:00Z')).toHaveLength(1)
  })

  it('accepts RFC 3339 instants', () => {
    expect(validate(dateTime, '2026-08-26T14:30:00Z')).toEqual([])
    expect(validate(dateTime, '2026-08-26T14:30:00.250+02:00')).toEqual([])
    expect(validate(dateTime, '2026-08-26')).toEqual(['$: does not match pattern for format "date-time"'])
  })

  it('the character kit requires a born date and validates it', () => {
    const meta = metadataSchemaOf(ONYX_SCHEMAS['example-character-doc'])!
    expect(validate(meta, {name: 'X', role: 'hero'})).toContain('$: missing required "born"')
    expect(validate(meta, {name: 'X', role: 'hero', born: 'yesterday'})).toContain(
      '$.born: does not match pattern for format "date"',
    )
    expect(validate(meta, {name: 'X', role: 'hero', born: '0990-04-01'})).toEqual([])
  })
})

describe('kit schemas', () => {
  it('every kit type is a document schema and its blob has a stable CID', async () => {
    for (const name of ['example-character-doc', 'example-place-doc', 'example-faction-doc', 'example-event-doc']) {
      const s = ONYX_SCHEMAS[name]!
      expect(s.ref).toBe(nameToUrl('hypermedia-document'))
      const data = cbor.encode(s)
      const cid = CID.createV1(0x71, await sha256.digest(data)).toString()
      expect(cid).toMatch(/^bafyrei/)
    }
  })
})
