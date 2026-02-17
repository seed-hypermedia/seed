// Polyfill for Uint8Array.prototype.toBase64 and Uint8Array.fromBase64.
// This is required for environments that don't support these methods yet.
if (!Uint8Array.prototype.toBase64) {
	Uint8Array.prototype.toBase64 = function (options?: { alphabet?: "base64" | "base64url" }) {
		let binary = ""
		for (let i = 0; i < this.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: safe inside loop.
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
		// Add padding if needed.
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
export function encode(data: Uint8Array): string {
	return data.toBase64({ alphabet: "base64url" })
}

/**
 * Decode base64url string to Uint8Array.
 */
export function decode(data: string): Uint8Array {
	return Uint8Array.fromBase64(data, { alphabet: "base64url" })
}
