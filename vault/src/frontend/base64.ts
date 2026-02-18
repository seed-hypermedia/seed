// Polyfill for Uint8Array.prototype.toBase64 and Uint8Array.fromBase64.
// This is required for environments that don't support these methods yet.
import "core-js/modules/es.uint8-array.to-base64.js"
import "core-js/modules/es.uint8-array.from-base64.js"

/**
 * Encode Uint8Array to base64url string.
 */
export function encode(data: Uint8Array): string {
	return data.toBase64({ alphabet: "base64url", omitPadding: true })
}

/**
 * Decode base64url string to Uint8Array.
 */
export function decode(data: string): Uint8Array {
	return Uint8Array.fromBase64(data, { alphabet: "base64url" })
}
