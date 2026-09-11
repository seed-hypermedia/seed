// Signed blobs: any schema that extends the Hypermedia signed-blob envelope
// (`hypermedia-blob`: type, signer, sig, ts) — Change, Comment, Capability, …
// AND user-defined types. This module recognizes them, strips the envelope for
// an editor (the user never types a signature), and signs + publishes:
//   1. value (dag-json) → IPLD; set signer = the account's principal bytes,
//      ts = unix ms, sig = 64 zero bytes (the Ed25519 placeholder);
//   2. sign the canonical DAG-CBOR of that; set sig;
//   3. encode, hash (sha2-256, dag-cbor CIDv1), PublishBlobs.
// The daemon verifies the same way: decode, zero sig, re-encode, verify.
import {ed25519} from '@noble/curves/ed25519.js'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import * as cbor from './cbor'
import {dagJsonToIpld, findSeedIndexerCollision} from './dag-json'
import type {HMSigner} from './hm-types'
import {
  type OnyxRegistry,
  type OnyxSchema,
  fieldSchema,
  fieldsToProperties,
  isLiteralSchema,
  literalValue,
  resolveSchema,
  structFields,
} from './onyx-engine'

/** The envelope fields every signed blob carries; filled by the signer, never typed. */
export const SIGNED_BLOB_ENVELOPE = ['signer', 'sig', 'ts'] as const

/** The Ed25519 signature placeholder: what `sig` holds while the blob is being signed. */
export const ZERO_SIGNATURE_LENGTH = 64

/** True when the (resolved) schema is a signed blob: it declares signer, sig, and ts. */
export function isSignedBlobSchema(schema: OnyxSchema | undefined, reg: OnyxRegistry = {}): boolean {
  if (!schema) return false
  const {schema: resolved} = resolveSchema(schema, {}, reg)
  const props = resolved.properties
  return !!props && SIGNED_BLOB_ENVELOPE.every((k) => fieldSchema(resolved, k) !== undefined)
}

/** The single `type` tag a signed-blob schema pins (a literal), if any. */
export function signedBlobTypeTag(schema: OnyxSchema, reg: OnyxRegistry = {}): string | undefined {
  const {schema: resolved} = resolveSchema(schema, {}, reg)
  const t = fieldSchema(resolved, 'type')
  const tag = t !== undefined && isLiteralSchema(t) ? literalValue(t) : undefined
  return typeof tag === 'string' ? tag : undefined
}

/**
 * The schema with the envelope removed (and the `type` tag, when pinned) — what
 * the person actually fills in. Returns a resolved, self-contained map schema.
 */
export function stripSignedBlobEnvelope(schema: OnyxSchema, reg: OnyxRegistry = {}): OnyxSchema {
  const {schema: resolved} = resolveSchema(schema, {}, reg)
  const hidden = new Set<string>(SIGNED_BLOB_ENVELOPE)
  if (signedBlobTypeTag(schema, reg)) hidden.add('type')
  const {required: _legacy, ...rest} = resolved
  return {...rest, properties: fieldsToProperties(structFields(resolved).filter((f) => !hidden.has(f.name)))}
}

export type SignedBlobResult = {cid: string; data: Uint8Array; ts: number; signer: Uint8Array}

/** The canonical bytes a signed blob's signature covers: the blob with `sig` zeroed. */
export function signedBlobMessage(blob: Record<string, unknown>): Uint8Array {
  return new Uint8Array(cbor.encode({...blob, sig: new Uint8Array(ZERO_SIGNATURE_LENGTH)}))
}

/**
 * Sign a blob body with the account's signer and return the encoded blob.
 * `body` is the user-authored part (dag-json form); the envelope is added here.
 */
export async function signBlob(
  signer: HMSigner,
  body: Record<string, unknown>,
  opts: {typeTag?: string; ts?: number} = {},
): Promise<SignedBlobResult> {
  const ipld = dagJsonToIpld(body) as Record<string, unknown>
  const principal = new Uint8Array(await signer.getPublicKey())
  const ts = opts.ts ?? Date.now()
  const blob: Record<string, unknown> = {...ipld}
  if (opts.typeTag) blob.type = opts.typeTag
  blob.signer = principal
  blob.ts = ts
  blob.sig = new Uint8Array(await signer.sign(signedBlobMessage(blob)))
  const data = new Uint8Array(cbor.encode(blob))
  const digest = await sha256.digest(data)
  return {cid: CID.createV1(cbor.code, digest).toString(), data, ts, signer: principal}
}

/** Sign and publish. Refuses a `type` that collides with a built-in Seed blob type it doesn't match. */
export async function publishSignedBlob(
  client: {request: (key: 'PublishBlobs', input: {blobs: {cid: string; data: Uint8Array}[]}) => Promise<unknown>},
  signer: HMSigner,
  body: Record<string, unknown>,
  opts: {typeTag?: string; ts?: number} = {},
): Promise<SignedBlobResult> {
  const result = await signBlob(signer, body, opts)
  const collision = findSeedIndexerCollision(result.data)
  if (collision) {
    throw new Error(
      `This blob can't be published: its "type" collides with the built-in Seed "${collision}" blob type but does not match its shape. Use a different type tag.`,
    )
  }
  await client.request('PublishBlobs', {blobs: [{cid: result.cid, data: result.data}]})
  return result
}

// ── Verifying ────────────────────────────────────────────────────────────────

/** True when a dag-json value carries the signed-blob envelope fields. */
export function hasSignedEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    SIGNED_BLOB_ENVELOPE.every((k) => k in (value as Record<string, unknown>))
  )
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
 * Verify a signed blob given in dag-json form (as the API returns it): the signature must cover
 * the canonical DAG-CBOR of the blob with `sig` zeroed — the daemon's own rule.
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
    const ok = ed25519.verify(sig, signedBlobMessage(ipld), publicKey)
    return ok ? {ok, signer: signerId, ts} : {ok, signer: signerId, ts, reason: 'signature does not verify'}
  } catch (error) {
    return {ok: false, signer: signerId, ts, reason: (error as Error).message}
  }
}

/** Canonical DAG-CBOR bytes of a dag-json value and their CID (v1, sha2-256). */
export async function encodeDagCbor(value: unknown): Promise<{data: Uint8Array; cid: string}> {
  const data = new Uint8Array(cbor.encode(dagJsonToIpld(value)))
  const digest = await sha256.digest(data)
  return {data, cid: CID.createV1(cbor.code, digest).toString()}
}
