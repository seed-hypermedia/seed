import * as cbor from '@ipld/dag-cbor'
import {BLOB_META_SCHEMA, BLOB_META_SCHEMA_CID, instantiateSchema, isSchemaBlob} from '@shm/ui/blob-schema'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {isPlainObject} from '@shm/ui/value-editor'
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
  it('meta-schema encodes to its pinned CID through the publish pipeline', async () => {
    // Exactly what BlobEditor.publish() runs when storing the meta-schema
    // blob alongside a schema — drift here would dangle every schema link.
    const data = cbor.encode(dagJsonToIpld(BLOB_META_SCHEMA))
    const digest = await sha256.digest(data)
    expect(CID.createV1(0x71, digest).toString()).toBe(BLOB_META_SCHEMA_CID)
  })

  it('a new-schema starter value is itself recognized as a schema blob', () => {
    // Mirrors NewInstanceEditor seeding with schemaCid = meta-schema CID.
    const starter = instantiateSchema(BLOB_META_SCHEMA, {[BLOB_META_SCHEMA_CID]: BLOB_META_SCHEMA})
    const value = {
      ...(isPlainObject(starter) ? starter : {}),
      schema: {'/': BLOB_META_SCHEMA_CID},
    }
    expect(isSchemaBlob(value)).toBe(true)
  })

  it('an instance linking a regular schema is not itself a schema', () => {
    expect(isSchemaBlob({schema: {'/': CID_STR}, title: 'x'})).toBe(false)
  })
})
