/**
 * Blob types and signing infrastructure for the Seed Hypermedia protocol.
 * Port of the Go blob and core packages, supporting Profile and Capability blob types.
 */

import * as dagCBOR from "@ipld/dag-cbor"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 as sha256hash } from "@noble/hashes/sha2.js"
import { base58btc } from "multiformats/bases/base58"
import { CID } from "multiformats/cid"
import * as Digest from "multiformats/hashes/digest"
import { sha256 as sha256hasher } from "multiformats/hashes/sha2"

// Ed25519 multicodec (0xed) varint prefix. No existing JS library exports this constant.
const ED25519_VARINT_PREFIX = new Uint8Array([0xed, 0x01])
const ED25519_SIGNATURE_SIZE = 64
const ED25519_PUBLIC_KEY_SIZE = 32

/** Packed binary public key: `<multicodec-varint><raw-key-bytes>`. */
export type Principal = Uint8Array

/** Cryptographic signature bytes. */
export type Signature = Uint8Array

/** Unix timestamp in milliseconds. */
export type Timestamp = number

/** Role values for capability blobs. */
export type Role = "WRITER" | "AGENT"

/** Ed25519 key pair for signing blobs. */
export interface KeyPair {
	/** Raw 32-byte Ed25519 private key. */
	readonly privateKey: Uint8Array
	/** Raw 32-byte Ed25519 public key. */
	readonly publicKey: Uint8Array
	/** Multicodec-prefixed principal (34 bytes). */
	readonly principal: Principal
}

/** Generate a random Ed25519 key pair. */
export function generateKeyPair(): KeyPair {
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	const publicKey = ed25519.getPublicKey(privateKey)
	return { privateKey, publicKey, principal: principalFromEd25519(publicKey) }
}

/** Create a KeyPair from an existing Ed25519 private key (32 bytes). */
export function keyPairFromPrivateKey(rawPrivateKey: Uint8Array): KeyPair {
	const publicKey = ed25519.getPublicKey(rawPrivateKey)
	return { privateKey: rawPrivateKey, publicKey, principal: principalFromEd25519(publicKey) }
}

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
	return base58btc.decode(s)
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
	readonly type: "Profile"
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

/** Capability blob granting rights from issuer to delegate. */
export interface Capability extends Blob {
	readonly type: "Capability"
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

/** A blob with its DAG-CBOR encoding and content-addressed CID. */
export interface EncodedBlob<T extends Blob> {
	readonly cid: CID
	readonly data: Uint8Array
	readonly decoded: T
}

/**
 * Sign a blob with an Ed25519 key pair.
 * Mirrors the Go Sign function: fills sig with zeros, CBOR-encodes, signs, replaces sig.
 */
export function sign<T extends Blob>(kp: KeyPair, blob: T): T {
	const unsigned = { ...blob, sig: new Uint8Array(ED25519_SIGNATURE_SIZE) }
	const data = dagCBOR.encode(unsigned)
	const sig = ed25519.sign(data, kp.privateKey)
	return { ...unsigned, sig }
}

/**
 * Verify the signature of a blob against its embedded signer Principal.
 * Returns true if the signature is valid.
 */
export function verify(blob: Blob): boolean {
	if (blob.signer[0] !== ED25519_VARINT_PREFIX[0] || blob.signer[1] !== ED25519_VARINT_PREFIX[1]) return false
	const rawPubKey = blob.signer.slice(ED25519_VARINT_PREFIX.length)
	if (rawPubKey.length !== ED25519_PUBLIC_KEY_SIZE) return false

	const sigCopy = new Uint8Array(blob.sig)
	const unsigned = { ...blob, sig: new Uint8Array(ED25519_SIGNATURE_SIZE) }
	const data = dagCBOR.encode(unsigned)

	try {
		return ed25519.verify(sigCopy, data, rawPubKey)
	} catch {
		return false
	}
}

/** Encode a signed blob to DAG-CBOR and compute its content-addressed CID. */
export function encode<T extends Blob>(blob: T): EncodedBlob<T> {
	const data = dagCBOR.encode(blob)
	const hash = sha256hash(data)
	const digest = Digest.create(sha256hasher.code, hash)
	const cid = CID.createV1(dagCBOR.code, digest)
	return { cid, data: new Uint8Array(data), decoded: blob }
}

// ---- Factory functions ----

/** Options for creating a profile blob. */
export interface ProfileOptions {
	/** Display name (required for non-alias profiles). */
	name: string
	/** Icon/avatar URI. */
	avatar?: string
	/** Short text description. */
	description?: string
	/** Account principal. Omitted from encoding if it equals the signer. */
	account?: Principal
}

/** Create a signed and encoded Profile blob. */
export function createProfile(kp: KeyPair, opts: ProfileOptions, ts: Timestamp): EncodedBlob<Profile> {
	// Omit account when it equals the signer (matches Go behavior).
	const account = opts.account && !principalEqual(kp.principal, opts.account) ? opts.account : undefined

	// Build blob without undefined values (DAG-CBOR does not support undefined).
	const blob: Profile = {
		type: "Profile",
		signer: kp.principal,
		sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
		ts,
		...(opts.name != null ? { name: opts.name } : {}),
		...(opts.avatar != null ? { avatar: opts.avatar } : {}),
		...(opts.description != null ? { description: opts.description } : {}),
		...(account != null ? { account } : {}),
	}

	return encode(sign(kp, blob))
}

/** Create a signed and encoded alias Profile blob (identity redirect). */
export function createProfileAlias(kp: KeyPair, alias: Principal, ts: Timestamp): EncodedBlob<Profile> {
	const blob: Profile = {
		type: "Profile",
		signer: kp.principal,
		sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
		ts,
		alias,
	}

	return encode(sign(kp, blob))
}

/** Options for creating a capability blob. */
export interface CapabilityOptions {
	/** Path scope. */
	path?: string
	/** Human-readable label. */
	label?: string
	/** Audience principal for direct auth. */
	audience?: Principal
}

/** Create a signed and encoded Capability blob. */
export function createCapability(
	issuer: KeyPair,
	delegate: Principal,
	role: Role,
	ts: Timestamp,
	opts: CapabilityOptions = {},
): EncodedBlob<Capability> {
	const blob: Capability = {
		type: "Capability",
		signer: issuer.principal,
		sig: new Uint8Array(ED25519_SIGNATURE_SIZE),
		ts,
		delegate,
		role,
		...opts,
	}

	return encode(sign(issuer, blob))
}
