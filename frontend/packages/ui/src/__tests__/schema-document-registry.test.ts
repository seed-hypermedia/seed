import {describe, expect, it} from 'vitest'
import {BLOB_META_SCHEMA_CID} from '../blob-schema'
import {setSchemaDefinition} from '../schema-document'
import {schemaCidsFromResources} from '../schema-document-registry'

// Two distinct DAG-CBOR CIDs standing in for schema blobs. (The meta CID is a
// real one; the second is any other valid-looking DAG-CBOR CIDv1.)
const CID_A = BLOB_META_SCHEMA_CID
const CID_B = 'bafyreibdzxfhzzxwtjc3epzs4s76o7fdwm5zc55ldsknp2plfkj2tjoefy'

describe('schemaCidsFromResources', () => {
  it('maps a schema document to registry[url] = the referenced schema CID', () => {
    const url = 'hm://acme/schemas/person'
    const metadata = {name: 'Person', ...setSchemaDefinition(CID_A)}
    expect(schemaCidsFromResources([{url, metadata}])).toEqual({[url]: CID_A})
  })

  it('skips a document whose metadata does not reference a schema blob', () => {
    expect(schemaCidsFromResources([{url: 'hm://acme/plain', metadata: {name: 'Plain Doc'}}])).toEqual({})
  })

  it('skips an invalid / non-DAG-CBOR schemaDefinition reference', () => {
    const entries = [
      {url: 'hm://a', metadata: {schemaDefinition: 'ipfs://not-a-cid'}},
      {url: 'hm://b', metadata: {schemaDefinition: 'hm://acme/other'}},
      {url: 'hm://c', metadata: {schemaDefinition: 42}},
    ]
    expect(schemaCidsFromResources(entries)).toEqual({})
  })

  it('maps multiple urls, skipping non-schema entries', () => {
    const entries = [
      {url: 'hm://acme/schemas/person', metadata: setSchemaDefinition(CID_A)},
      {url: 'hm://acme/plain', metadata: {title: 'Just a doc'}},
      {url: 'hm://acme/schemas/book', metadata: setSchemaDefinition(CID_B)},
    ]
    expect(schemaCidsFromResources(entries)).toEqual({
      'hm://acme/schemas/person': CID_A,
      'hm://acme/schemas/book': CID_B,
    })
  })
})
