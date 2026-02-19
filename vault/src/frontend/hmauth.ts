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
import * as blobs from "@shm/shared/blobs"
import * as base64 from "@/frontend/base64"
import * as vault from "./vault"

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

/** URL parameter name for the client ID (origin of the requesting site). */
export const PARAM_CLIENT_ID = "client_id"

/** URL parameter name for the redirect URI. */
export const PARAM_REDIRECT_URI = "redirect_uri"

/** URL parameter name for the session key principal. */
export const PARAM_SESSION_KEY = "session_key"

/** URL parameter name for callback correlation state. */
export const PARAM_STATE = "state"

/** URL parameter name for request timestamp (unix ms). */
export const PARAM_TS = "ts"

/** URL parameter name for request proof signature. */
export const PARAM_PROOF = "proof"

/** URL parameter name for delegation callback data. */
export const PARAM_DATA = "data"

/** URL parameter name for callback errors. */
export const PARAM_ERROR = "error"

/** Vault route path for handling delegation requests. */
export const DELEGATION_PATH = "/delegate"

const AUTH_STATE_BYTES = 16
const REQUEST_PROOF_MAX_AGE_MS = 5 * 60 * 1000
const REQUEST_PROOF_FUTURE_SKEW_MS = 60 * 1000

/** Encode a 32-byte Ed25519 public key as a base58btc multibase principal string. */
export function principalEncode(rawPublicKey: Uint8Array): string {
	return blobs.principalToString(blobs.principalFromEd25519(rawPublicKey))
}

/** Decode a base58btc multibase principal string to the raw 32-byte Ed25519 public key. */
export function principalDecode(principal: string): Uint8Array {
	const packedPrincipal = blobs.principalFromString(principal)
	return new Uint8Array(packedPrincipal.slice(blobs.ED25519_VARINT_PREFIX.length))
}

function generateAuthState(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(AUTH_STATE_BYTES))
	return base64.encode(bytes)
}

async function signDelegationProof(privateKey: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
	const signature = await crypto.subtle.sign(
		"Ed25519" as unknown as AlgorithmIdentifier,
		privateKey,
		payload as ArrayBufferView<ArrayBuffer>,
	)
	return new Uint8Array(signature)
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

async function decompress(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream("gzip")
	const writer = ds.writable.getWriter()
	writer.write(data as Uint8Array<ArrayBuffer>)
	writer.close()
	return collectStream(ds.readable)
}

function hasProofParam(url: string): boolean {
	return url.includes(`?${PARAM_PROOF}=`) || url.includes(`&${PARAM_PROOF}=`)
}

function stripTrailingProofParam(url: string): string {
	const escapedParam = PARAM_PROOF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const trailingProofPattern = new RegExp(`[?&]${escapedParam}=[^&#]*$`)
	return url.replace(trailingProofPattern, "")
}

function ensureProofIsTrailing(url: string): void {
	const signedUrl = stripTrailingProofParam(url)
	if (hasProofParam(url) && signedUrl === url) {
		throw new Error("Invalid delegation request URL: proof must be the final query parameter")
	}
}

function isLocalhost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1"
}

function decodeProofSignature(proof: string): Uint8Array {
	let signature: Uint8Array
	try {
		signature = base64.decode(proof)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Invalid proof signature encoding: ${message}`)
	}
	if (signature.length !== 64) {
		throw new Error(`Invalid proof signature length: expected 64 bytes, got ${signature.length}`)
	}
	return signature
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
	createTime: number
	authState: string | null
	authStartTime: number | null
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

/** Parsed and validated delegation request from URL parameters. */
export interface DelegationRequest {
	/** Original delegation request URL as received by the vault, including `proof`. */
	originalUrl: string
	/** The origin of the requesting site (must be HTTPS). e.g. "https://example.com". */
	clientId: string
	/** Where to redirect after delegation. Must be a strict extension of clientId. */
	redirectUri: string
	/** Base58btc-encoded principal of the session key to delegate to. */
	sessionKeyPrincipal: string
	/** Opaque callback correlation state from the requesting site. */
	state: string
	/** Request timestamp (unix ms) signed by the session key. */
	requestTs: number
	/** Base64url-encoded Ed25519 signature over the request URL bytes without trailing `proof`. */
	proof: string
	/** Inferred vault origin where this request was received. */
	vaultOrigin: string
}

/**
 * Validate a client ID string.
 * Must be a valid HTTPS origin (HTTP allowed for localhost) with no path, query, or fragment.
 */
export function validateClientId(clientId: string): void {
	let parsed: URL
	try {
		parsed = new URL(clientId)
	} catch {
		throw new Error(`Invalid client_id: not a valid URL: ${clientId}`)
	}

	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost(parsed.hostname))) {
		throw new Error(`Invalid client_id: must use HTTPS (HTTP allowed only for localhost): ${clientId}`)
	}
	if (parsed.pathname !== "/" && parsed.pathname !== "") {
		throw new Error(`Invalid client_id: must not have a path: ${clientId}`)
	}
	if (parsed.search) {
		throw new Error(`Invalid client_id: must not have a query string: ${clientId}`)
	}
	if (parsed.hash) {
		throw new Error(`Invalid client_id: must not have a fragment: ${clientId}`)
	}
}

/**
 * Validate a redirect URI against a client ID.
 * Must be a valid HTTPS URL (HTTP allowed for localhost) whose origin matches the client ID.
 */
export function validateRedirectUri(redirectUri: string, clientId: string): void {
	let parsed: URL
	try {
		parsed = new URL(redirectUri)
	} catch {
		throw new Error(`Invalid redirect_uri: not a valid URL: ${redirectUri}`)
	}

	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost(parsed.hostname))) {
		throw new Error(`Invalid redirect_uri: must use HTTPS (HTTP allowed only for localhost): ${redirectUri}`)
	}

	const redirectOrigin = parsed.origin
	const clientOrigin = new URL(clientId).origin
	if (redirectOrigin !== clientOrigin) {
		throw new Error(`Invalid redirect_uri: origin "${redirectOrigin}" does not match client_id "${clientOrigin}"`)
	}
}

/**
 * Validate a session key principal format.
 * Must be a base58btc multibase Ed25519 principal.
 */
export function validateSessionKeyPrincipal(sessionKeyPrincipal: string): void {
	try {
		blobs.principalFromString(sessionKeyPrincipal)
	} catch {
		throw new Error(`Invalid session_key principal: ${sessionKeyPrincipal}`)
	}
}

/**
 * Validate callback correlation state format.
 * Must be base64url and at least 16 bytes of entropy.
 */
export function validateState(state: string): void {
	const valid = /^[A-Za-z0-9_-]+$/.test(state)
	if (!valid) {
		throw new Error("Invalid state: must be base64url")
	}
	const decoded = base64.decode(state)
	if (decoded.length < AUTH_STATE_BYTES) {
		throw new Error("Invalid state: must be at least 128 bits")
	}
}

/**
 * Validate and parse request timestamp.
 * Must be a finite positive integer.
 */
export function validateRequestTimestamp(ts: string): number {
	const parsed = Number(ts)
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ts: ${ts}`)
	}
	return parsed
}

/**
 * Parse delegation params from the URL's search params.
 * Returns null if not a delegation request (no params present).
 * Throws descriptive errors if params are present but invalid.
 */
export function parseDelegationRequest(url: URL | string): DelegationRequest | null {
	const originalUrl = typeof url === "string" ? url : url.toString()
	ensureProofIsTrailing(originalUrl)

	const parsedUrl = new URL(originalUrl)
	const clientId = parsedUrl.searchParams.get(PARAM_CLIENT_ID)
	const redirectUri = parsedUrl.searchParams.get(PARAM_REDIRECT_URI)
	const sessionKey = parsedUrl.searchParams.get(PARAM_SESSION_KEY)
	const state = parsedUrl.searchParams.get(PARAM_STATE)
	const ts = parsedUrl.searchParams.get(PARAM_TS)
	const proof = parsedUrl.searchParams.get(PARAM_PROOF)

	if (!clientId && !redirectUri && !sessionKey) {
		return null
	}
	if (!clientId) {
		throw new Error(`Missing required parameter: ${PARAM_CLIENT_ID}`)
	}
	if (!redirectUri) {
		throw new Error(`Missing required parameter: ${PARAM_REDIRECT_URI}`)
	}
	if (!sessionKey) {
		throw new Error(`Missing required parameter: ${PARAM_SESSION_KEY}`)
	}
	if (!state) {
		throw new Error(`Missing required parameter: ${PARAM_STATE}`)
	}
	if (!ts) {
		throw new Error(`Missing required parameter: ${PARAM_TS}`)
	}
	if (!proof) {
		throw new Error(`Missing required parameter: ${PARAM_PROOF}`)
	}

	validateClientId(clientId)
	validateRedirectUri(redirectUri, clientId)
	validateSessionKeyPrincipal(sessionKey)
	validateState(state)
	const requestTs = validateRequestTimestamp(ts)

	return {
		originalUrl,
		clientId,
		redirectUri,
		sessionKeyPrincipal: sessionKey,
		state,
		requestTs,
		proof,
		vaultOrigin: parsedUrl.origin,
	}
}

function buildSignedRequestPayload(request: DelegationRequest, vaultOrigin: string): Uint8Array {
	if (request.vaultOrigin !== vaultOrigin) {
		throw new Error("Delegation request vault origin mismatch")
	}
	ensureProofIsTrailing(request.originalUrl)
	const signedUrl = stripTrailingProofParam(request.originalUrl)
	return new TextEncoder().encode(signedUrl)
}

/**
 * Verify request proof-of-possession.
 * Checks freshness, vault origin binding, and Ed25519 signature with the delegated session key.
 */
export async function verifyDelegationRequestProof(
	request: DelegationRequest,
	vaultOrigin: string,
	now = Date.now(),
): Promise<void> {
	if (request.requestTs < now - REQUEST_PROOF_MAX_AGE_MS) {
		throw new Error("Delegation request proof expired")
	}
	if (request.requestTs > now + REQUEST_PROOF_FUTURE_SKEW_MS) {
		throw new Error("Delegation request proof timestamp is in the future")
	}

	const signature = decodeProofSignature(request.proof)
	const rawPubKey = principalDecode(request.sessionKeyPrincipal)
	const payload = buildSignedRequestPayload(request, vaultOrigin)

	const publicKey = await crypto.subtle.importKey(
		"raw",
		rawPubKey as ArrayBufferView<ArrayBuffer>,
		"Ed25519" as unknown as AlgorithmIdentifier,
		false,
		["verify"],
	)

	let valid: boolean
	try {
		valid = await crypto.subtle.verify(
			"Ed25519" as unknown as AlgorithmIdentifier,
			publicKey,
			signature as ArrayBufferView<ArrayBuffer>,
			payload as ArrayBufferView<ArrayBuffer>,
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to verify request proof signature: ${message}`)
	}
	if (!valid) {
		throw new Error("Request proof signature does not match session key")
	}
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
	validateClientId(clientId)
	validateRedirectUri(redirectUri, clientId)

	const session = await generateSessionKey()
	const authState = generateAuthState()
	const authStartTime = Date.now()

	const record: DBSessionRecord = {
		keyPair: session.keyPair,
		publicKeyRaw: session.publicKeyRaw,
		principal: session.principal,
		vaultUrl: config.vaultUrl,
		createTime: Date.now(),
		authState,
		authStartTime: authStartTime,
	}

	await dbPut(config.vaultUrl, record)

	// Navigate to the vault root. The vault captures delegation params on any
	// landing URL and preserves them through login/registration flows.
	const url = new URL(config.vaultUrl)
	url.search = ""
	url.hash = ""
	url.searchParams.set(PARAM_CLIENT_ID, clientId)
	url.searchParams.set(PARAM_REDIRECT_URI, redirectUri)
	url.searchParams.set(PARAM_SESSION_KEY, session.principal)
	url.searchParams.set(PARAM_STATE, authState)
	url.searchParams.set(PARAM_TS, String(authStartTime))
	const signedUrl = url.toString()
	const proofPayload = new TextEncoder().encode(signedUrl)
	const proofSig = await signDelegationProof(session.keyPair.privateKey, proofPayload)
	const proof = base64.encode(proofSig)
	const delimiter = signedUrl.includes("?") ? "&" : "?"
	return `${signedUrl}${delimiter}${PARAM_PROOF}=${encodeURIComponent(proof)}`
}

/** Callback data passed back to the requesting site after authorization. */
export interface CallbackData {
	/** Account principal (the issuer of the capability). */
	account: blobs.Principal
	/** Signed capability blob granting authority to the session key. */
	capability: blobs.Capability
	/** Profile blob of the account. */
	profile: blobs.Profile
}

/**
 * Build the callback URL to redirect the user back with the signed capability.
 * Encodes callback data as CBOR, compresses with gzip, then base64url-encodes.
 * Uses a single `data` URL parameter.
 */
export async function buildCallbackUrl(
	redirectUri: string,
	state: string,
	accountPrincipal: blobs.Principal,
	capability: blobs.Capability,
	profile: blobs.Profile,
): Promise<string> {
	const url = new URL(redirectUri)
	const callbackData: CallbackData = {
		account: accountPrincipal,
		capability,
		profile,
	}
	const cbor = dagCBOR.encode(callbackData)
	const compressed = await vault.compress(new Uint8Array(cbor))
	url.searchParams.set(PARAM_DATA, base64.encode(compressed))
	url.searchParams.set(PARAM_STATE, state)
	return url.toString()
}

/**
 * Create a signed delegation capability for a session key.
 * Returns an encoded Capability blob with role "AGENT" and a label identifying the client.
 */
export function createDelegation(
	issuerKeyPair: blobs.KeyPair,
	sessionKeyPrincipal: blobs.Principal,
	clientId: string,
): blobs.EncodedBlob<blobs.Capability> {
	return blobs.createCapability(issuerKeyPair, sessionKeyPrincipal, "AGENT", Date.now() as blobs.Timestamp, {
		label: `Session key for ${clientId}`,
	})
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
	const dataParam = url.searchParams.get(PARAM_DATA)
	const stateParam = url.searchParams.get(PARAM_STATE)
	const error = url.searchParams.get(PARAM_ERROR)

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
			authStartTime: null,
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
		createdAt: record.createTime,
	}

	// Decode callback data: base64url → gzip decompress → CBOR decode
	const compressed = base64.decode(dataParam)
	const cbor = await decompress(compressed)
	const callbackData = dagCBOR.decode<CallbackData>(cbor)

	// Verify signatures on capability and profile
	const capabilityValid = blobs.verify(callbackData.capability)
	if (!capabilityValid) {
		throw new Error("Invalid capability signature")
	}

	const profileValid = blobs.verify(callbackData.profile)
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
		authStartTime: null,
	})

	return {
		accountPrincipal: blobs.principalToString(callbackData.account),
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
		createdAt: record.createTime,
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
