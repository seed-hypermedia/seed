import { describe, expect, test } from "bun:test"
import * as base64 from "./base64"
import * as blobs from "./blobs"
import * as delegation from "./delegation"

async function createSignedDelegationUrl(
	clientId = "https://example.com",
	redirectUri = "https://example.com/callback",
	vaultOrigin = "https://vault.example.com",
) {
	const keyPair = (await crypto.subtle.generateKey("Ed25519" as unknown as AlgorithmIdentifier, false, [
		"sign",
		"verify",
	])) as CryptoKeyPair
	const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
	const sessionKeyPrincipal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
	const state = "AAAAAAAAAAAAAAAAAAAAAA"
	const requestTs = Date.now()
	const unsignedUrl = new URL(`${vaultOrigin}/delegate`)
	unsignedUrl.searchParams.set("client_id", clientId)
	unsignedUrl.searchParams.set("redirect_uri", redirectUri)
	unsignedUrl.searchParams.set("session_key", sessionKeyPrincipal)
	unsignedUrl.searchParams.set("state", state)
	unsignedUrl.searchParams.set("ts", String(requestTs))
	const payload = new TextEncoder().encode(unsignedUrl.toString())
	const proof = new Uint8Array(
		await crypto.subtle.sign(
			"Ed25519" as unknown as AlgorithmIdentifier,
			keyPair.privateKey,
			payload as ArrayBufferView<ArrayBuffer>,
		),
	)
	const proofBase64 = base64.encode(proof)
	const delimiter = unsignedUrl.search ? "&" : "?"
	const url = new URL(`${unsignedUrl.toString()}${delimiter}proof=${encodeURIComponent(proofBase64)}`)
	return { url, state }
}

describe("delegation request protocol", () => {
	test("parses and verifies a valid signed request", async () => {
		const { url } = await createSignedDelegationUrl()
		const request = delegation.parseDelegationRequest(url)
		expect(request).not.toBeNull()
		await expect(
			delegation.verifyDelegationRequestProof(request!, "https://vault.example.com"),
		).resolves.toBeUndefined()
	})

	test("rejects request when signed fields are tampered", async () => {
		const { url } = await createSignedDelegationUrl()
		url.searchParams.set("state", "BBBBBBBBBBBBBBBBBBBBBB")
		const request = delegation.parseDelegationRequest(url)
		await expect(delegation.verifyDelegationRequestProof(request!, "https://vault.example.com")).rejects.toThrow(
			"does not match session key",
		)
	})

	test("rejects request with malformed proof encoding", async () => {
		const { url } = await createSignedDelegationUrl()
		url.searchParams.set("proof", "not-base64url")
		const request = delegation.parseDelegationRequest(url)
		await expect(delegation.verifyDelegationRequestProof(request!, "https://vault.example.com")).rejects.toThrow(
			"Invalid proof signature encoding",
		)
	})

	test("rejects expired request proof", async () => {
		const { url } = await createSignedDelegationUrl()
		const request = delegation.parseDelegationRequest(url)
		const now = Date.now() + 6 * 60 * 1000
		await expect(delegation.verifyDelegationRequestProof(request!, "https://vault.example.com", now)).rejects.toThrow(
			"expired",
		)
	})

	test("rejects request when proof is not the final query parameter", async () => {
		const { url } = await createSignedDelegationUrl()
		url.searchParams.set("extra", "1")
		expect(() => delegation.parseDelegationRequest(url)).toThrow("proof must be the final query parameter")
	})
})

describe("delegation callback protocol", () => {
	test("echoes state in callback URL", async () => {
		const issuer = blobs.generateKeyPair()
		const delegate = blobs.generateKeyPair()
		const capability = blobs.createCapability(issuer, delegate.principal, "AGENT", Date.now()).decoded
		const profile = blobs.createProfile(issuer, { name: "Alice" }, Date.now()).decoded
		const url = await delegation.buildCallbackUrl(
			"https://example.com/callback",
			"AAAAAAAAAAAAAAAAAAAAAA",
			issuer.principal,
			capability,
			profile,
		)
		const parsed = new URL(url)
		expect(parsed.searchParams.get("state")).toBe("AAAAAAAAAAAAAAAAAAAAAA")
		expect(parsed.searchParams.get("data")).toBeString()
	})
})
