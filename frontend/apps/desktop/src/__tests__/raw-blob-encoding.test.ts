import * as cbor from '@ipld/dag-cbor'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {isOnyxSchema, ONYX_SCHEMAS, seedValue} from '@shm/ui/onyx/index'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, it} from 'vitest'

const CID_STR = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'

describe('blob editor DAG-CBOR encoding', () => {
  it('encodes DAG-JSON link forms as real IPLD links (tag 42)', () => {
    const encoded = cbor.encode(dagJsonToIpld({link: {'/': CID_STR}}))
    const decoded = cbor.decode(encoded) as {link: CID}
    expect(decoded.link).toBeInstanceOf(CID)
    expect(decoded.link.toString()).toBe(CID_STR)
  })

  it('encodes DAG-JSON bytes forms as real CBOR byte strings', () => {
    const encoded = cbor.encode(dagJsonToIpld({data: {'/': {bytes: 'AQID'}}}))
    const decoded = cbor.decode(encoded) as {data: Uint8Array}
    expect(decoded.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(decoded.data)).toEqual([1, 2, 3])
  })

  it('round-trips plain JSON values unchanged', () => {
    const value = {name: 'x', nested: {count: 3, flag: true}, items: [1, 'two', null]}
    const decoded = cbor.decode(cbor.encode(dagJsonToIpld(value)))
    expect(decoded).toEqual(value)
  })

  it('encodes a schema-linked instance with a real IPLD schema edge', () => {
    const instance = {schema: {'/': CID_STR}, title: 'Hello'}
    const decoded = cbor.decode(cbor.encode(dagJsonToIpld(instance))) as {schema: CID; title: string}
    expect(decoded.schema).toBeInstanceOf(CID)
    expect(decoded.schema.toString()).toBe(CID_STR)
    expect(decoded.title).toBe('Hello')
  })
})

describe('schema publish path', () => {
  it('a new-schema starter runs the publish pipeline to a stable content-addressed CID', async () => {
    // Exactly what BlobEditor.publish() runs when storing a New Schema blob:
    // encode the seeded meta-schema instance and content-address it.
    const starter = seedValue(ONYX_SCHEMAS['onyx-schema'])
    const data = cbor.encode(dagJsonToIpld(starter))
    const digest = await sha256.digest(data)
    expect(CID.createV1(0x71, digest).toString()).toBe('bafyreihxitwxlabd35a3mxq3ipelelo7oxuztbdfyyy6crhjmxz3gjcqcq')
  })

  it('a new-schema starter value is itself recognized as an Onyx schema', () => {
    // Mirrors NewInstanceEditor seeding with schemaCid = meta-schema CID.
    const starter = seedValue(ONYX_SCHEMAS['onyx-schema'])
    expect(isOnyxSchema(starter)).toBe(true)
  })

  it('an instance linking a regular schema is not itself a schema', () => {
    expect(isOnyxSchema({schema: {'/': CID_STR}, title: 'x'})).toBe(false)
  })
})
