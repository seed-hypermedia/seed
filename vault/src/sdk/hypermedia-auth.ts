/**
 * Hypermedia Auth Client SDK.
 *
 * A client module for third-party sites to authenticate users via a
 * Seed Hypermedia Identity Vault.
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
import * as base64 from "@/frontend/base64"
import * as blobs from "@/frontend/blobs"
import type * as delegation from "@/frontend/delegation"

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
	capability: blobs.Capability
	/** The stored session with the unextractable signing key. */
	session: StoredSession
	/** The profile blob of the account. */
	profile: blobs.Profile
}

// -- Base58btc encoder/decoder (inline, no deps) --

const AUTH_STATE_BYTES = 16

// -- Principal encoding --

/** Encode a 32-byte Ed25519 public key as a base58btc multibase principal string. */
export function principalEncode(rawPublicKey: Uint8Array): string {
	return blobs.principalToString(blobs.principalFromEd25519(rawPublicKey))
}

/** Decode a base58btc multibase principal string to the raw 32-byte Ed25519 public key. */
export function principalDecode(principal: string): Uint8Array {
	const packed = principalPackedDecode(principal)
	return packed.slice(blobs.ED25519_VARINT_PREFIX.length)
}

function principalPackedDecode(principal: string): Uint8Array {
	return blobs.principalFromString(principal)
}

function principalToString(principal: Uint8Array): string {
	return blobs.principalToString(principal)
}

// -- Base64url decoding (for callback data) --

function base64urlDecode(str: string): Uint8Array {
	return base64.decode(str)
}

function base64urlEncode(bytes: Uint8Array): string {
	return base64.encode(bytes)
}

function generateAuthState(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(AUTH_STATE_BYTES))
	return base64urlEncode(bytes)
}

async function signDelegationProof(privateKey: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
	const signature = await crypto.subtle.sign(
		"Ed25519" as unknown as AlgorithmIdentifier,
		privateKey,
		payload as ArrayBufferView<ArrayBuffer>,
	)
	return new Uint8Array(signature)
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

function verifyBlob(blob: blobs.Blob): boolean {
	return blobs.verify(blob)
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
	authState: string | null
	authStartedAt: number | null
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
	const principal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
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
	const authState = generateAuthState()
	const authStartedAt = Date.now()

	const record: DBSessionRecord = {
		keyPair: session.keyPair,
		publicKeyRaw: session.publicKeyRaw,
		principal: session.principal,
		vaultUrl: config.vaultUrl,
		createdAt: Date.now(),
		authState,
		authStartedAt,
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
	url.searchParams.set("state", authState)
	url.searchParams.set("ts", String(authStartedAt))
	const signedUrl = url.toString()
	const proofPayload = new TextEncoder().encode(signedUrl)
	const proofSig = await signDelegationProof(session.keyPair.privateKey, proofPayload)
	const proof = base64urlEncode(proofSig)
	const delimiter = signedUrl.includes("?") ? "&" : "?"
	return `${signedUrl}${delimiter}proof=${encodeURIComponent(proof)}`
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
	const stateParam = url.searchParams.get("state")
	const error = url.searchParams.get("error")

	if (!dataParam && !error) {
		return null
	}

	const vaultUrl = config?.vaultUrl
	if (!vaultUrl) {
		throw new Error("vaultUrl is required to retrieve the stored session")
	}

	if (!stateParam) {
		throw new Error("Missing callback state")
	}

	const record = await dbGet(vaultUrl)
	if (!record) {
		throw new Error("No stored session found for this vault. Was startAuth() called first?")
	}
	if (!record.authState) {
		throw new Error("No pending auth state found for this vault. Was startAuth() called first?")
	}
	if (record.authState !== stateParam) {
		throw new Error("Invalid callback state")
	}

	if (error) {
		await dbPut(vaultUrl, {
			...record,
			authState: null,
			authStartedAt: null,
		})
		throw new Error(`Delegation error: ${error}`)
	}
	if (!dataParam) {
		throw new Error("Missing callback data")
	}

	const session: StoredSession = {
		keyPair: record.keyPair,
		publicKeyRaw: record.publicKeyRaw,
		principal: record.principal,
		vaultUrl: record.vaultUrl,
		createdAt: record.createdAt,
	}

	// Decode callback data: base64url → gzip decompress → CBOR decode
	const compressed = base64urlDecode(dataParam)
	const cbor = await decompress(compressed)
	const callbackData = dagCBOR.decode(cbor) as delegation.CallbackData

	// Verify signatures on capability and profile
	const capabilityValid = verifyBlob(callbackData.capability)
	if (!capabilityValid) {
		throw new Error("Invalid capability signature")
	}

	const profileValid = verifyBlob(callbackData.profile)
	if (!profileValid) {
		throw new Error("Invalid profile signature")
	}

	const expectedDelegate = blobs.principalFromString(session.principal)
	if (!blobs.principalEqual(callbackData.capability.delegate, expectedDelegate)) {
		throw new Error("Capability delegate does not match local session key")
	}
	if (!blobs.principalEqual(callbackData.account, callbackData.capability.signer)) {
		throw new Error("Callback account does not match capability signer")
	}
	const profileAccount = callbackData.profile.account ?? callbackData.profile.signer
	if (!blobs.principalEqual(callbackData.account, profileAccount)) {
		throw new Error("Callback account does not match profile owner")
	}

	await dbPut(vaultUrl, {
		...record,
		authState: null,
		authStartedAt: null,
	})

	return {
		accountPrincipal: principalToString(callbackData.account),
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
