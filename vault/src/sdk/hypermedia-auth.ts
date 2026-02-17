/**
 * Hypermedia Auth Client SDK.
 *
 * A self-contained module for third-party sites to authenticate users via a
 * Seed Hypermedia Identity Vault. Uses only the Web Crypto API and IndexedDB —
 * zero external dependencies.
 *
 * @example
 * ```ts
 * import * as hmauth from "./hypermedia-auth"
 *
 * // Start the auth flow and navigate to the returned URL
 * const authUrl = await hmauth.startAuth({ vaultUrl: "https://vault.example.com" })
 *
 * // On the callback page
 * const result = await hmauth.handleCallback()
 * if (result) {
 *   console.log("Authenticated as", result.accountPrincipal)
 * }
 * ```
 */

import * as dagCBOR from "@ipld/dag-cbor"

// -- Blob types (mirrored from frontend) --

/** Packed binary public key: `<multicodec-varint><raw-key-bytes>`. */
export type Principal = Uint8Array

/** Cryptographic signature bytes. */
export type Signature = Uint8Array

/** Unix timestamp in milliseconds. */
export type Timestamp = number

/** Role values for capability blobs. */
export type Role = "WRITER" | "AGENT"

/** Base blob type that all signed blobs extend. */
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
	readonly alias?: Principal
	readonly name?: string
	readonly avatar?: string
	readonly description?: string
	readonly account?: Principal
}

/** Capability blob granting rights from issuer to delegate. */
export interface Capability extends Blob {
	readonly type: "Capability"
	readonly delegate: Principal
	readonly audience?: Principal
	readonly path?: string
	readonly role: Role
	readonly label?: string
}

/** Callback data structure returned from the vault. */
interface CallbackData {
	account: Principal
	capability: Capability
	profile: Profile
}

// -- Types --

/** Configuration for the Hypermedia auth client. */
export interface HypermediaAuthConfig {
	/** The URL of the Vault application. e.g. "https://vault.example.com" */
	vaultUrl: string
	/** The client ID (origin of this site). Usually `window.location.origin`. */
	clientId?: string
	/** The redirect URI. Defaults to current page URL (without search params). */
	redirectUri?: string
}

/** Stored session key with metadata. */
export interface StoredSession {
	/** The CryptoKeyPair (publicKey + unextractable privateKey). */
	keyPair: CryptoKeyPair
	/** The raw public key bytes (32 bytes). */
	publicKeyRaw: Uint8Array
	/** The base58btc-encoded principal string. */
	principal: string
	/** The vault URL this session is for. */
	vaultUrl: string
	/** When this session was created. */
	createdAt: number
}

/** Profile metadata returned from the Vault about the delegating account. */
export interface AccountProfile {
	/** Display name of the account. */
	name?: string
	/** Short text description. */
	description?: string
	/** Avatar URI. */
	avatar?: string
}

/** Result of completing the auth flow. */
export interface AuthResult {
	/** The account principal (base58btc) that authorized this session. */
	accountPrincipal: string
	/** The signed capability blob. */
	capability: Capability
	/** The stored session with the unextractable signing key. */
	session: StoredSession
	/** The profile blob of the account. */
	profile: Profile
}

// -- Base58btc encoder/decoder (inline, no deps) --

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

/** Encode bytes to a base58btc string. */
export function base58btcEncode(bytes: Uint8Array): string {
	if (bytes.length === 0) return ""
	const digits: number[] = [0]
	for (const byte of bytes) {
		let carry = byte
		for (let j = 0; j < digits.length; j++) {
			// biome-ignore lint/style/noNonNullAssertion: digits[j] always defined in loop
			carry += digits[j]! << 8
			digits[j] = carry % 58
			carry = (carry / 58) | 0
		}
		while (carry > 0) {
			digits.push(carry % 58)
			carry = (carry / 58) | 0
		}
	}
	let str = ""
	for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
		str += BASE58_ALPHABET[0]
	}
	for (let i = digits.length - 1; i >= 0; i--) {
		// biome-ignore lint/style/noNonNullAssertion: digits[i] always defined in loop
		str += BASE58_ALPHABET[digits[i]!]
	}
	return str
}

/** Decode a base58btc string to bytes. */
export function base58btcDecode(str: string): Uint8Array {
	if (str.length === 0) return new Uint8Array([])
	const bytes: number[] = [0]
	for (const char of str) {
		const idx = BASE58_ALPHABET.indexOf(char)
		if (idx === -1) throw new Error(`Invalid base58 character: ${char}`)
		let carry = idx
		for (let j = 0; j < bytes.length; j++) {
			// biome-ignore lint/style/noNonNullAssertion: bytes[j] always defined in loop
			carry += bytes[j]! * 58
			bytes[j] = carry & 0xff
			carry >>= 8
		}
		while (carry > 0) {
			bytes.push(carry & 0xff)
			carry >>= 8
		}
	}
	for (let i = 0; i < str.length && str[i] === BASE58_ALPHABET[0]; i++) {
		bytes.push(0)
	}
	return new Uint8Array(bytes.reverse())
}

// -- Principal encoding --

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

/** Encode a 32-byte Ed25519 public key as a base58btc multibase principal string. */
export function principalEncode(rawPublicKey: Uint8Array): string {
	const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + rawPublicKey.length)
	prefixed.set(ED25519_MULTICODEC_PREFIX)
	prefixed.set(rawPublicKey, ED25519_MULTICODEC_PREFIX.length)
	return `z${base58btcEncode(prefixed)}`
}

/** Decode a base58btc multibase principal string to the raw 32-byte Ed25519 public key. */
export function principalDecode(principal: string): Uint8Array {
	if (!principal.startsWith("z")) {
		throw new Error("Invalid principal: must start with 'z' (base58btc multibase prefix)")
	}
	const decoded = base58btcDecode(principal.slice(1))
	if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
		throw new Error("Invalid principal: missing Ed25519 multicodec prefix")
	}
	return decoded.slice(2)
}

// -- Base64url decoding (for callback data) --

function base64urlDecode(str: string): Uint8Array {
	return Uint8Array.fromBase64(str, { alphabet: "base64url" })
}

// -- Gzip decompression --

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

// -- Blob signature verification --

const ED25519_VARINT_PREFIX = new Uint8Array([0xed, 0x01])
const ED25519_SIGNATURE_SIZE = 64
const ED25519_PUBLIC_KEY_SIZE = 32

async function verifyBlob(blob: Blob): Promise<boolean> {
	if (blob.signer[0] !== ED25519_VARINT_PREFIX[0] || blob.signer[1] !== ED25519_VARINT_PREFIX[1]) {
		return false
	}
	const rawPubKey = blob.signer.slice(ED25519_VARINT_PREFIX.length)
	if (rawPubKey.length !== ED25519_PUBLIC_KEY_SIZE) {
		return false
	}

	const sigCopy = new Uint8Array(blob.sig)
	const unsigned = { ...blob, sig: new Uint8Array(ED25519_SIGNATURE_SIZE) }
	const encoded = dagCBOR.encode(unsigned)
	const data = new Uint8Array(encoded)

	return await crypto.subtle.verify(
		"Ed25519" as unknown as AlgorithmIdentifier,
		await crypto.subtle.importKey("raw", rawPubKey, "Ed25519" as unknown as AlgorithmIdentifier, false, ["verify"]),
		sigCopy,
		data,
	)
}

// -- IndexedDB helpers (private) --

const DB_NAME = "hypermedia-auth"
const STORE_NAME = "sessions"
const DB_VERSION = 1

interface DBSessionRecord {
	keyPair: CryptoKeyPair
	publicKeyRaw: Uint8Array
	principal: string
	vaultUrl: string
	createdAt: number
}

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME)
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

async function dbGet(key: string): Promise<DBSessionRecord | undefined> {
	const db = await openDB()
	return await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly")
		const store = tx.objectStore(STORE_NAME)
		const req = store.get(key)
		req.onsuccess = () => resolve(req.result as DBSessionRecord | undefined)
		req.onerror = () => reject(req.error)
	})
}

async function dbPut(key: string, value: DBSessionRecord): Promise<void> {
	const db = await openDB()
	return await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite")
		const store = tx.objectStore(STORE_NAME)
		const req = store.put(value, key)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

async function dbDelete(key: string): Promise<void> {
	const db = await openDB()
	return await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite")
		const store = tx.objectStore(STORE_NAME)
		const req = store.delete(key)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
}

// -- Session key generation --

/**
 * Generate a non-extractable Ed25519 session key pair using the Web Crypto API.
 * Returns the key pair, raw public key bytes, and the encoded principal string.
 */
export async function generateSessionKey(): Promise<{
	keyPair: CryptoKeyPair
	publicKeyRaw: Uint8Array
	principal: string
}> {
	const keyPair = (await crypto.subtle.generateKey("Ed25519" as unknown as AlgorithmIdentifier, false, [
		"sign",
		"verify",
	])) as CryptoKeyPair
	const rawExport = await crypto.subtle.exportKey("raw", keyPair.publicKey)
	const publicKeyRaw = new Uint8Array(rawExport)
	const principal = principalEncode(publicKeyRaw)
	return { keyPair, publicKeyRaw, principal }
}

// -- Public API --

/**
 * Start the authentication flow by generating a session key and storing it.
 *
 * 1. Generates a non-extractable Ed25519 key pair.
 * 2. Stores it in IndexedDB keyed by the Vault URL.
 * 3. Returns the Vault URL (with delegation params) for the caller to navigate to.
 */
export async function startAuth(config: HypermediaAuthConfig): Promise<string> {
	const clientId = config.clientId ?? window.location.origin
	const redirectUri = config.redirectUri ?? `${window.location.origin}${window.location.pathname}`

	const session = await generateSessionKey()

	const record: DBSessionRecord = {
		keyPair: session.keyPair,
		publicKeyRaw: session.publicKeyRaw,
		principal: session.principal,
		vaultUrl: config.vaultUrl,
		createdAt: Date.now(),
	}

	await dbPut(config.vaultUrl, record)

	// Navigate to the vault root. The vault captures delegation params on any
	// landing URL and preserves them through login/registration flows.
	const url = new URL(config.vaultUrl)
	url.search = ""
	url.hash = ""
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("session_key", session.principal)

	return url.toString()
}

/**
 * Handle the callback after the Vault redirects back with delegation results.
 *
 * Checks the current URL for `data` query parameter containing CBOR-encoded,
 * gzip-compressed, base64url-encoded callback data.
 * Returns null if no delegation parameters are present.
 * Throws if an `error` parameter is present.
 */
export async function handleCallback(config?: Partial<HypermediaAuthConfig>): Promise<AuthResult | null> {
	const url = new URL(window.location.href)
	const dataParam = url.searchParams.get("data")
	const error = url.searchParams.get("error")

	if (!dataParam) {
		if (error) {
			throw new Error(`Delegation error: ${error}`)
		}
		return null
	}

	const vaultUrl = config?.vaultUrl
	if (!vaultUrl) {
		throw new Error("vaultUrl is required to retrieve the stored session")
	}

	const session = await getSession(vaultUrl)
	if (!session) {
		throw new Error("No stored session found for this vault. Was startAuth() called first?")
	}

	// Decode callback data: base64url → gzip decompress → CBOR decode
	const compressed = base64urlDecode(dataParam)
	const cbor = await decompress(compressed)
	const callbackData = dagCBOR.decode(cbor) as CallbackData

	// Verify signatures on capability and profile
	const capabilityValid = await verifyBlob(callbackData.capability)
	if (!capabilityValid) {
		throw new Error("Invalid capability signature")
	}

	const profileValid = await verifyBlob(callbackData.profile)
	if (!profileValid) {
		throw new Error("Invalid profile signature")
	}

	return {
		accountPrincipal: principalEncode(callbackData.account),
		capability: callbackData.capability,
		session,
		profile: callbackData.profile,
	}
}

/**
 * Retrieve a stored session from IndexedDB for a given Vault URL.
 * Returns null if no session is stored.
 */
export async function getSession(vaultUrl: string): Promise<StoredSession | null> {
	const record = await dbGet(vaultUrl)
	if (!record) return null
	return {
		keyPair: record.keyPair,
		publicKeyRaw: record.publicKeyRaw,
		principal: record.principal,
		vaultUrl: record.vaultUrl,
		createdAt: record.createdAt,
	}
}

/**
 * Sign data using the session's non-extractable private key.
 * Uses the Web Crypto Ed25519 sign operation.
 */
export async function signWithSession(session: StoredSession, data: Uint8Array): Promise<Uint8Array> {
	const sig = await crypto.subtle.sign(
		"Ed25519" as unknown as AlgorithmIdentifier,
		session.keyPair.privateKey,
		data as ArrayBufferView<ArrayBuffer>,
	)
	return new Uint8Array(sig)
}

/**
 * Remove a stored session from IndexedDB for a given Vault URL. */
export async function clearSession(vaultUrl: string): Promise<void> {
	await dbDelete(vaultUrl)
}
