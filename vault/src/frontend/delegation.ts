/**
 * Delegation flow logic for third-party site authentication.
 * Handles parsing delegation requests from URL params, validating client IDs
 * and redirect URIs, and creating signed capabilities for session keys.
 */

import * as base64 from "./base64"
import * as blobs from "./blobs"

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

/** Profile metadata to include in the callback URL. */
export interface CallbackProfile {
	/** Display name of the account. */
	name?: string
	/** Short text description. */
	description?: string
	/** Avatar URI. */
	avatar?: string
}

/**
 * Build the callback URL to redirect the user back with the signed capability.
 * Appends `capability` (base64url-encoded DAG-CBOR), `account` (base58btc principal),
 * and optional profile metadata as search params.
 */
export function buildCallbackUrl(
	redirectUri: string,
	capabilityData: Uint8Array,
	accountPrincipal: string,
	profile?: CallbackProfile,
): string {
	const url = new URL(redirectUri)
	url.searchParams.set("capability", base64.encode(capabilityData))
	url.searchParams.set("account", accountPrincipal)
	if (profile?.name) {
		url.searchParams.set("account_name", profile.name)
	}
	if (profile?.description) {
		url.searchParams.set("account_description", profile.description)
	}
	if (profile?.avatar) {
		url.searchParams.set("account_avatar", profile.avatar)
	}
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
