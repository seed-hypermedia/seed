import { createHmac, timingSafeEqual } from "node:crypto"
import { Cookie } from "bun"
import * as base64 from "@/frontend/base64"

export function getCookieName(isProd: boolean): string {
	return isProd ? "__Secure-wac" : "wac"
}

/**
 * Compute the HMAC commitment for a challenge.
 * The `purpose` is "webauthn-login" or "webauthn-register".
 * For register, `sessionId` must be provided for binding.
 */
export function computeHmac(
	secret: Uint8Array,
	purpose: "webauthn-login" | "webauthn-register",
	challenge: string,
	sessionId?: string,
): string {
	const hmac = createHmac("sha256", secret)
	hmac.update(purpose)
	hmac.update("\0")
	hmac.update(challenge)

	if (purpose === "webauthn-register") {
		if (!sessionId) {
			throw new Error("sessionId is required for webauthn-register purpose")
		}
		hmac.update("\0")
		hmac.update(sessionId)
	}

	return base64.encode(new Uint8Array(hmac.digest()))
}

/**
 * Verify a challenge cookie against the expected HMAC.
 * Returns true if the cookie matches.
 * Uses timing-safe comparison.
 */
export function verifyHmac(
	secret: Uint8Array,
	cookieValue: string,
	purpose: "webauthn-login" | "webauthn-register",
	challenge: string,
	sessionId?: string,
): boolean {
	if (!cookieValue) return false

	// Recompute the HMAC with the expected inputs.
	const expectedHmacString = computeHmac(secret, purpose, challenge, sessionId)

	const a = new TextEncoder().encode(cookieValue)
	const b = new TextEncoder().encode(expectedHmacString)

	if (a.length !== b.length) {
		return false
	}

	return timingSafeEqual(a, b)
}

/** Create a Set-Cookie header string for the challenge cookie. */
export function createCookieHeader(hmacValue: string, isProdArg: boolean): string {
	const cookie = new Cookie({
		name: getCookieName(isProdArg),
		value: hmacValue,
		httpOnly: true,
		sameSite: "strict",
		maxAge: 300, // 5 minutes
		path: "/vault",
		secure: isProdArg,
	})

	return cookie.toString()
}

/** Returns a Set-Cookie header string that clears the challenge cookie. */
export function clearCookieHeader(isProdArg: boolean): string {
	const cookie = new Cookie({
		name: getCookieName(isProdArg),
		value: "",
		httpOnly: true,
		sameSite: "strict",
		maxAge: 0,
		path: "/vault",
		secure: isProdArg,
	})

	return cookie.toString()
}
