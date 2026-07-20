// Schema-keyed metadata fields, on the Onyx engine. A metadata field whose KEY
// is an `ipfs://<cid>` URL declares that its value should conform to that
// schema. The Onyx port of the v1 buildSchemaKeyRoot/collectSchemaKeyCids/
// schemaKeyCid (blob-schema-edit.ts). We synthesize an OPEN Onyx map: the
// schema-keyed keys are validated against their (inlined) schemas; every other
// key is accepted (`values: {}` — the empty schema imposes no constraint).
import {parseCidString} from '../dag-json'
import {ONYX_SCHEMAS, resolveSchema, type OnyxRegistry, type OnyxSchema} from './onyx-engine'

const DAG_CBOR_CODE = 0x71

/** The bare DAG-CBOR CID of a schema-keyed field key (`ipfs://<cid>`), or null. */
export function schemaKeyCid(key: string): string | null {
  if (typeof key !== 'string' || !key.startsWith('ipfs://')) return null
  const cid = key.replace(/^ipfs:\/\//, '').split('/')[0] ?? ''
  return parseCidString(cid)?.code === DAG_CBOR_CODE ? cid : null
}

/** The distinct DAG-CBOR CIDs referenced by the schema-keyed keys in `keys`. */
export function collectSchemaKeyCids(keys: string[]): string[] {
  const cids: string[] = []
  for (const key of keys) {
    const cid = schemaKeyCid(key)
    if (cid && !cids.includes(cid)) cids.push(cid)
  }
  return cids
}

/**
 * An open Onyx map schema for a value whose schema-keyed (`ipfs://<cid>`) keys
 * should validate against their schemas. Returns undefined when no key is
 * schema-keyed (no schema-awareness needed). `byCid` supplies the resolved
 * schemas (see useOnyxSchemaRegistry).
 */
export function buildSchemaKeyRoot(keys: string[], byCid: Record<string, OnyxSchema>): OnyxSchema | undefined {
  const properties: Record<string, OnyxSchema> = {}
  for (const key of keys) {
    const cid = schemaKeyCid(key)
    if (cid && byCid[cid]) properties[key] = byCid[cid]!
  }
  if (Object.keys(properties).length === 0) return undefined
  return {type: 'hm://hyper.media/map', properties, values: {}}
}

/**
 * The effective schema for a document's metadata: the base document-metadata
 * schema (`hypermedia-metadata` — name/summary/icon/…) EXTENDED by the document's
 * own type schema (its `schemaDefinition`). Standard fields are inherited; the
 * document type's fields are added (required ones surface as prepopulated chips).
 * Kept OPEN (`values: {}`) so the schemaDefinition field itself and arbitrary
 * extra keys are still allowed. `extraProps` folds in any schema-keyed fields.
 */
export function documentMetadataSchema(
  docTypeSchema: OnyxSchema,
  extraProps: Record<string, OnyxSchema> = {},
  registry: OnyxRegistry = {},
): OnyxSchema {
  const base = resolveSchema(ONYX_SCHEMAS['hypermedia-metadata']).schema
  const doc = resolveSchema(docTypeSchema, {}, registry).schema
  return {
    type: 'hm://hyper.media/map',
    properties: {...(base.properties || {}), ...(doc.properties || {}), ...extraProps},
    required: Array.from(new Set<string>([...(base.required || []), ...(doc.required || [])])),
    values: {},
  }
}
