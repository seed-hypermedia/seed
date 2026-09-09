// Resolving schema references: what a `schema`, `childrenSchema`, `ref` or `target` points at.
//
// A reference is one of three things (see hypermedia/typed-documents.md):
//   - a bundled library URL (`hm://<onyx>/hypermedia-string`)     → resolved locally, no fetch
//   - an ipfs CID (`ipfs://bafy…`)                                 → the blob, bundled if known
//   - any Hypermedia document URL (`hm://acct/types/person`)       → that document's `schemaDefinition`
// The synchronous parts classify and shape schemas; the async parts fetch through a Seed client
// and hydrate a registry so nested references resolve too. Shared by the app, the CLI and the
// agents service, so every surface resolves a type the same way.
import type {SeedClient} from './client'
import {parseCidString} from './dag-json'
import type {HMMetadata, UnpackedHypermediaId} from './hm-types'
import {
  type OnyxRegistry,
  type OnyxSchema,
  ONYX_SCHEMAS,
  fieldSchema,
  isLiteralSchema,
  loadFrom,
  refToName,
  resolveSchema,
  schemaCid,
  schemaForCid,
} from './onyx-engine'
import {packHmId, unpackHmId} from './hm-types'

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

/** Classify a schema reference without fetching anything. Accepts an `hm://`
 * URL, an ipfs CID, OR a gateway/web URL (`https://host/hm/uid/path`) — the last
 * is normalized to its `hm://` form so a pasted or search-picked web link
 * resolves the same as the canonical URL. */
export function classifyRef(ref: string | null | undefined): RefKind {
  let s = typeof ref === 'string' ? ref.trim() : ''
  if (!s) return {kind: 'none'}
  if (!s.startsWith('hm://')) {
    // ipfs:// or a bare CID → a direct blob reference.
    const cid = bareCid(s)
    if (cid) return {kind: 'cid', cid}
    // Otherwise try to read it as a hypermedia id (handles gateway/web URLs).
    const id = unpackHmId(s)
    if (!id) return {kind: 'none'}
    s = `hm://${id.uid}${id.path?.length ? `/${id.path.join('/')}` : ''}`
  }
  const name = refToName(s)
  return ONYX_SCHEMAS[name] ? {kind: 'hm-bundled', name} : {kind: 'hm-doc', url: s}
}

/**
 * The metadata sub-schema of a (resolved) conformance schema. Document-shaped
 * schemas (extending the base document) carry it under `properties.metadata`;
 * a flat map schema IS the metadata schema. Returns undefined for no schema.
 */
export function metadataSchemaOf(schema: OnyxSchema | undefined, reg: OnyxRegistry = {}): OnyxSchema | undefined {
  if (!schema) return undefined
  const resolved = resolveSchema(schema, {}, reg).schema
  const metaProp = fieldSchema(resolved, 'metadata')
  if (metaProp) return resolveSchema(metaProp, {}, reg).schema
  return resolved
}

/** The CID a document's `schemaDefinition` points at (`ipfs://<cid>`), if any. */
export function schemaDefinitionCid(metadata: unknown): string | null {
  const value = (metadata as {schemaDefinition?: unknown} | null | undefined)?.schemaDefinition
  return typeof value === 'string' ? bareCid(value) : null
}

/** A client that can answer the two requests resolution needs. */
export type SchemaFetchClient = Pick<SeedClient, 'request'>

/** The decoded blob at a CID, when it is a DAG-CBOR map (dag-json form, as the API returns it). */
export async function fetchSchemaBlob(client: SchemaFetchClient, cid: string): Promise<OnyxSchema | undefined> {
  const bundled = schemaForCid(cid)
  if (bundled) return bundled
  const result = await client.request('GetCID', {cid})
  const value = (result as {value?: unknown} | undefined)?.value
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as OnyxSchema) : undefined
}

export type ResolvedSchemaRef = {
  kind: RefKind['kind']
  /** The schema, when the reference resolved. */
  schema?: OnyxSchema
  /** The schema blob's CID, when known — what a conforming blob links to via its `schema` key. */
  cid?: string
  /** For an `hm-doc` reference: the type document's canonical URL. */
  documentUrl?: string
}

/**
 * Resolve one schema reference to its schema. Bundled references resolve without a fetch; a CID
 * fetches the blob (bundled if known); a document URL fetches the document and follows its
 * `schemaDefinition`. An unresolvable reference yields `schema: undefined`, never a throw —
 * validation is advisory, and a type you cannot fetch is not a reason to refuse a write.
 */
export async function resolveSchemaRef(client: SchemaFetchClient, ref: string): Promise<ResolvedSchemaRef> {
  const cls = classifyRef(ref)
  if (cls.kind === 'none') return {kind: 'none'}
  if (cls.kind === 'hm-bundled') return {kind: cls.kind, schema: ONYX_SCHEMAS[cls.name], cid: schemaCid(cls.name)}
  if (cls.kind === 'cid') {
    const schema = await fetchSchemaBlob(client, cls.cid).catch(() => undefined)
    return {kind: cls.kind, schema, cid: schema ? cls.cid : undefined}
  }
  const id = unpackHmId(cls.url)
  if (!id) return {kind: 'none'}
  const resource = await client.request('Resource', id).catch(() => undefined)
  const cid = resource?.type === 'document' ? schemaDefinitionCid(resource.document.metadata) : null
  if (!cid) return {kind: cls.kind, documentUrl: cls.url}
  const schema = await fetchSchemaBlob(client, cid).catch(() => undefined)
  return {kind: cls.kind, schema, cid: schema ? cid : undefined, documentUrl: cls.url}
}

/** Every reference string a schema node makes (ref, type, args, and nested schemas). */
function referencesOf(schema: unknown, out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object') return out
  if (Array.isArray(schema)) {
    for (const s of schema) referencesOf(s, out)
    return out
  }
  const node = schema as Record<string, unknown>
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'ref' || key === 'type') && typeof value === 'string') out.push(value)
    else if (key === 'description' || key === 'target' || key === 'format' || key === 'value') {
      // `value` is a literal here (a property entry's `value` is walked below, as a schema).
      if (key === 'value' && value && typeof value === 'object') referencesOf(value, out)
    } else if (value && typeof value === 'object') referencesOf(value, out)
  }
  return out
}

/**
 * Fetch every reference a schema makes that the registry (and the bundled library) cannot
 * already answer, recursively, so `resolveSchema` / `validate` can follow `ref`s to types
 * published under any account. Returns the registry (mutated and returned for chaining).
 */
export async function hydrateSchemaRegistry(
  client: SchemaFetchClient,
  schema: OnyxSchema | undefined,
  registry: OnyxRegistry = {},
): Promise<OnyxRegistry> {
  const pending = [schema]
  const seen = new Set<string>()
  while (pending.length) {
    const next = pending.pop()
    if (!next) continue
    for (const ref of referencesOf(next)) {
      if (!/^(hm|ipfs):\/\//.test(ref) || seen.has(ref)) continue
      seen.add(ref)
      if (loadFrom(registry, ref)) continue
      const resolved = await resolveSchemaRef(client, ref)
      if (!resolved.schema) continue
      registry[refToName(ref)] = resolved.schema
      pending.push(resolved.schema)
    }
  }
  return registry
}

export type EffectiveSchemaRef = {
  ref: string | null
  source: 'own' | 'inherited' | 'none'
}

/**
 * The reference to a document's EFFECTIVE conformance schema: its own metadata `schema`, else
 * its parent's `childrenSchema` (one level: a folder types its direct children), else none.
 */
export async function effectiveSchemaRef(
  client: SchemaFetchClient,
  id: UnpackedHypermediaId,
  metadata: HMMetadata | Record<string, unknown> | undefined,
): Promise<EffectiveSchemaRef> {
  const own = (metadata as Record<string, unknown> | undefined)?.schema
  if (typeof own === 'string' && own) return {ref: own, source: 'own'}
  if (!id.path || id.path.length === 0) return {ref: null, source: 'none'}
  const parentPath = id.path.slice(0, -1)
  const parentId = unpackHmId(`hm://${id.uid}${parentPath.length ? '/' + parentPath.join('/') : ''}`)
  if (!parentId) return {ref: null, source: 'none'}
  const parent = await client.request('Resource', parentId).catch(() => undefined)
  const inherited =
    parent?.type === 'document' ? (parent.document.metadata as Record<string, unknown>)?.childrenSchema : null
  return typeof inherited === 'string' && inherited
    ? {ref: inherited, source: 'inherited'}
    : {ref: null, source: 'none'}
}

/** The canonical `hm://` URL of a document id, for messages. */
export const documentUrlOf = (id: UnpackedHypermediaId): string => packHmId(id)

/** True when a value is (or is spelled as) a literal that a form has nothing to edit for. */
export const isFixedLiteral = (schema: OnyxSchema | undefined): boolean =>
  schema !== undefined && isLiteralSchema(schema)
