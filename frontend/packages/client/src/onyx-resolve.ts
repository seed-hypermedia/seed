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
  STRUCT_URL,
  type StructField,
  structFields,
  fieldsToProperties,
  validate,
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

/**
 * The decoded blob at a CID, when it is a DAG-CBOR map (dag-json form, as the API returns it).
 * A schema blob published with a `schema` link of its own (to the meta-schema, typically) is a
 * conforming object like any other: the link is set aside, it is not part of the schema.
 */
export async function fetchSchemaBlob(client: SchemaFetchClient, cid: string): Promise<OnyxSchema | undefined> {
  const bundled = schemaForCid(cid)
  if (bundled) return bundled
  const result = await client.request('GetCID', {cid})
  const value = withoutSchemaLink((result as {value?: unknown} | undefined)?.value)
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as OnyxSchema) : undefined
}

/**
 * The schema a document's metadata is checked against: the base document metadata
 * (`hypermedia-metadata` — name, summary, icon, the schema-binding keys, …) extended by the
 * type's metadata fields, kept OPEN (`values: {}`) so the binding keys and arbitrary extras are
 * allowed. Standard fields keep their semantic types; the type's required fields stay required.
 * The one rule every surface shares: the app's Attributes editor, the CLI's `document validate`
 * and `space import --check`, and an agent's reads and writes. `extraProps` folds in any
 * schema-keyed (`ipfs://<cid>`) fields.
 */
export function documentMetadataSchema(
  typeMetadataSchema: OnyxSchema | undefined,
  extraProps: Record<string, OnyxSchema> = {},
  registry: OnyxRegistry = {},
): OnyxSchema {
  const base = resolveSchema(ONYX_SCHEMAS['hypermedia-metadata']!).schema
  const doc = typeMetadataSchema ? resolveSchema(typeMetadataSchema, {}, registry).schema : {}
  const byName = new Map<string, StructField>()
  for (const f of structFields(base)) byName.set(f.name, f)
  for (const f of structFields(doc)) byName.set(f.name, f)
  for (const [name, schema] of Object.entries(extraProps)) byName.set(name, {name, schema, required: false})
  return {type: STRUCT_URL, properties: fieldsToProperties(Array.from(byName.values())), values: {}}
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

// ── Loading and checking ─────────────────────────────────────────────────────

export type LoadedSchemaRef = {
  schema: OnyxSchema
  /** The schema blob's CID when known — a conforming blob links to it via `schema`. */
  cid?: string
  /** Every type the schema references, fetched, so validation can follow refs. */
  registry: OnyxRegistry
}

/**
 * A schema by reference — a bundled library name or URL, an `ipfs://<cid>`, or a type document's
 * `hm://` URL — or given inline as an object, with every reference it makes fetched into a
 * registry. Throws with a reason when the reference cannot be resolved.
 */
export async function loadSchemaRef(client: SchemaFetchClient, ref: string | OnyxSchema): Promise<LoadedSchemaRef> {
  if (typeof ref !== 'string') {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw new Error('A schema must be a map')
    return {schema: ref, registry: await hydrateSchemaRegistry(client, ref, {})}
  }
  if (ONYX_SCHEMAS[ref]) return {schema: ONYX_SCHEMAS[ref], cid: schemaCid(ref), registry: {}}
  const resolved = await resolveSchemaRef(client, ref)
  if (resolved.kind === 'none')
    throw new Error(`Not a schema reference: ${ref} (expected an ipfs:// CID or an hm:// URL)`)
  if (!resolved.schema) {
    if (resolved.kind === 'hm-doc')
      throw new Error(
        `${ref} does not define a schema (no schemaDefinition on the document, or the document was not found)`,
      )
    throw new Error(`Could not fetch the schema at ${ref}`)
  }
  return {
    schema: resolved.schema,
    cid: resolved.cid,
    registry: await hydrateSchemaRegistry(client, resolved.schema, {}),
  }
}

export type DocumentSchemaCheck = {
  /** The reference the document's effective schema came from, or null when it has none. */
  schema: string | null
  via: 'own' | 'inherited' | 'none'
  /** The metadata fields the type requires, and those the document lacks. */
  required: string[]
  missing: string[]
  /** Violations of the metadata (or of the whole document, with `content`). */
  violations: string[]
  /** Set when the schema could not be resolved; the check is then inconclusive, not failed. */
  error?: string
}

/**
 * Check a document against its effective schema: its own `schema`, else the parent's
 * `childrenSchema`. Advisory: an unresolvable type is reported in `error`, never thrown.
 */
export async function checkDocumentSchema(
  client: SchemaFetchClient,
  id: UnpackedHypermediaId,
  metadata: Record<string, unknown> | undefined,
  content?: unknown,
): Promise<DocumentSchemaCheck> {
  const effective = await effectiveSchemaRef(client, id, metadata).catch(() => ({ref: null, source: 'none' as const}))
  if (!effective.ref || effective.source === 'none') {
    return {schema: null, via: 'none', required: [], missing: [], violations: []}
  }
  const base = {schema: effective.ref, via: effective.source}
  let loaded: LoadedSchemaRef
  try {
    loaded = await loadSchemaRef(client, effective.ref)
  } catch (error) {
    return {...base, required: [], missing: [], violations: [], error: (error as Error).message}
  }
  const metadataSchema = documentMetadataSchema(metadataSchemaOf(loaded.schema, loaded.registry), {}, loaded.registry)
  const required = structFields(metadataSchema)
    .filter((f) => f.required)
    .map((f) => f.name)
  const present = metadata ?? {}
  const missing = required.filter((name) => !(name in present))
  const violations =
    content !== undefined
      ? validate(loaded.schema, {metadata: present, content}, '$', {}, loaded.registry)
      : validate(metadataSchema, present, '$', {}, loaded.registry)
  return {...base, required, missing, violations}
}

// ── Blobs and their schema links ─────────────────────────────────────────────

/** Whether a dag-json value is a plain map (the only shape that can carry a schema link). */
export const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !('/' in (value as object))

/** The `schema` link a blob carries (`{"/": <cid>}` or a URL string), if any. */
export function blobSchemaRef(value: unknown): string | null {
  if (!isPlainMap(value)) return null
  const link = value.schema
  if (typeof link === 'string') return link
  if (link && typeof link === 'object' && typeof (link as Record<string, unknown>)['/'] === 'string') {
    return `ipfs://${(link as Record<string, string>)['/']}`
  }
  return null
}

/**
 * The value without its `schema` link. A published object links to its type through a `schema`
 * key that the type itself does not declare, so the link is set aside before validating — the
 * same rule the app's blob editor follows.
 */
export function withoutSchemaLink(value: unknown): unknown {
  if (!isPlainMap(value) || blobSchemaRef(value) === null) return value
  const {schema: _link, ...rest} = value
  return rest
}

/**
 * Whether the schema a document's `schemaDefinition` points at is a valid Onyx schema: the
 * violations of the meta-schema, or the reason the reference could not be loaded. Empty when fine.
 */
export async function checkSchemaDefinition(client: SchemaFetchClient, ref: string): Promise<string[]> {
  const meta = ONYX_SCHEMAS['hypermedia-schema']!
  try {
    const loaded = await loadSchemaRef(client, ref)
    return validate(meta, loaded.schema, '$', {}, loaded.registry)
  } catch (error) {
    return [(error as Error).message]
  }
}
