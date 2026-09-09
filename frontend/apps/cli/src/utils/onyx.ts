/**
 * Onyx for the CLI: load a schema by any reference, validate values, encode blobs, and check
 * signed-blob signatures. Thin over the client package's engine, resolver and signing rule, so
 * the CLI never disagrees with the app.
 */
import * as ed25519 from '@noble/ed25519'
import type {SeedClient} from '@seed-hypermedia/client'
import * as cbor from '@seed-hypermedia/client/cbor'
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
  effectiveSchemaRef,
  hydrateSchemaRegistry,
  metadataSchemaOf,
  resolveSchemaRef,
} from '@seed-hypermedia/client/onyx-resolve'
import {SIGNED_BLOB_ENVELOPE, signedBlobMessage} from '@seed-hypermedia/client/onyx-signed-blob'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {existsSync, readFileSync} from 'node:fs'
import {resolve as resolvePath} from 'node:path'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'

export {bareCid, effectiveSchemaRef, metadataSchemaOf}

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
export async function encodeBlob(value: unknown): Promise<{data: Uint8Array; cid: string}> {
  const data = new Uint8Array(cbor.encode(dagJsonToIpld(value)))
  const digest = await sha256.digest(data)
  return {data, cid: CID.createV1(cbor.code, digest).toString()}
}

/**
 * A schema by reference: a `.json` file on disk (dag-json), an `ipfs://<cid>`, a bundled library
 * name or URL (`hypermedia-document`, `hm://<onyx>/hypermedia-document`), or a type document's
 * `hm://` URL, whose `schemaDefinition` is followed. Every type it references is fetched into the
 * returned registry.
 */
export async function loadSchema(client: SeedClient, ref: string): Promise<LoadedSchema> {
  let schema: OnyxSchema | undefined
  let cid: string | undefined
  let source = ref
  if (/\.json$/i.test(ref) && existsSync(resolvePath(ref))) {
    const parsed = readJsonFile(ref)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${ref} does not hold a schema`)
    schema = parsed as OnyxSchema
    cid = (await encodeBlob(schema)).cid
    source = `file ${ref}`
  } else if (ONYX_SCHEMAS[ref]) {
    schema = ONYX_SCHEMAS[ref]
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

/** The `schema` link a blob carries (`{"/": <cid>}` or a URL string), if any. */
export function blobSchemaRef(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const link = (value as Record<string, unknown>).schema
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

/** Whether a dag-json value is a plain map (the only shape that can carry a schema link). */
export const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !('/' in (value as object))

/** True when a value carries the signed-blob envelope fields. */
export function hasSignedEnvelope(value: unknown): value is Record<string, unknown> {
  return isPlainMap(value) && SIGNED_BLOB_ENVELOPE.every((k) => k in value)
}

/** The Ed25519 public key inside a principal (multicodec 0xed 0x01 + 32 bytes). */
export function principalToPublicKey(principal: Uint8Array): Uint8Array {
  if (principal.length !== 34 || principal[0] !== 0xed || principal[1] !== 0x01) {
    throw new Error(
      `Unsupported principal: expected an Ed25519 multicodec key (34 bytes), got ${principal.length} bytes`,
    )
  }
  return principal.slice(2)
}

export type SignatureCheck = {ok: boolean; signer: string; ts?: number; reason?: string}

/**
 * Verify a signed blob given in dag-json form: the signature must cover the canonical DAG-CBOR of
 * the blob with `sig` zeroed — the daemon's own rule.
 */
export async function verifySignedBlob(value: Record<string, unknown>): Promise<SignatureCheck> {
  const ipld = dagJsonToIpld(value) as Record<string, unknown>
  const signer = ipld.signer
  const sig = ipld.sig
  if (!(signer instanceof Uint8Array)) return {ok: false, signer: '', reason: 'signer is not bytes'}
  const signerId = base58btc.encode(signer)
  if (!(sig instanceof Uint8Array)) return {ok: false, signer: signerId, reason: 'sig is not bytes'}
  let publicKey: Uint8Array
  try {
    publicKey = principalToPublicKey(signer)
  } catch (error) {
    return {ok: false, signer: signerId, reason: (error as Error).message}
  }
  const ts = typeof ipld.ts === 'number' ? ipld.ts : undefined
  try {
    const ok = await ed25519.verifyAsync(sig, signedBlobMessage(ipld), publicKey)
    return ok ? {ok, signer: signerId, ts} : {ok, signer: signerId, ts, reason: 'signature does not verify'}
  } catch (error) {
    return {ok: false, signer: signerId, ts, reason: (error as Error).message}
  }
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
