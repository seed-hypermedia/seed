/**
 * Vault data model and CBOR+compression serialization.
 * Defines the structured format for storing Hypermedia identity accounts.
 */

import type {Principal} from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {CID} from 'multiformats/cid'

/** Current vault schema version. Bump on every incompatible schema change. */
export const VAULT_VERSION = 2

/**
 * Minimal capability metadata stored per delegation.
 * The raw CBOR blob bytes live in the external blockstore, keyed by cid.
 */
export interface CapabilityMeta {
  /** CID (content address) of the capability blob in the blockstore. */
  cid: CID
  /** Delegate principal (packed Ed25519 public key) that received the rights. */
  delegate: Principal
}

/** A single Hypermedia account stored in the vault. */
export interface Account {
  /** The 32-byte Ed25519 seed to reconstruct the key pair. */
  seed: Uint8Array
  /** Account creation timestamp. */
  createTime: number
  /** Allowed cross-device web application sessions. */
  delegations: DelegatedSession[]
}

/** Record of a delegation issued to a third-party site's session key. */
export interface DelegatedSession {
  /** The origin (client_id) the delegation was issued to, e.g. "https://example.com". */
  clientId: string
  /** Type of device that requested the session. */
  deviceType?: 'desktop' | 'mobile' | 'tablet'
  /** Minimal capability metadata (full blob bytes are stored externally). */
  capability: CapabilityMeta
  /** Unix timestamp ms when the delegation was created. */
  createTime: number
}

/** Top-level vault data structure. */
export interface State {
  /** Schema version for future migrations. */
  version: 2
  /** List of Hypermedia accounts. */
  accounts: Account[]
}

/** Create an empty vault. */
export function createEmpty(): State {
  return {version: VAULT_VERSION, accounts: []}
}

/** Serialize vault data: CBOR encode → gzip compress. Returns compressed bytes. */
export async function serialize(data: State): Promise<Uint8Array> {
  const encodedCb = cbor.encode(data)
  return compress(new Uint8Array(encodedCb))
}

/** Deserialize vault data: gzip decompress → CBOR decode. Throws if version mismatches. */
export async function deserialize(compressed: Uint8Array): Promise<State> {
  const decodedCb = await decompress(compressed)
  const decoded = cbor.decode(decodedCb) as Record<string, unknown>

  if (decoded.version !== VAULT_VERSION) {
    throw new Error(
      `Vault schema version mismatch: stored version is ${decoded.version}, but this client expects version ${VAULT_VERSION}. ` +
        'The vault data is incompatible with this version of the application.',
    )
  }

  // Because this data is written internally by the application, we assume
  // it conforms to the schema if the version matches.
  return decoded as unknown as State
}

/** Compress data using gzip. */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data as any)
  writer.close()
  return collectStream(cs.readable)
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as any)
  writer.close()
  return collectStream(ds.readable)
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
