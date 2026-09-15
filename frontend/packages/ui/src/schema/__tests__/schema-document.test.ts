import * as cbor from '@ipld/dag-cbor'
import {describe, expect, it} from 'vitest'
import {schemaCid} from '../engine'
import {freezeSchemaDraft, isSchemaDocument, SCHEMA_DEFINITION_KEY, schemaDefinitionCid} from '../schema-document'

describe('schema-document metadata helpers', () => {
  const employeeCid = schemaCid('example/employee')! // a real bundled schema's published CID

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

describe('freezeSchemaDraft', () => {
  const SCHEMA = {type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/struct', properties: {}}
  const recordingClient = () => {
    const published: any[] = []
    return {
      published,
      client: {
        request: async (method: string, params: any) => {
          if (method === 'PublishBlobs') published.push(...params.blobs)
          return {cids: []}
        },
      } as any,
    }
  }

  it('publishes the draft’s working schema and points schemaDefinition at it', async () => {
    const {client, published} = recordingClient()
    const out = await freezeSchemaDraft(client, {name: 'Place'}, SCHEMA)
    expect(published).toHaveLength(1)
    expect(cbor.decode(published[0].data)).toEqual(SCHEMA)
    expect(out).toEqual({name: 'Place', [SCHEMA_DEFINITION_KEY]: `ipfs://${published[0].cid}`})
  })

  it('freezes an older draft’s metadata copy too, and never publishes the key', async () => {
    const {client, published} = recordingClient()
    const out = await freezeSchemaDraft(client, {name: 'Place', schemaDraft: SCHEMA})
    expect(published).toHaveLength(1)
    expect(out).not.toHaveProperty('schemaDraft')
    expect(out?.[SCHEMA_DEFINITION_KEY]).toBe(`ipfs://${published[0].cid}`)
  })

  it('passes metadata without a working schema through, publishing nothing', async () => {
    const {client, published} = recordingClient()
    const metadata = {name: 'Doc'}
    expect(await freezeSchemaDraft(client, metadata)).toBe(metadata)
    expect(published).toHaveLength(0)
  })
})
