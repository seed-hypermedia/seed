import {parseCidString} from './dag-json'

// Reserved HM document metadata key. A schema document names the schema it
// describes by REFERENCE: `schemaDefinition` is an `ipfs://<cid>` string
// pointing at the schema blob (an immutable DAG-CBOR blob produced by the
// schema editor). The hm:// document URL is the human/stable identity; the
// ipfs://<cid> is the exact content it resolves to. Storing a reference (a
// plain string) also sidesteps the metadata array/float limitation.
export const SCHEMA_DEFINITION_KEY = 'schemaDefinition'

/** Multicodec code for DAG-CBOR — schema blobs are DAG-CBOR. */
const DAG_CBOR_CODE = 0x71

/**
 * The CID of the schema blob a schema document points at — parsed from its
 * `schemaDefinition` metadata (`ipfs://<cid>` or a bare CID). Returns null
 * unless it is a well-formed DAG-CBOR CID.
 */
export function getSchemaDefinitionCid(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const raw = (metadata as Record<string, unknown>)[SCHEMA_DEFINITION_KEY]
  if (typeof raw !== 'string') return null
  const cid = raw.trim().replace(/^ipfs:\/\//, '')
  return parseCidString(cid)?.code === DAG_CBOR_CODE ? cid : null
}

/** True iff the metadata marks this document as describing a schema. */
export function isSchemaDocument(metadata: unknown): boolean {
  return getSchemaDefinitionCid(metadata) !== null
}

/**
 * Build the metadata fragment that marks a document as describing the schema
 * blob at `cid` (stored as an `ipfs://<cid>` reference).
 */
export function setSchemaDefinition(cid: string): {schemaDefinition: string} {
  return {schemaDefinition: `ipfs://${cid}`}
}
