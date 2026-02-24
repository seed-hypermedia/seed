/**
 * Blob types and signing infrastructure for the Seed Hypermedia protocol.
 * Port of the Go blob and core packages, supporting Profile and Capability blob types.
 *
 * Provides two signing implementations:
 * - NobleKeyPair: uses @noble/curves/ed25519 directly. For vault keys where raw seed storage is needed.
 * - WebCryptoKeyPair: uses crypto.subtle with unexportable keys. For browser session keys.
 */

import {ed25519} from '@noble/curves/ed25519.js'
import {sha256 as sha256hash} from '@noble/hashes/sha2.js'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import {sha256 as sha256hasher} from 'multiformats/hashes/sha2'
import * as cbor from './cbor'

// Ed25519 multicodec (0xed) varint prefix. No existing JS library exports this constant.
export const ED25519_VARINT_PREFIX = new Uint8Array([0xed, 0x01])
export const ED25519_SIGNATURE_SIZE = 64
export const ED25519_PUBLIC_KEY_SIZE = 32
export const ED25519_PRINCIPAL_SIZE = ED25519_VARINT_PREFIX.length + ED25519_PUBLIC_KEY_SIZE

/** Packed binary public key: `<multicodec-varint><raw-key-bytes>`. */
export type Principal = Uint8Array

/** Cryptographic signature bytes. */
export type Signature = Uint8Array

/** Unix timestamp in milliseconds. */
export type Timestamp = number

/** Role values for capability blobs. */
export type Role = 'WRITER' | 'AGENT'

// ---- Signer / Verifier interfaces (mirrors Go core.Signer / core.Verifier) ----

/** Signs data and produces a cryptographic signature. */
export interface Signer {
  readonly principal: Principal
  sign(data: Uint8Array): Promise<Signature>
}

/** Verifies a signature against data. */
export interface Verifier {
  verify(data: Uint8Array, sig: Signature): Promise<boolean>
}

// ---- Implementations ----

/**
 * Ed25519 key pair using @noble/curves. Stores the raw 32-byte private key seed,
 * suitable for vault keys that need to persist the seed in encrypted storage.
 */
export class NobleKeyPair implements Signer {
  readonly principal: Principal
  readonly publicKey: Uint8Array
  /** Raw 32-byte Ed25519 private key seed. Needed for vault storage. */
  readonly seed: Uint8Array

  constructor(seed: Uint8Array) {
    this.seed = new Uint8Array(seed)
    this.publicKey = new Uint8Array(ed25519.getPublicKey(this.seed))
    this.principal = principalFromEd25519(this.publicKey)
  }

  async sign(data: Uint8Array): Promise<Signature> {
    return new Uint8Array(ed25519.sign(data, this.seed))
  }
}

/** Generate a random Ed25519 key pair with an accessible raw seed. */
export function generateNobleKeyPair(): NobleKeyPair {
  return new NobleKeyPair(crypto.getRandomValues(new Uint8Array(32)))
}

/** Restore a NobleKeyPair from a stored 32-byte seed. */
export function nobleKeyPairFromSeed(seed: Uint8Array): NobleKeyPair {
  return new NobleKeyPair(seed)
}

/**
 * Ed25519 key pair using Web Crypto. The private key is **non-exportable**,
 * suitable for browser session keys that must not leave the browser's crypto subsystem.
 */
export class WebCryptoKeyPair implements Signer {
  readonly principal: Principal
  readonly publicKey: Uint8Array
  /** The Web Crypto key pair. Exposed for LocalWebIdentity compatibility. */
  readonly keyPair: CryptoKeyPair

  constructor(keyPair: CryptoKeyPair, publicKeyRaw: Uint8Array) {
    this.keyPair = keyPair
    this.publicKey = new Uint8Array(publicKeyRaw)
    this.principal = principalFromEd25519(this.publicKey)
  }

  async sign(data: Uint8Array): Promise<Signature> {
    const sig = await crypto.subtle.sign('Ed25519', this.keyPair.privateKey, data as ArrayBufferView<ArrayBuffer>)
    return new Uint8Array(sig)
  }
}

/** Generate a random Ed25519 key pair with an unexportable private key. */
export async function generateWebCryptoKeyPair(): Promise<WebCryptoKeyPair> {
  const keyPair = (await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])) as CryptoKeyPair
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  return new WebCryptoKeyPair(keyPair, publicKeyRaw)
}

// ---- Verification (always uses noble — just raw bytes, no key object needed) ----

/**
 * Verify the signature of a blob against its embedded signer Principal.
 * Uses @noble/curves/ed25519 directly — works with any blob regardless of how it was signed.
 */
export function verify(blob: Blob): boolean {
  if (blob.signer[0] !== ED25519_VARINT_PREFIX[0] || blob.signer[1] !== ED25519_VARINT_PREFIX[1]) return false
  const rawPubKey = blob.signer.slice(ED25519_VARINT_PREFIX.length)
  if (rawPubKey.length !== ED25519_PUBLIC_KEY_SIZE) return false

  const sigCopy = new Uint8Array(blob.sig)
  const unsigned = {...blob, sig: new Uint8Array(ED25519_SIGNATURE_SIZE)}
  const data = new Uint8Array(cbor.encode(unsigned))

  try {
    return ed25519.verify(sigCopy, data, rawPubKey)
  } catch {
    return false
  }
}

// ---- Principal helpers ----

/** Create a Principal from a raw Ed25519 public key (32 bytes). */
export function principalFromEd25519(rawPublicKey: Uint8Array): Principal {
  const out = new Uint8Array(ED25519_VARINT_PREFIX.length + rawPublicKey.length)
  out.set(ED25519_VARINT_PREFIX)
  out.set(rawPublicKey, ED25519_VARINT_PREFIX.length)
  return out
}

/** Encode a Principal to its base58btc multibase string (starts with 'z'). */
export function principalToString(p: Principal): string {
  return base58btc.encode(p)
}

/** Decode a Principal from its base58btc multibase string. */
export function principalFromString(s: string): Principal {
  let decoded: Uint8Array
  try {
    decoded = base58btc.decode(s)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid principal encoding: ${message}`)
  }
  if (decoded.length !== ED25519_PRINCIPAL_SIZE) {
    throw new Error(`Invalid principal length: expected ${ED25519_PRINCIPAL_SIZE} bytes, got ${decoded.length}`)
  }
  if (decoded[0] !== ED25519_VARINT_PREFIX[0] || decoded[1] !== ED25519_VARINT_PREFIX[1]) {
    throw new Error('Invalid principal multicodec: expected Ed25519 (0xed01)')
  }
  return decoded
}

/** Check if two Principals are equal. */
export function principalEqual(a: Principal, b: Principal): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// ---- Blob types ----

/** Open-ended base blob shape. Any blob type can be signed and verified through this interface. */
export interface Blob {
  readonly type: string
  readonly signer: Principal
  readonly sig: Signature
  readonly ts: Timestamp
  readonly [key: string]: unknown
}

/** Profile blob representing user identity information. */
export interface Profile extends Blob {
  readonly type: 'Profile'
  /** Points to another key acting as an identity redirect. */
  readonly alias?: Principal
  /** Display name for the profile. */
  readonly name?: string
  /** Icon/avatar URI (wire key is "avatar" for legacy compatibility with Go). */
  readonly avatar?: string
  /** Short text description. */
  readonly description?: string
  /** Account principal when signed by an agent key on behalf of the account. */
  readonly account?: Principal
}

/** Create a signed and encoded Profile blob. */
export async function createProfile(
  signer: Signer,
  opts: {
    /** Display name (required for non-alias profiles). */
    name: string
    /** Icon/avatar URI. */
    avatar?: string
    /** Short text description. */
    description?: string
    /** Account principal. Omitted from encoding if it equals the signer. */
    account?: Principal
  },
  ts: Timestamp,
): Promise<EncodedBlob<Profile>> {
  opts = {...opts} // Copying opts to avoid mutating the original object.

  if (opts.account && principalEqual(opts.account, signer.principal)) {
    delete opts.account
  }

  if (opts.avatar === undefined) {
    delete opts.avatar
  }

  if (opts.description === undefined) {
    delete opts.description
  }

  const blob: Profile = {
    type: 'Profile',
    signer: signer.principal,
    sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
    ts,
    ...opts,
  }

  return encode(await sign(signer, blob))
}

/** Create a signed and encoded alias Profile blob (identity redirect). */
export async function createProfileAlias(
  signer: Signer,
  alias: Principal,
  ts: Timestamp,
): Promise<EncodedBlob<Profile>> {
  const blob: Profile = {
    type: 'Profile',
    signer: signer.principal,
    sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
    ts,
    alias,
  }

  return encode(await sign(signer, blob))
}

/** Capability blob granting rights from issuer to delegate. */
export interface Capability extends Blob {
  readonly type: 'Capability'
  /** Public key receiving the delegation. */
  readonly delegate: Principal
  /** For direct authentication against another principal. */
  readonly audience?: Principal
  /** Path scope for the capability. */
  readonly path?: string
  /** Access role being granted. */
  readonly role: Role
  /** Human-readable label. */
  readonly label?: string
}

/** Create a signed and encoded Capability blob. */
export async function createCapability(
  issuer: Signer,
  delegate: Principal,
  role: Role,
  ts: Timestamp,
  opts: {
    /** Path scope. */
    path?: string
    /** Human-readable label. */
    label?: string
    /** Audience principal for direct auth. */
    audience?: Principal
  } = {},
): Promise<EncodedBlob<Capability>> {
  const blob: Capability = {
    type: 'Capability',
    signer: issuer.principal,
    sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
    ts,
    delegate,
    role,
    ...opts,
  }

  return encode(await sign(issuer, blob))
}

/** A decoded blob stored alongside its content-addressed CID. */
export interface StoredBlob<T extends Blob> {
  readonly cid: CID
  readonly decoded: T
}

/** A blob with its DAG-CBOR encoding in addition to cid and decoded data. */
export interface EncodedBlob<T extends Blob> extends StoredBlob<T> {
  readonly data: Uint8Array
}

/**
 * Sign a blob with a Signer.
 * Fills sig with zeros, CBOR-encodes, signs, replaces sig.
 */
export async function sign<T extends Blob>(signer: Signer, blob: T): Promise<T> {
  const unsigned = {...blob, sig: new Uint8Array(ED25519_SIGNATURE_SIZE)}
  const data = new Uint8Array(cbor.encode(unsigned))
  const sig = await signer.sign(data)
  return {...unsigned, sig}
}

/** Encode a signed blob to DAG-CBOR and compute its content-addressed CID. */
export function encode<T extends Blob>(blob: T): EncodedBlob<T> {
  const data = new Uint8Array(cbor.encode(blob))
  const hash = sha256hash(data)
  const digest = Digest.create(sha256hasher.code, hash)
  const cid = CID.createV1(cbor.code, digest)
  return {cid, data, decoded: blob}
}

/**
 * Decode raw CBOR bytes into a blob, verifying the CID matches.
 * Throws if the recomputed CID doesn't match the expected one.
 */
export function decodeBlob<T extends Blob>(data: Uint8Array, expectedCid: CID): EncodedBlob<T> {
  const decoded = cbor.decode<T>(data)
  const reencoded = encode(decoded)
  if (reencoded.cid.toString() !== expectedCid.toString()) {
    throw new Error(`CID mismatch: expected ${expectedCid}, got ${reencoded.cid}`)
  }
  return {cid: expectedCid, data, decoded}
}

// ---- Legacy aliases for backward compatibility ----

/**
 * @deprecated Use `NobleKeyPair` or `WebCryptoKeyPair` directly.
 * Kept temporarily for consumers that haven't migrated yet.
 */
export type KeyPair = Signer & {
  readonly publicKey: Uint8Array
  readonly keyPair?: CryptoKeyPair
}

/**
 * @deprecated Use `generateNobleKeyPair()` instead.
 */
export async function generateKeyPair(): Promise<NobleKeyPair> {
  return generateNobleKeyPair()
}

/**
 * @deprecated Use `nobleKeyPairFromSeed()` instead.
 */
export async function keyPairFromPrivateKey(rawPrivateKey: Uint8Array): Promise<NobleKeyPair> {
  return nobleKeyPairFromSeed(rawPrivateKey)
}
