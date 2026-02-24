/**
 * Vault data model and CBOR+compression serialization.
 * Defines the structured format for storing Hypermedia identity accounts.
 */

import * as dagCBOR from "@ipld/dag-cbor"
import type * as blobs from "@shm/shared/blobs"
import type { CID } from "multiformats/cid"

/** A decoded hypermedia blob stored alongside its CID. */
export interface StoredBlob<T extends blobs.Blob> {
	/** Content-addressable ID natively encoded by dag-cbor. */
	cid: CID
	/** The decoded payload data. */
	decoded: T
}

/** A single Hypermedia account stored in the vault. */
export interface Account {
	/** 32-byte Ed25519 private key seed. */
	seed: Uint8Array
	/** Signed profile blob. */
	profile: StoredBlob<blobs.Profile>
	/** Unix timestamp ms when account was created. */
	createTime: number
	/** List of delegations issued to third-party sites by this account. */
	delegations: DelegatedSession[]
}

/** Record of a delegation issued to a third-party site's session key. */
export interface DelegatedSession {
	/** The origin (client_id) the delegation was issued to, e.g. "https://example.com". */
	clientId: string
	/** Type of device that requested the session. */
	deviceType?: "desktop" | "mobile" | "tablet" | "unknown"
	/** The capability blob delegating rights to the session key. */
	capability: StoredBlob<blobs.Capability>
	/** Unix timestamp ms when the delegation was created. */
	createTime: number
}

/** Top-level vault data structure. */
export interface State {
	/** Schema version for future migrations. */
	version: 1
	/** List of Hypermedia accounts. */
	accounts: Account[]
}

/** Create an empty vault. */
export function createEmpty(): State {
	return { version: 1, accounts: [] }
}

/** Serialize vault data: CBOR encode → gzip compress. Returns compressed bytes. */
export async function serialize(data: State): Promise<Uint8Array> {
	const cbor = dagCBOR.encode(data)
	return compress(new Uint8Array(cbor))
}

/** Deserialize vault data: gzip decompress → CBOR decode. */
export async function deserialize(compressed: Uint8Array): Promise<State> {
	const cbor = await decompress(compressed)
	return dagCBOR.decode(cbor) as State
}

/** Compress data using gzip. */
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
