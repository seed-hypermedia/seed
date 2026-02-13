import { describe, expect, test } from "bun:test"
import * as blobs from "./blobs"
import * as localCrypto from "./crypto"
import * as delegation from "./delegation"

describe("parseDelegationRequest", () => {
	test("parses a valid delegation request", () => {
		const url = new URL(
			"https://vault.example.com/delegate?client_id=https%3A%2F%2Fapp.example.com&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&session_key=z6Mktest123",
		)
		const req = delegation.parseDelegationRequest(url)
		expect(req).not.toBeNull()
		expect(req!.clientId).toBe("https://app.example.com")
		expect(req!.redirectUri).toBe("https://app.example.com/callback")
		expect(req!.sessionKeyPrincipal).toBe("z6Mktest123")
	})

	test("returns null when no delegation params are present", () => {
		const url = new URL("https://vault.example.com/some-page?foo=bar")
		expect(delegation.parseDelegationRequest(url)).toBeNull()
	})

	test("throws when client_id is missing but other params present", () => {
		const url = new URL(
			"https://vault.example.com/delegate?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&session_key=z6Mktest",
		)
		expect(() => delegation.parseDelegationRequest(url)).toThrow("client_id")
	})

	test("throws when redirect_uri is missing but other params present", () => {
		const url = new URL(
			"https://vault.example.com/delegate?client_id=https%3A%2F%2Fapp.example.com&session_key=z6Mktest",
		)
		expect(() => delegation.parseDelegationRequest(url)).toThrow("redirect_uri")
	})

	test("throws when session_key is missing but other params present", () => {
		const url = new URL(
			"https://vault.example.com/delegate?client_id=https%3A%2F%2Fapp.example.com&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback",
		)
		expect(() => delegation.parseDelegationRequest(url)).toThrow("session_key")
	})

	test("throws when client_id is invalid", () => {
		const url = new URL(
			"https://vault.example.com/delegate?client_id=not-a-url&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&session_key=z6Mktest",
		)
		expect(() => delegation.parseDelegationRequest(url)).toThrow("not a valid URL")
	})

	test("throws when redirect_uri does not match client_id origin", () => {
		const url = new URL(
			"https://vault.example.com/delegate?client_id=https%3A%2F%2Fapp.example.com&redirect_uri=https%3A%2F%2Fevil.example.com%2Fcallback&session_key=z6Mktest",
		)
		expect(() => delegation.parseDelegationRequest(url)).toThrow("does not match")
	})
})

describe("validateClientId", () => {
	test("accepts valid HTTPS origin", () => {
		expect(() => delegation.validateClientId("https://example.com")).not.toThrow()
	})

	test("accepts HTTPS origin with port", () => {
		expect(() => delegation.validateClientId("https://example.com:8443")).not.toThrow()
	})

	test("accepts HTTP localhost", () => {
		expect(() => delegation.validateClientId("http://localhost")).not.toThrow()
	})

	test("accepts HTTP localhost with port", () => {
		expect(() => delegation.validateClientId("http://localhost:3000")).not.toThrow()
	})

	test("accepts HTTP 127.0.0.1", () => {
		expect(() => delegation.validateClientId("http://127.0.0.1:5173")).not.toThrow()
	})

	test("rejects HTTP on non-localhost", () => {
		expect(() => delegation.validateClientId("http://example.com")).toThrow("HTTPS")
	})

	test("rejects origin with path", () => {
		expect(() => delegation.validateClientId("https://example.com/path")).toThrow("path")
	})

	test("rejects origin with query", () => {
		expect(() => delegation.validateClientId("https://example.com?foo=bar")).toThrow("query")
	})

	test("rejects origin with fragment", () => {
		expect(() => delegation.validateClientId("https://example.com#section")).toThrow("fragment")
	})

	test("rejects invalid URL", () => {
		expect(() => delegation.validateClientId("not a url")).toThrow("not a valid URL")
	})
})

describe("validateRedirectUri", () => {
	test("accepts valid extension of client_id", () => {
		expect(() => delegation.validateRedirectUri("https://example.com/callback", "https://example.com")).not.toThrow()
	})

	test("accepts redirect URI with query params", () => {
		expect(() =>
			delegation.validateRedirectUri("https://example.com/cb?state=abc", "https://example.com"),
		).not.toThrow()
	})

	test("accepts HTTP localhost redirect", () => {
		expect(() =>
			delegation.validateRedirectUri("http://localhost:3000/callback", "http://localhost:3000"),
		).not.toThrow()
	})

	test("rejects different origin", () => {
		expect(() => delegation.validateRedirectUri("https://evil.com/callback", "https://example.com")).toThrow(
			"does not match",
		)
	})

	test("rejects different port", () => {
		expect(() => delegation.validateRedirectUri("https://example.com:9999/callback", "https://example.com")).toThrow(
			"does not match",
		)
	})

	test("rejects HTTP on non-localhost", () => {
		expect(() => delegation.validateRedirectUri("http://example.com/callback", "https://example.com")).toThrow("HTTPS")
	})

	test("rejects invalid URL", () => {
		expect(() => delegation.validateRedirectUri("not-a-url", "https://example.com")).toThrow("not a valid URL")
	})
})

describe("buildCallbackUrl", () => {
	test("correctly encodes capability and account params", () => {
		const capData = new Uint8Array([1, 2, 3, 4, 5])
		const accountPrincipal = "z6MkTestAccount"

		const result = delegation.buildCallbackUrl("https://example.com/callback", capData, accountPrincipal)
		const parsed = new URL(result)

		expect(parsed.origin).toBe("https://example.com")
		expect(parsed.pathname).toBe("/callback")
		expect(parsed.searchParams.get("account")).toBe("z6MkTestAccount")

		// Verify round-trip of capability data.
		const encodedCap = parsed.searchParams.get("capability")
		expect(encodedCap).not.toBeNull()
		const decoded = localCrypto.base64urlDecode(encodedCap!)
		expect(decoded).toEqual(capData)
	})

	test("preserves existing query params on redirect URI", () => {
		const result = delegation.buildCallbackUrl(
			"https://example.com/callback?state=xyz",
			new Uint8Array([10]),
			"z6MkTest",
		)
		const parsed = new URL(result)
		expect(parsed.searchParams.get("state")).toBe("xyz")
		expect(parsed.searchParams.get("account")).toBe("z6MkTest")
		expect(parsed.searchParams.get("capability")).not.toBeNull()
	})

	test("includes profile metadata when provided", () => {
		const result = delegation.buildCallbackUrl("https://example.com/callback", new Uint8Array([1]), "z6MkTest", {
			name: "Alice",
			description: "A test user",
		})
		const parsed = new URL(result)
		expect(parsed.searchParams.get("account_name")).toBe("Alice")
		expect(parsed.searchParams.get("account_description")).toBe("A test user")
		expect(parsed.searchParams.get("account_avatar")).toBeNull()
	})

	test("omits empty profile fields", () => {
		const result = delegation.buildCallbackUrl("https://example.com/callback", new Uint8Array([1]), "z6MkTest", {
			name: undefined,
			description: undefined,
		})
		const parsed = new URL(result)
		expect(parsed.searchParams.get("account_name")).toBeNull()
		expect(parsed.searchParams.get("account_description")).toBeNull()
	})
})

describe("createDelegation", () => {
	test("creates a valid capability with correct fields", () => {
		const issuer = blobs.generateKeyPair()
		const sessionKp = blobs.generateKeyPair()
		const clientId = "https://app.example.com"

		const encoded = delegation.createDelegation(issuer, sessionKp.principal, clientId)

		expect(encoded.decoded.type).toBe("Capability")
		expect(encoded.decoded.role).toBe("AGENT")
		expect(encoded.decoded.delegate).toEqual(sessionKp.principal)
		expect(blobs.principalEqual(encoded.decoded.signer, issuer.principal)).toBe(true)
		expect(encoded.decoded.label).toBe("Session key for https://app.example.com")
		expect(encoded.decoded.ts).toBeGreaterThan(0)
		expect(encoded.data.length).toBeGreaterThan(0)
		expect(encoded.cid).toBeDefined()
	})

	test("produces a verifiable signature", () => {
		const issuer = blobs.generateKeyPair()
		const sessionKp = blobs.generateKeyPair()

		const encoded = delegation.createDelegation(issuer, sessionKp.principal, "https://example.com")

		expect(blobs.verify(encoded.decoded)).toBe(true)
	})

	test("tampered capability fails verification", () => {
		const issuer = blobs.generateKeyPair()
		const sessionKp = blobs.generateKeyPair()

		const encoded = delegation.createDelegation(issuer, sessionKp.principal, "https://example.com")
		const tampered = { ...encoded.decoded, label: "tampered" }

		expect(blobs.verify(tampered)).toBe(false)
	})
})
