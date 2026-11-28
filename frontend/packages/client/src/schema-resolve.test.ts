import {describe, expect, it} from 'vitest'
import {checkSchemaDefinition, loadSchemaRef, type SchemaFetchClient} from './schema-resolve'

const CID = 'bafyreicwhj2vug2qzr76bbi7vtqoygm7vchmenlcnfq5ykbjnmeh5pa3mq'

/** A server that will not serve the schema blob, the way hyper.media answers for one nothing links to. */
const notPublic: SchemaFetchClient = {
  request: (async (key: string, input: {cid?: string}) => {
    if (key === 'GetCID') throw new Error(`Failed to fetch /ipfs/${input.cid}.dagjson: blob ${input.cid} is not public`)
    if (key === 'Resource') return {type: 'document', document: {metadata: {schemaDefinition: `ipfs://${CID}`}}}
    throw new Error(`unexpected ${key}`)
  }) as SchemaFetchClient['request'],
}

describe('a schema that cannot be fetched says why', () => {
  it('for an ipfs:// reference', async () => {
    await expect(loadSchemaRef(notPublic, `ipfs://${CID}`)).rejects.toThrow(
      `Could not fetch the schema at ipfs://${CID} (Failed to fetch /ipfs/${CID}.dagjson: blob ${CID} is not public)`,
    )
    expect((await checkSchemaDefinition(notPublic, `ipfs://${CID}`)).join()).toContain('is not public')
  })

  it('for a type document whose schemaDefinition cannot be fetched', async () => {
    await expect(
      loadSchemaRef(notPublic, 'hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/types/contact'),
    ).rejects.toThrow(/schema blob that .* points at could not be fetched .*is not public/)
  })
})
