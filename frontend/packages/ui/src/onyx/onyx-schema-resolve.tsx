// Resolve a document's CONFORMANCE schema — the corrected model's core lookup.
//
// A schema reference (the value of a `schema` / `childrenSchema` metadata field,
// or an `extends` ref) is one of:
//   - an ipfs CID (`ipfs://<cid>` or bare)        -> resolve the blob directly
//   - a bundled library URL (`hm://…/<basename>`)  -> the bundled Onyx schema (sync)
//   - a Hypermedia document URL (`hm://acct/path`) -> fetch that document, read its
//        `schemaDefinition` metadata (the schema it DEFINES), then resolve that CID
//
// A document's EFFECTIVE conformance schema is its own metadata `schema`, or —
// when absent — its parent's `childrenSchema`. From the resolved schema we derive
// the METADATA sub-schema (document-shaped schemas nest it under `metadata`; flat
// schemas are the metadata schema themselves), which drives required-field UI.
import {useMemo} from 'react'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, unpackHmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {parseCidString} from '../dag-json'
import {ONYX_SCHEMAS, refToName, resolveSchema, type OnyxRegistry, type OnyxSchema} from './onyx-engine'
import {useOnyxSchemaRegistry} from './onyx-schema-registry-cid'
import {schemaDefinitionCid} from './schema-document'

const DAG_CBOR_CODE = 0x71

/** The bare DAG-CBOR CID of an `ipfs://<cid>` (or bare-CID) string, else null. */
export function bareCid(ref: string): string | null {
  const cid = ref.replace(/^ipfs:\/\//i, '').split('/')[0] ?? ''
  return parseCidString(cid)?.code === DAG_CBOR_CODE ? cid : null
}

export type RefKind =
  | {kind: 'none'}
  | {kind: 'cid'; cid: string}
  | {kind: 'hm-bundled'; name: string}
  | {kind: 'hm-doc'; url: string}

/** Classify a schema reference without fetching anything. */
export function classifyRef(ref: string | null | undefined): RefKind {
  const s = typeof ref === 'string' ? ref.trim() : ''
  if (!s) return {kind: 'none'}
  if (s.startsWith('hm://')) {
    const name = refToName(s)
    return ONYX_SCHEMAS[name] ? {kind: 'hm-bundled', name} : {kind: 'hm-doc', url: s}
  }
  const cid = bareCid(s)
  return cid ? {kind: 'cid', cid} : {kind: 'none'}
}

/**
 * The metadata sub-schema of a (resolved) conformance schema. Document-shaped
 * schemas (extending the base document) carry it under `properties.metadata`;
 * a flat map schema IS the metadata schema. Returns undefined for no schema.
 */
export function metadataSchemaOf(schema: OnyxSchema | undefined, reg: OnyxRegistry = {}): OnyxSchema | undefined {
  if (!schema) return undefined
  const resolved = resolveSchema(schema, {}, reg).schema
  const metaProp = resolved.properties?.metadata
  if (metaProp) return resolveSchema(metaProp, {}, reg).schema
  return resolved
}

/**
 * Resolve a single schema reference to its Onyx schema. Async only for the
 * `hm-doc` and unbundled-`cid` cases (a network fetch); bundled refs resolve
 * synchronously. Advisory: an unresolvable ref simply yields `schema: undefined`.
 */
export function useResolvedSchema(ref: string | null | undefined): {schema?: OnyxSchema; isLoading: boolean} {
  const cls = useMemo(() => classifyRef(ref), [ref])

  // hm-doc: fetch the schema-definition document, read its `schemaDefinition`.
  const docId = useMemo(() => (cls.kind === 'hm-doc' ? unpackHmId(cls.url) : null), [cls])
  const resource = useResource(docId)
  const docSchemaCid = useMemo(() => {
    if (cls.kind !== 'hm-doc') return null
    const data = resource.data
    return data?.type === 'document' ? schemaDefinitionCid(data.document.metadata) : null
  }, [cls, resource.data])

  // The CID to fetch (direct, or the definition doc's schemaDefinition).
  const cid = cls.kind === 'cid' ? cls.cid : docSchemaCid
  const {byCid, isLoading: cidLoading} = useOnyxSchemaRegistry(cid ? [cid] : [])

  const schema = cls.kind === 'hm-bundled' ? ONYX_SCHEMAS[cls.name] : cid ? byCid[cid] : undefined
  const isLoading =
    !schema && ((cls.kind === 'hm-doc' && (resource.isLoading || !!docSchemaCid)) || (cls.kind === 'cid' && cidLoading))

  return {schema, isLoading}
}

/**
 * The document's EFFECTIVE conformance schema: its own metadata `schema`, else
 * its parent's `childrenSchema`. Returns the resolved schema, its metadata
 * sub-schema (for required-field UI), and which source supplied it.
 */
export function useEffectiveDocSchema(
  id: UnpackedHypermediaId | null | undefined,
  metadata: unknown,
): {
  schema?: OnyxSchema
  metadataSchema?: OnyxSchema
  source: 'own' | 'inherited' | 'none'
  isLoading: boolean
} {
  const ownRef = typeof (metadata as any)?.schema === 'string' ? ((metadata as any).schema as string) : null

  // Only look up the parent when this doc declares no `schema` of its own.
  const parentId = useMemo(() => {
    if (ownRef || !id || !id.path || id.path.length === 0) return null
    return hmId(id.uid, {path: id.path.slice(0, -1)})
  }, [ownRef, id])
  const parent = useResource(parentId)
  const parentChildrenRef = useMemo(() => {
    if (ownRef) return null
    const data = parent.data
    if (data?.type !== 'document') return null
    const cs = (data.document.metadata as any)?.childrenSchema
    return typeof cs === 'string' ? cs : null
  }, [ownRef, parent.data])

  const effectiveRef = ownRef ?? parentChildrenRef
  const {schema, isLoading} = useResolvedSchema(effectiveRef)
  const metadataSchema = useMemo(() => metadataSchemaOf(schema), [schema])
  const source: 'own' | 'inherited' | 'none' = ownRef ? 'own' : parentChildrenRef ? 'inherited' : 'none'

  return {schema, metadataSchema, source, isLoading: isLoading || (!!parentId && parent.isLoading)}
}
