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
	/** The base64url-encoded signed capability blob (DAG-CBOR). */
	capability: string
	/** The stored session with the unextractable signing key. */
	session: StoredSession
	/** Profile metadata of the account that authorized this session. */
	profile: AccountProfile
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
 * 1. Generates a non-extractable Ed25519 key pair
 * 2. Stores it in IndexedDB keyed by the Vault URL
 * 3. Returns the Vault delegation URL for the caller to navigate to
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

	const url = new URL("/delegate", config.vaultUrl)
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("session_key", session.principal)

	return url.toString()
}

/**
 * Handle the callback after the Vault redirects back with delegation results.
 *
 * Checks the current URL for `capability` and `account` query parameters.
 * Returns null if no delegation parameters are present.
 * Throws if an `error` parameter is present.
 */
export async function handleCallback(config?: Partial<HypermediaAuthConfig>): Promise<AuthResult | null> {
	const url = new URL(window.location.href)
	const capability = url.searchParams.get("capability")
	const account = url.searchParams.get("account")
	const error = url.searchParams.get("error")

	if (!capability) {
		if (error) {
			throw new Error(`Delegation error: ${error}`)
		}
		return null
	}

	if (!account) {
		throw new Error("Missing account parameter in callback URL")
	}

	const vaultUrl = config?.vaultUrl
	if (!vaultUrl) {
		throw new Error("vaultUrl is required to retrieve the stored session")
	}

	const session = await getSession(vaultUrl)
	if (!session) {
		throw new Error("No stored session found for this vault. Was startAuth() called first?")
	}

	const profile: AccountProfile = {}
	const name = url.searchParams.get("account_name")
	const description = url.searchParams.get("account_description")
	const avatar = url.searchParams.get("account_avatar")
	if (name) profile.name = name
	if (description) profile.description = description
	if (avatar) profile.avatar = avatar

	return {
		accountPrincipal: account,
		capability,
		session,
		profile,
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
