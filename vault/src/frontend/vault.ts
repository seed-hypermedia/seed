/**
 * Vault data model and CBOR+compression serialization.
 * Defines the structured format for storing Hypermedia identity accounts.
 */

import * as dagCBOR from "@ipld/dag-cbor"
import type * as blobs from "./blobs"

/** A single Hypermedia account stored in the vault. */
export interface Account {
	/** 32-byte Ed25519 private key seed. */
	seed: Uint8Array
	/** Signed profile blob. */
	profile: blobs.Profile
	/** Unix timestamp ms when account was created. */
	createdAt: number
}

/** Record of a delegation issued to a third-party site's session key. */
export interface DelegatedSession {
	/** The origin (client_id) the delegation was issued to, e.g. "https://example.com". */
	clientId: string
	/** Base58btc-encoded principal of the session key that was delegated to. */
	sessionKeyPrincipal: string
	/** Index of the account in the vault that issued the delegation. */
	accountIndex: number
	/** Unix timestamp ms when the delegation was created. */
	createdAt: number
	/** Optional human-readable label/note. */
	label?: string
}

/** Top-level vault data structure. */
export interface VaultData {
	/** Schema version for future migrations. */
	version: 1
	/** List of Hypermedia accounts. */
	accounts: Account[]
	/** List of delegations issued to third-party sites. */
	delegations: DelegatedSession[]
}

/** Create an empty vault. */
export function emptyVault(): VaultData {
	return { version: 1, accounts: [], delegations: [] }
}

/** Serialize vault data: CBOR encode → gzip compress. Returns compressed bytes. */
export async function serializeVault(data: VaultData): Promise<Uint8Array> {
	const cbor = dagCBOR.encode(data)
	return compress(new Uint8Array(cbor))
}

/** Deserialize vault data: gzip decompress → CBOR decode. */
export async function deserializeVault(compressed: Uint8Array): Promise<VaultData> {
	const cbor = await decompress(compressed)
	return dagCBOR.decode(cbor) as VaultData
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream("gzip")
	const writer = cs.writable.getWriter()
	writer.write(data as Uint8Array<ArrayBuffer>)
	writer.close()
	return collectStream(cs.readable)
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream("gzip")
	const writer = ds.writable.getWriter()
	writer.write(data as Uint8Array<ArrayBuffer>)
	writer.close()
	return collectStream(ds.readable)
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = []
	const reader = readable.getReader()
	for (;;) {
		const { done, value } = await reader.read()
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
