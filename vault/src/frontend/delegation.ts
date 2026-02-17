/**
 * Delegation flow logic for third-party site authentication.
 * Handles parsing delegation requests from URL params, validating client IDs
 * and redirect URIs, and creating signed capabilities for session keys.
 */

import * as dagCBOR from "@ipld/dag-cbor"
import * as base64 from "./base64"
import * as blobs from "./blobs"
import { compress } from "./vault"

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

/** Vault route path for handling delegation requests. */
export const DELEGATION_PATH = "/delegate"

const REQUEST_PROOF_MAX_AGE_MS = 5 * 60 * 1000
const REQUEST_PROOF_FUTURE_SKEW_MS = 60 * 1000

/** Parsed and validated delegation request from URL parameters. */
export interface DelegationRequest {
	/** Original delegation request URL as received by the vault, including `proof`. */
	originalUrl: string
	/** The origin of the requesting site (must be HTTPS). e.g. "https://example.com" */
	clientId: string
	/** Where to redirect after delegation. Must be a strict extension of clientId. */
	redirectUri: string
	/** Base58btc-encoded principal of the session key to delegate to. */
	sessionKeyPrincipal: string
	/** Opaque callback correlation state from the requesting site. */
	state: string
	/** Request timestamp (unix ms) signed by the session key. */
	requestTs: number
	/** Base64url-encoded Ed25519 signature over the exact request URL bytes without trailing `proof`. */
	proof: string
	/** Inferred vault origin where this request was received. */
	vaultOrigin: string
}

/**
 * Parse delegation params from the URL's search params.
 * Returns null if not a delegation request (no params present).
 * Throws descriptive errors if params are present but invalid.
 */
export function parseDelegationRequest(url: URL | string): DelegationRequest | null {
	const originalUrl = typeof url === "string" ? url : url.toString()
	const parsedUrl = new URL(originalUrl)
	const signedUrl = stripTrailingProofParam(originalUrl)
	const hasProofParam = originalUrl.includes(`?${PARAM_PROOF}=`) || originalUrl.includes(`&${PARAM_PROOF}=`)
	if (hasProofParam && signedUrl === originalUrl) {
		throw new Error("Invalid delegation request URL: proof must be the final query parameter")
	}

	const clientId = parsedUrl.searchParams.get(PARAM_CLIENT_ID)
	const redirectUri = parsedUrl.searchParams.get(PARAM_REDIRECT_URI)
	const sessionKey = parsedUrl.searchParams.get(PARAM_SESSION_KEY)
	const state = parsedUrl.searchParams.get(PARAM_STATE)
	const ts = parsedUrl.searchParams.get(PARAM_TS)
	const proof = parsedUrl.searchParams.get(PARAM_PROOF)

	// If none of the delegation params are present, this is not a delegation request.
	if (!clientId && !redirectUri && !sessionKey) {
		return null
	}

	// If some but not all params are present, that's an error.
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

	const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"

	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
		throw new Error(`Invalid client_id: must use HTTPS (HTTP allowed only for localhost): ${clientId}`)
	}

	// An origin should have no path (other than "/"), no query, and no fragment.
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

	const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"

	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
		throw new Error(`Invalid redirect_uri: must use HTTPS (HTTP allowed only for localhost): ${redirectUri}`)
	}

	// The redirect URI must be a strict extension of the client ID (same origin).
	const redirectOrigin = parsed.origin
	// Normalize the clientId to its origin form (no trailing slash).
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
	if (decoded.length < 16) {
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

function decodeProofSignature(proof: string): Uint8Array {
	let sig: Uint8Array
	try {
		sig = base64.decode(proof)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Invalid proof signature encoding: ${message}`)
	}
	if (sig.length !== 64) {
		throw new Error(`Invalid proof signature length: expected 64 bytes, got ${sig.length}`)
	}
	return sig
}

function stripTrailingProofParam(url: string): string {
	const escapedParam = PARAM_PROOF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const trailingProofPattern = new RegExp(`[?&]${escapedParam}=[^&#]*$`)
	return url.replace(trailingProofPattern, "")
}

function buildSignedRequestPayload(request: DelegationRequest, vaultOrigin: string): Uint8Array {
	if (request.vaultOrigin !== vaultOrigin) {
		throw new Error("Delegation request vault origin mismatch")
	}
	const signedUrl = stripTrailingProofParam(request.originalUrl)
	const hasProofParam =
		request.originalUrl.includes(`?${PARAM_PROOF}=`) || request.originalUrl.includes(`&${PARAM_PROOF}=`)
	if (hasProofParam && signedUrl === request.originalUrl) {
		throw new Error("Invalid delegation request URL: proof must be the final query parameter")
	}
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
	const principal = blobs.principalFromString(request.sessionKeyPrincipal)
	const rawPubKey = principal.slice(blobs.ED25519_VARINT_PREFIX.length)
	const payload = buildSignedRequestPayload(request, vaultOrigin)
	const publicKey = await crypto.subtle.importKey(
		"raw",
		rawPubKey,
		"Ed25519" as unknown as AlgorithmIdentifier,
		false,
		["verify"],
	)
	const payloadForVerify = new Uint8Array(payload)
	let valid: boolean
	try {
		valid = await crypto.subtle.verify(
			"Ed25519" as unknown as AlgorithmIdentifier,
			publicKey,
			signature as ArrayBufferView<ArrayBuffer>,
			payloadForVerify as ArrayBufferView<ArrayBuffer>,
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to verify request proof signature: ${message}`)
	}
	if (!valid) {
		throw new Error("Request proof signature does not match session key")
	}
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
	const compressed = await compress(new Uint8Array(cbor))
	url.searchParams.set("data", base64.encode(compressed))
	url.searchParams.set("state", state)
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
