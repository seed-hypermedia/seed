import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "hash-wasm"

/**
 * Default Argon2id params (Bitwarden defaults).
 */
export const DEFAULT_ARGON2_PARAMS = {
	memoryCost: 65536, // 64 MiB in KiB.
	timeCost: 3,
	parallelism: 4,
}

/**
 * Argon2id parameters for key derivation.
 */
export interface Argon2Params {
	memoryCost: number
	timeCost: number
	parallelism: number
}

/**
 * Derive a 256-bit key from password using Argon2id.
 */
export async function deriveKeyFromPassword(
	password: string,
	salt: Uint8Array,
	params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<Uint8Array> {
	const hash = await argon2id({
		password,
		salt,
		parallelism: params.parallelism,
		iterations: params.timeCost,
		memorySize: params.memoryCost,
		hashLength: 32,
		outputType: "binary",
	})
	return new Uint8Array(hash)
}

/**
 * Stretch a key to 512 bits using HKDF-SHA256 (Web Crypto).
 */
export async function stretchKey(key: Uint8Array, info: string = "enc"): Promise<Uint8Array> {
	const baseKey = await crypto.subtle.importKey("raw", key.buffer as ArrayBuffer, { name: "HKDF" }, false, [
		"deriveBits",
	])

	const stretched = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(info),
		},
		baseKey,
		512,
	)

	return new Uint8Array(stretched)
}

/**
 * Generate a random Data Encryption Key (64 bytes).
 */
export function generateDEK(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(64))
}

/**
 * Normalize email for consistent salt derivation (lowercase + trim).
 */
export function normalizeEmail(email: string): string {
	return email.toLowerCase().trim()
}

/**
 * Derive salt from normalized email (UTF-8 encoded bytes).
 * This matches Bitwarden's approach of using email as salt.
 */
export function emailToSalt(email: string): Uint8Array {
	return new TextEncoder().encode(normalizeEmail(email))
}

/**
 * Generate a random nonce for XChaCha20-Poly1305 (24 bytes).
 */
export function generateNonce(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(24))
}

/**
 * Encrypt data using XChaCha20-Poly1305.
 * Uses the first 256 bits (32 bytes) of the key.
 */
/**
 * Encrypt data using XChaCha20-Poly1305.
 * Uses the first 256 bits (32 bytes) of the key.
 * Returns nonce prepended to ciphertext.
 */
export async function encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
	const nonce = generateNonce()
	const keySlice = key.subarray(0, 32)
	const xc = xchacha20poly1305(keySlice, nonce)
	const ciphertext = xc.encrypt(plaintext)

	const result = new Uint8Array(nonce.length + ciphertext.length)
	result.set(nonce)
	result.set(ciphertext, nonce.length)

	return result
}

/**
 * Decrypt data using XChaCha20-Poly1305.
 * Expects nonce to be prepended to the ciphertext (first 24 bytes).
 */
export async function decrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
	const nonce = data.subarray(0, 24)
	const ciphertext = data.subarray(24)
	const keySlice = key.subarray(0, 32)
	const xc = xchacha20poly1305(keySlice, nonce)
	return xc.decrypt(ciphertext)
}

/**
 * Compute auth hash from stretched key.
 * Uses the second half of the stretched key (bytes 32-64).
 */
export async function computeAuthHash(stretchedKey: Uint8Array): Promise<Uint8Array> {
	const authKey = stretchedKey.slice(32, 64)
	return authKey
}

// Polyfill for Uint8Array.prototype.toBase64 and Uint8Array.fromBase64
// This is required for environments that don't support these methods yet.
if (!Uint8Array.prototype.toBase64) {
	Uint8Array.prototype.toBase64 = function (options?: { alphabet?: "base64" | "base64url" }) {
		let binary = ""
		for (let i = 0; i < this.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: safe inside loop
			binary += String.fromCharCode(this[i]!)
		}
		const base64 = btoa(binary)
		if (options?.alphabet === "base64url") {
			return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
		}
		return base64
	}
}

if (!Uint8Array.fromBase64) {
	Uint8Array.fromBase64 = (string: string, options?: { alphabet?: "base64" | "base64url" }) => {
		let encoded = string
		if (options?.alphabet === "base64url") {
			encoded = string.replace(/-/g, "+").replace(/_/g, "/")
		}
		// Add padding if needed
		const pad = encoded.length % 4
		if (pad) {
			encoded += "=".repeat(4 - pad)
		}
		const binary = atob(encoded)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i)
		}
		return bytes
	}
}

/**
 * Encode Uint8Array to base64url string.
 */
export function base64urlEncode(data: Uint8Array): string {
	return data.toBase64({ alphabet: "base64url" })
}

/**
 * Decode base64url string to Uint8Array.
 */
export function base64urlDecode(data: string): Uint8Array {
	return Uint8Array.fromBase64(data, { alphabet: "base64url" })
}

/**
 * Check password strength.
 * Returns: 0 = weak, 1 = medium, 2 = strong.
 */
export function checkPasswordStrength(password: string): number {
	if (password.length < 8) return 0

	let score = 0
	if (password.length >= 12) score++
	if (password.length >= 16) score++
	if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
	if (/\d/.test(password)) score++
	if (/[^a-zA-Z0-9]/.test(password)) score++

	if (score <= 1) return 0
	if (score <= 3) return 1
	return 2
}

/**
 * Check if WebAuthn is supported.
 */
export function isWebAuthnSupported(): boolean {
	return !!(window.PublicKeyCredential && typeof window.PublicKeyCredential === "function")
}

/**
 * Check if platform authenticator is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
	if (!isWebAuthnSupported()) return false
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
	} catch {
		return false
	}
}

/**
 * Fixed PRF salt for WebAuthn key derivation.
 * Since each credential has a unique internal secret, a fixed salt still produces
 * unique derived keys per credential. This simplifies the implementation by avoiding
 * per-credential salt storage on the server.
 */
export const PRF_SALT = new TextEncoder().encode("hypermedia-identity-vault-v1")

/**
 * PRF extension result type (not included in TypeScript's built-in types).
 */
export interface PRFOutput {
	results?: {
		first?: ArrayBuffer
		second?: ArrayBuffer
	}
	enabled?: boolean
}

/**
 * Extract the wrapKey from PRF extension results.
 * The PRF output is 32 bytes, which is used directly as the wrapKey.
 * Returns null if PRF is not supported or the result is missing.
 */
export function extractPRFKey(prfOutput: PRFOutput | undefined): Uint8Array | null {
	if (!prfOutput?.results?.first) {
		return null
	}
	return new Uint8Array(prfOutput.results.first)
}
