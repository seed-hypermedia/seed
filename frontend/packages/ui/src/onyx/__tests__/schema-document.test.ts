import {describe, expect, it} from 'vitest'
import {schemaCid} from '../onyx-engine'
import {isSchemaDocument, SCHEMA_DEFINITION_KEY, schemaDefinitionCid} from '../schema-document'

describe('schema-document metadata helpers', () => {
  const employeeCid = schemaCid('example-employee')! // a real bundled schema's published CID

  it('reads the schemaDefinition CID, stripping ipfs://', () => {
    expect(schemaDefinitionCid({[SCHEMA_DEFINITION_KEY]: `ipfs://${employeeCid}`})).toBe(employeeCid)
    expect(schemaDefinitionCid({[SCHEMA_DEFINITION_KEY]: employeeCid})).toBe(employeeCid)
  })

  it('returns null when there is no schemaDefinition', () => {
    expect(schemaDefinitionCid({name: 'Doc'})).toBeNull()
    expect(schemaDefinitionCid(null)).toBeNull()
    expect(schemaDefinitionCid(undefined)).toBeNull()
    expect(schemaDefinitionCid({[SCHEMA_DEFINITION_KEY]: 42})).toBeNull()
  })

  it('isSchemaDocument is true only when the CID resolves to a bundled schema', () => {
    expect(isSchemaDocument({[SCHEMA_DEFINITION_KEY]: `ipfs://${employeeCid}`})).toBe(true)
    // a well-formed but unknown CID does not resolve to a bundled schema
    expect(
      isSchemaDocument({[SCHEMA_DEFINITION_KEY]: 'ipfs://bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),
    ).toBe(false)
    expect(isSchemaDocument({name: 'Doc'})).toBe(false)
  })
})
