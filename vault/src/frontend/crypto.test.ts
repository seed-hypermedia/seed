/**
 * Unit tests for the crypto module.
 * Tests key derivation, encryption/decryption, and encoding utilities.
 */
import { describe, expect, test } from "bun:test"
import * as crypto from "./crypto"

describe("crypto utilities", () => {
	test("emailToSalt produces consistent salt from email", () => {
		const email = "test@example.com"
		const salt1 = crypto.emailToSalt(email)
		const salt2 = crypto.emailToSalt(email)
		expect(salt1).toBeInstanceOf(Uint8Array)
		expect(salt1).toEqual(salt2)
	})

	test("emailToSalt normalizes email", () => {
		const salt1 = crypto.emailToSalt("Test@Example.COM")
		const salt2 = crypto.emailToSalt("test@example.com")
		expect(salt1).toEqual(salt2)
	})

	test("generateNonce returns 24 bytes", () => {
		const nonce = crypto.generateNonce()
		expect(nonce).toBeInstanceOf(Uint8Array)
		expect(nonce.length).toBe(24)
	})

	test("generateDEK returns 64 bytes", () => {
		const dek = crypto.generateDEK()
		expect(dek).toBeInstanceOf(Uint8Array)
		expect(dek.length).toBe(64)
	})

	test("different emails produce different salts", () => {
		const salt1 = crypto.emailToSalt("user1@test.com")
		const salt2 = crypto.emailToSalt("user2@test.com")
		expect(salt1).not.toEqual(salt2)
	})
})

describe("base64url encoding", () => {
	test("encode and decode roundtrip", () => {
		const original = new Uint8Array([0, 1, 2, 255, 254, 253])
		const encoded = crypto.base64urlEncode(original)
		const decoded = crypto.base64urlDecode(encoded)
		expect(decoded).toEqual(original)
	})

	test("handles empty array", () => {
		const empty = new Uint8Array([])
		const encoded = crypto.base64urlEncode(empty)
		const decoded = crypto.base64urlDecode(encoded)
		expect(decoded).toEqual(empty)
	})

	test("produces URL-safe characters", () => {
		// Test data that would produce + and / in standard base64.
		const data = new Uint8Array([251, 255, 254])
		const encoded = crypto.base64urlEncode(data)
		expect(encoded).not.toContain("+")
		expect(encoded).not.toContain("/")
		expect(encoded).not.toContain("=")
	})
})

describe("key derivation", () => {
	test("deriveKeyFromPassword returns 32 bytes", async () => {
		const salt = crypto.emailToSalt("test@example.com")
		const key = await crypto.deriveKeyFromPassword("testpassword", salt, crypto.DEFAULT_ARGON2_PARAMS)
		expect(key).toBeInstanceOf(Uint8Array)
		expect(key.length).toBe(32)
	})

	test("same password and salt produce same key", async () => {
		const salt = crypto.emailToSalt("same@example.com")
		const key1 = await crypto.deriveKeyFromPassword("mypassword", salt, crypto.DEFAULT_ARGON2_PARAMS)
		const key2 = await crypto.deriveKeyFromPassword("mypassword", salt, crypto.DEFAULT_ARGON2_PARAMS)
		expect(key1).toEqual(key2)
	})

	test("different passwords produce different keys", async () => {
		const salt = crypto.emailToSalt("user@example.com")
		const key1 = await crypto.deriveKeyFromPassword("password1", salt, crypto.DEFAULT_ARGON2_PARAMS)
		const key2 = await crypto.deriveKeyFromPassword("password2", salt, crypto.DEFAULT_ARGON2_PARAMS)
		expect(key1).not.toEqual(key2)
	})

	test("different emails produce different keys", async () => {
		const salt1 = crypto.emailToSalt("user1@example.com")
		const salt2 = crypto.emailToSalt("user2@example.com")
		const key1 = await crypto.deriveKeyFromPassword("samepassword", salt1, crypto.DEFAULT_ARGON2_PARAMS)
		const key2 = await crypto.deriveKeyFromPassword("samepassword", salt2, crypto.DEFAULT_ARGON2_PARAMS)
		expect(key1).not.toEqual(key2)
	})

	test("stretchKey expands to 64 bytes", async () => {
		const masterKey = new Uint8Array(32).fill(42)
		const stretched = await crypto.stretchKey(masterKey)
		expect(stretched).toBeInstanceOf(Uint8Array)
		expect(stretched.length).toBe(64)
	})

	test("stretchKey is deterministic", async () => {
		const masterKey = new Uint8Array(32).fill(123)
		const stretched1 = await crypto.stretchKey(masterKey)
		const stretched2 = await crypto.stretchKey(masterKey)
		expect(stretched1).toEqual(stretched2)
	})
})

describe("encryption and decryption", () => {
	test("encrypt and decrypt roundtrip", async () => {
		const plaintext = new TextEncoder().encode("Hello, World!")
		const key = new Uint8Array(64).fill(42)

		const encrypted = await crypto.encrypt(plaintext, key)
		const decrypted = await crypto.decrypt(encrypted, key)

		expect(decrypted).toEqual(plaintext)
	})

	test("ciphertext is different from plaintext", async () => {
		const plaintext = new TextEncoder().encode("Secret message")
		const key = new Uint8Array(64).fill(99)

		const encrypted = await crypto.encrypt(plaintext, key)
		expect(encrypted).not.toEqual(plaintext)
	})

	test("different nonces produce different ciphertexts", async () => {
		const plaintext = new TextEncoder().encode("Same message")
		const key = new Uint8Array(64).fill(77)

		const result1 = await crypto.encrypt(plaintext, key)
		const result2 = await crypto.encrypt(plaintext, key)

		// The whole blob should be different because nonce is different.
		expect(result1).not.toEqual(result2)
	})

	test("decryption with wrong key fails", async () => {
		const plaintext = new TextEncoder().encode("Secret")
		const correctKey = new Uint8Array(64).fill(1)
		const wrongKey = new Uint8Array(64).fill(2)

		const encrypted = await crypto.encrypt(plaintext, correctKey)

		// Depending on polyfill or native implementation, this might throw or return garbage.
		// XChaCha20-Poly1305 usually throws on tag mismatch.
		await expect(crypto.decrypt(encrypted, wrongKey)).rejects.toThrow()
	})

	test("decryption with tampered data fails", async () => {
		const plaintext = new TextEncoder().encode("Secret")
		const key = new Uint8Array(64).fill(1)

		const encrypted = await crypto.encrypt(plaintext, key)

		// Tamper with the last byte (auth tag or ciphertext).
		encrypted[encrypted.length - 1]! ^= 1

		expect(crypto.decrypt(encrypted, key)).rejects.toThrow()
	})
})

describe("auth hash", () => {
	test("computeAuthHash returns 32 bytes", async () => {
		const stretchedKey = new Uint8Array(64).fill(55)
		const hash = await crypto.computeAuthHash(stretchedKey)
		expect(hash).toBeInstanceOf(Uint8Array)
		expect(hash.length).toBe(32)
	})

	test("computeAuthHash is deterministic", async () => {
		const stretchedKey = new Uint8Array(64).fill(88)
		const hash1 = await crypto.computeAuthHash(stretchedKey)
		const hash2 = await crypto.computeAuthHash(stretchedKey)
		expect(hash1).toEqual(hash2)
	})

	test("different keys produce different hashes", async () => {
		const key1 = new Uint8Array(64).fill(1)
		const key2 = new Uint8Array(64).fill(2)
		const hash1 = await crypto.computeAuthHash(key1)
		const hash2 = await crypto.computeAuthHash(key2)
		expect(hash1).not.toEqual(hash2)
	})
})

describe("full key derivation flow", () => {
	test("password to auth hash flow", async () => {
		const email = "user@example.com"
		const password = "MySecurePassword123!"
		const salt = crypto.emailToSalt(email)

		// Derive master key.
		const masterKey = await crypto.deriveKeyFromPassword(password, salt, crypto.DEFAULT_ARGON2_PARAMS)
		expect(masterKey.length).toBe(32)

		// Stretch key.
		const stretchedKey = await crypto.stretchKey(masterKey)
		expect(stretchedKey.length).toBe(64)

		// Compute auth hash (uses second half of stretched key).
		const authHash = await crypto.computeAuthHash(stretchedKey)
		expect(authHash.length).toBe(32)

		// Encrypt DEK with first half of stretched key.
		const dek = crypto.generateDEK()
		const encryptedDEK = await crypto.encrypt(dek, stretchedKey)

		// Decrypt DEK.
		const decryptedDEK = await crypto.decrypt(encryptedDEK, stretchedKey)
		expect(decryptedDEK).toEqual(dek)
	})
})
