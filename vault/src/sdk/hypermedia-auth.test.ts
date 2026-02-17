import { afterEach, describe, expect, test } from "bun:test"
import * as SDK from "./hypermedia-auth"

describe("base58btc encoding", () => {
	test("round-trips arbitrary bytes", () => {
		const input = new Uint8Array([0xed, 0x01, 0xaa, 0xbb, 0xcc, 0xdd])
		const encoded = SDK.base58btcEncode(input)
		const decoded = SDK.base58btcDecode(encoded)
		expect(decoded).toEqual(input)
	})

	test("handles leading zeros", () => {
		const input = new Uint8Array([0, 0, 0, 1, 2, 3])
		const encoded = SDK.base58btcEncode(input)
		// Leading zeros become '1' characters
		expect(encoded.startsWith("111")).toBe(true)
		const decoded = SDK.base58btcDecode(encoded)
		expect(decoded).toEqual(input)
	})

	test("empty input", () => {
		const encoded = SDK.base58btcEncode(new Uint8Array([]))
		expect(encoded).toBe("")
		const decoded = SDK.base58btcDecode("")
		expect(decoded).toEqual(new Uint8Array([]))
	})

	test("throws on invalid base58 character", () => {
		expect(() => SDK.base58btcDecode("0OIl")).toThrow("Invalid base58 character")
	})

	test("encodes known value", () => {
		// "Hello" in base58btc
		const input = new TextEncoder().encode("Hello")
		const encoded = SDK.base58btcEncode(input)
		expect(encoded).toBe("9Ajdvzr")
	})
})

describe("principal encoding", () => {
	test("produces z-prefixed string with correct structure", () => {
		const pubkey = new Uint8Array(32).fill(0x42)
		const principal = SDK.principalEncode(pubkey)

		// Multibase prefix
		expect(principal.startsWith("z")).toBe(true)

		// Round-trip
		const decoded = SDK.principalDecode(principal)
		expect(decoded).toEqual(pubkey)
	})

	test("decode rejects non-z prefix", () => {
		expect(() => SDK.principalDecode("m" + "abc")).toThrow("must start with 'z'")
	})

	test("decode rejects invalid multicodec prefix", () => {
		// Encode something with wrong prefix
		const bad = new Uint8Array([0x00, 0x01, ...new Uint8Array(32)])
		const encoded = `z${SDK.base58btcEncode(bad)}`
		expect(() => SDK.principalDecode(encoded)).toThrow("missing Ed25519 multicodec prefix")
	})
})

describe("handleCallback", () => {
	const originalLocation = window.location

	function setUrl(url: string) {
		Object.defineProperty(window, "location", {
			value: new URL(url),
			writable: true,
			configurable: true,
		})
	}

	afterEach(() => {
		Object.defineProperty(window, "location", {
			value: originalLocation,
			writable: true,
			configurable: true,
		})
	})

	test("returns null when no params present", async () => {
		setUrl("http://localhost:8081/")
		const result = await SDK.handleCallback({
			vaultUrl: "http://localhost:3000",
		})
		expect(result).toBeNull()
	})

	test("throws on error param", async () => {
		setUrl("http://localhost:8081/?error=access_denied")
		await expect(SDK.handleCallback({ vaultUrl: "http://localhost:3000" })).rejects.toThrow(
			"Delegation error: access_denied",
		)
	})

	test("throws when data param present but invalid", async () => {
		setUrl("http://localhost:8081/?data=invalidbase64")
		await expect(SDK.handleCallback({ vaultUrl: "http://localhost:3000" })).rejects.toThrow()
	})

	test("throws when no vaultUrl provided", async () => {
		setUrl("http://localhost:8081/?data=abc")
		await expect(SDK.handleCallback()).rejects.toThrow("vaultUrl is required")
	})
})

// WebCrypto Ed25519 may not be supported in happy-dom.
// We test it conditionally.
const hasWebCryptoEd25519 = await (async () => {
	try {
		await crypto.subtle.generateKey("Ed25519" as unknown as AlgorithmIdentifier, false, ["sign", "verify"])
		return true
	} catch {
		return false
	}
})()

const cryptoTest = hasWebCryptoEd25519 ? test : test.skip

describe("generateSessionKey", () => {
	cryptoTest("produces valid key pair and principal", async () => {
		const result = await SDK.generateSessionKey()

		expect(result.keyPair.publicKey).toBeDefined()
		expect(result.keyPair.privateKey).toBeDefined()
		expect(result.publicKeyRaw.length).toBe(32)
		expect(result.principal.startsWith("z")).toBe(true)

		// Verify round-trip of principal
		const decodedPubKey = SDK.principalDecode(result.principal)
		expect(decodedPubKey).toEqual(result.publicKeyRaw)
	})
})

describe("signWithSession", () => {
	cryptoTest("signs data and produces 64-byte signature", async () => {
		const { keyPair, publicKeyRaw, principal } = await SDK.generateSessionKey()
		const session: SDK.StoredSession = {
			keyPair,
			publicKeyRaw,
			principal,
			vaultUrl: "http://localhost:3000",
			createdAt: Date.now(),
		}

		const data = new TextEncoder().encode("test message")
		const signature = await SDK.signWithSession(session, data)

		expect(signature).toBeInstanceOf(Uint8Array)
		expect(signature.length).toBe(64)

		// Verify the signature with the public key
		const valid = await crypto.subtle.verify(
			"Ed25519" as unknown as AlgorithmIdentifier,
			keyPair.publicKey,
			signature as ArrayBufferView<ArrayBuffer>,
			data as ArrayBufferView<ArrayBuffer>,
		)
		expect(valid).toBe(true)
	})
})
