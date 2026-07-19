import {describe, expect, test} from 'vitest'
import {BLOB_META_SCHEMA_CID} from '../blob-schema'
import {getSchemaDefinitionCid, isSchemaDocument, setSchemaDefinition} from '../schema-document'

// A real DAG-CBOR (0x71) CIDv1, standing in for a schema blob's CID.
const CID = BLOB_META_SCHEMA_CID

describe('schema-document helpers (ipfs://<cid> reference)', () => {
  test('setSchemaDefinition -> getSchemaDefinitionCid round-trips the CID', () => {
    const fragment = setSchemaDefinition(CID)
    expect(fragment.schemaDefinition).toBe(`ipfs://${CID}`)
    expect(getSchemaDefinitionCid(fragment)).toBe(CID)
  })

  test('isSchemaDocument is true for an ipfs://<dag-cbor cid> reference', () => {
    const metadata = {name: 'Person', ...setSchemaDefinition(CID)}
    expect(isSchemaDocument(metadata)).toBe(true)
  })

  test('accepts a bare CID (no ipfs:// prefix)', () => {
    expect(getSchemaDefinitionCid({schemaDefinition: CID})).toBe(CID)
  })

  test('missing schemaDefinition -> null / false', () => {
    expect(getSchemaDefinitionCid({name: 'not a schema'})).toBeNull()
    expect(isSchemaDocument({name: 'not a schema'})).toBe(false)
  })

  test('non-string schemaDefinition -> null / false', () => {
    expect(getSchemaDefinitionCid({schemaDefinition: {'/': CID}})).toBeNull()
    expect(isSchemaDocument({schemaDefinition: 42})).toBe(false)
  })

  test('a non-CID / non-DAG-CBOR reference is rejected', () => {
    expect(getSchemaDefinitionCid({schemaDefinition: 'ipfs://not-a-cid'})).toBeNull()
    expect(getSchemaDefinitionCid({schemaDefinition: 'ipfs://'})).toBeNull()
    expect(isSchemaDocument({schemaDefinition: 'hm://some/doc'})).toBe(false)
  })

  test('non-object metadata -> null / false', () => {
    expect(getSchemaDefinitionCid(null)).toBeNull()
    expect(getSchemaDefinitionCid(undefined)).toBeNull()
    expect(getSchemaDefinitionCid('a string')).toBeNull()
    expect(isSchemaDocument(null)).toBe(false)
  })
})
