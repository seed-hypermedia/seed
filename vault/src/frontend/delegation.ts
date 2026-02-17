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

/** Vault route path for handling delegation requests. */
export const DELEGATION_PATH = "/delegate"

/** Parsed and validated delegation request from URL parameters. */
export interface DelegationRequest {
	/** The origin of the requesting site (must be HTTPS). e.g. "https://example.com" */
	clientId: string
	/** Where to redirect after delegation. Must be a strict extension of clientId. */
	redirectUri: string
	/** Base58btc-encoded principal of the session key to delegate to. */
	sessionKeyPrincipal: string
}

/**
 * Parse delegation params from the URL's search params.
 * Returns null if not a delegation request (no params present).
 * Throws descriptive errors if params are present but invalid.
 */
export function parseDelegationRequest(url: URL): DelegationRequest | null {
	const clientId = url.searchParams.get(PARAM_CLIENT_ID)
	const redirectUri = url.searchParams.get(PARAM_REDIRECT_URI)
	const sessionKey = url.searchParams.get(PARAM_SESSION_KEY)

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

	validateClientId(clientId)
	validateRedirectUri(redirectUri, clientId)

	return {
		clientId,
		redirectUri,
		sessionKeyPrincipal: sessionKey,
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
