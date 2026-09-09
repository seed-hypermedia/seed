/**
 * Onyx for the CLI: load a schema by any reference, validate values, encode blobs, and check
 * signed-blob signatures. Thin over the client package's engine, resolver and signing rule, so
 * the CLI never disagrees with the app.
 */
import type {SeedClient} from '@seed-hypermedia/client'
import {dagJsonToIpld, ipldToDagJson} from '@seed-hypermedia/client/dag-json'
import {
  type OnyxRegistry,
  type OnyxSchema,
  ONYX_SCHEMAS,
  isLiteralSchema,
  literalValue,
  resolveSchema,
  validate,
} from '@seed-hypermedia/client/onyx-engine'
import {
  type ResolvedSchemaRef,
  bareCid,
  blobSchemaRef,
  documentMetadataSchema,
  effectiveSchemaRef,
  hydrateSchemaRegistry,
  isPlainMap,
  metadataSchemaOf,
  resolveSchemaRef,
  withoutSchemaLink,
} from '@seed-hypermedia/client/onyx-resolve'
import {
  type SignatureCheck,
  encodeDagCbor,
  hasSignedEnvelope,
  principalToPublicKey,
  verifySignedBlob,
} from '@seed-hypermedia/client/onyx-signed-blob'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {existsSync, readFileSync} from 'node:fs'
import {resolve as resolvePath} from 'node:path'

export {bareCid, blobSchemaRef, effectiveSchemaRef, isPlainMap, metadataSchemaOf, withoutSchemaLink}
export {hasSignedEnvelope, principalToPublicKey, verifySignedBlob}
export type {SignatureCheck}

/** The meta-schema: what every schema must validate against. */
export const META_SCHEMA: OnyxSchema = ONYX_SCHEMAS['hypermedia-schema']!

export type LoadedSchema = {
  schema: OnyxSchema
  /** The schema blob's CID when known — a conforming blob links to it via `schema`. */
  cid?: string
  /** A registry holding every type the schema references, fetched, so validation can follow refs. */
  registry: OnyxRegistry
  /** Where the schema came from, for messages. */
  source: string
}

/** Parse a dag-json file (a schema or a value). */
export function readJsonFile(file: string): unknown {
  const path = resolvePath(file)
  if (!existsSync(path)) throw new Error(`File not found: ${file}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
}

/** Canonical DAG-CBOR bytes of a dag-json value and their CID (v1, sha2-256). */
export const encodeBlob = encodeDagCbor

/**
 * A schema by reference: a `.json` file on disk (dag-json), an `ipfs://<cid>`, a bundled library
 * name or URL (`hypermedia-document`, `hm://<onyx>/hypermedia-document`), or a type document's
 * `hm://` URL, whose `schemaDefinition` is followed. Every type it references is fetched into the
 * returned registry.
 */
export async function loadSchema(client: SeedClient, ref: string): Promise<LoadedSchema> {
  let schema: OnyxSchema
  let cid: string | undefined
  let source = ref
  if (/\.json$/i.test(ref) && existsSync(resolvePath(ref))) {
    const parsed = readJsonFile(ref)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${ref} does not hold a schema`)
    schema = parsed as OnyxSchema
    cid = (await encodeBlob(schema)).cid
    source = `file ${ref}`
  } else if (ONYX_SCHEMAS[ref]) {
    schema = ONYX_SCHEMAS[ref]!
    source = `library ${ref}`
  } else {
    const resolved: ResolvedSchemaRef = await resolveSchemaRef(client, ref)
    if (resolved.kind === 'none')
      throw new Error(`Not a schema reference: ${ref} (expected a file, an ipfs:// CID, or an hm:// URL)`)
    if (!resolved.schema) {
      if (resolved.kind === 'hm-doc')
        throw new Error(
          `${ref} does not define a schema (no schemaDefinition on the document, or the document was not found)`,
        )
      throw new Error(`Could not fetch the schema at ${ref}`)
    }
    schema = resolved.schema
    cid = resolved.cid
  }
  const registry = await hydrateSchemaRegistry(client, schema, {})
  return {schema, cid, registry, source}
}

/** The violations of `value` against `schema`; empty when it conforms. */
export function violations(schema: OnyxSchema, value: unknown, registry: OnyxRegistry = {}): string[] {
  return validate(schema, value, '$', {}, registry)
}

/**
 * The violations of a document's metadata against its type — checked as the app does: the base
 * document metadata extended by the type's fields, open to extra keys, so the binding keys
 * (`schema`, `childrenSchema`, `schemaDefinition`) and standard fields never count as strays.
 */
export function metadataViolations(schema: OnyxSchema, metadata: unknown, registry: OnyxRegistry = {}): string[] {
  return validate(documentMetadataSchema(metadataSchemaOf(schema, registry), {}, registry), metadata, '$', {}, registry)
}

/** A decoded blob (as the API returns it, dag-json) fetched by CID. */
export async function fetchBlobValue(client: SeedClient, cid: string): Promise<unknown> {
  const result = await client.request('GetCID', {cid})
  return (result as {value?: unknown} | undefined)?.value
}

/** The effective conformance schema of a document, loaded and hydrated; null when it has none. */
export async function loadEffectiveSchema(
  client: SeedClient,
  id: UnpackedHypermediaId,
  metadata: Record<string, unknown> | undefined,
): Promise<(LoadedSchema & {ref: string; via: 'own' | 'inherited'}) | null> {
  const effective = await effectiveSchemaRef(client, id, metadata)
  if (!effective.ref || effective.source === 'none') return null
  const loaded = await loadSchema(client, effective.ref)
  return {...loaded, ref: effective.ref, via: effective.source}
}

/** Human names for the schema's fields, for messages: `name (string, required)`. */
export function describeType(schema: OnyxSchema, registry: OnyxRegistry): string {
  const {schema: resolved} = resolveSchema(schema, {}, registry)
  if (isLiteralSchema(resolved)) return `literal ${JSON.stringify(literalValue(resolved))}`
  if (Array.isArray(resolved.anyOf)) return `union of ${resolved.anyOf.length}`
  if (resolved.properties) return `struct with ${Object.keys(resolved.properties).length} fields`
  return typeof resolved.type === 'string' ? resolved.type.split('/').pop() ?? 'schema' : 'schema'
}

export {dagJsonToIpld, ipldToDagJson}
