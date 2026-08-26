// Signed blobs: any schema that extends the Hypermedia signed-blob envelope
// (`hypermedia-blob`: type, signer, sig, ts) — Change, Comment, Capability, …
// AND user-defined types. This module recognizes them, strips the envelope for
// the editor (the user never types a signature), and signs + publishes:
//   1. value (dag-json) → IPLD; set signer = the account's principal bytes,
//      ts = unix ms, sig = 64 zero bytes (the Ed25519 placeholder);
//   2. sign the canonical DAG-CBOR of that; set sig;
//   3. encode, hash (sha2-256, dag-cbor CIDv1), PublishBlobs.
// The daemon verifies the same way: decode, zero sig, re-encode, verify.
import type {HMSigner} from '@seed-hypermedia/client/hm-types'
import * as cbor from '@shm/shared/cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {dagJsonToIpld, findSeedIndexerCollision} from '../dag-json'
import {resolveSchema, type OnyxRegistry, type OnyxSchema} from './onyx-engine'

/** The envelope fields every signed blob carries; filled by the signer, never typed. */
export const SIGNED_BLOB_ENVELOPE = ['signer', 'sig', 'ts'] as const

/** True when the (resolved) schema is a signed blob: it declares signer, sig, and ts. */
export function isSignedBlobSchema(schema: OnyxSchema | undefined, reg: OnyxRegistry = {}): boolean {
  if (!schema) return false
  const {schema: resolved} = resolveSchema(schema, {}, reg)
  const props = resolved?.properties
  return !!props && SIGNED_BLOB_ENVELOPE.every((k) => k in props)
}

/** The single `type` tag a signed-blob schema pins (a one-value enum), if any. */
export function signedBlobTypeTag(schema: OnyxSchema, reg: OnyxRegistry = {}): string | undefined {
  const {schema: resolved} = resolveSchema(schema, {}, reg)
  const t = resolved?.properties?.type
  const tag = t && Array.isArray(t.enum) && t.enum.length === 1 ? t.enum[0] : undefined
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
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(resolved.properties ?? {})) if (!hidden.has(k)) properties[k] = v
  const required = (resolved.required ?? []).filter((k: string) => !hidden.has(k))
  const out: OnyxSchema = {...resolved, properties}
  if (required.length) out.required = required
  else delete out.required
  return out
}

export type SignedBlobResult = {cid: string; data: Uint8Array; ts: number; signer: Uint8Array}

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
  blob.sig = new Uint8Array(64)
  blob.sig = new Uint8Array(await signer.sign(new Uint8Array(cbor.encode(blob))))
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
