import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import * as challenge from "./challenge"

describe("challenge", () => {
	const secret = randomBytes(32)
	const challengeStr = "some-challenge"
	const sessionId = "some-session-id"

	test("computeHmac produces consistent output", () => {
		const hmac1 = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		const hmac2 = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		expect(hmac1).toBe(hmac2)
	})

	test("verifyHmac accepts valid hmac", () => {
		const hmac = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		expect(challenge.verifyHmac(secret, hmac, "webauthn-login", challengeStr)).toBe(true)
	})

	test("verifyHmac rejects invalid hmac", () => {
		const hmac = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		expect(challenge.verifyHmac(secret, "invalid-hmac", "webauthn-login", challengeStr)).toBe(false)
		expect(challenge.verifyHmac(secret, `${hmac}a`, "webauthn-login", challengeStr)).toBe(false)
	})

	test("verifyHmac checks purpose", () => {
		const hmac = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		// Should produce different hmac for different purpose
		expect(challenge.verifyHmac(secret, hmac, "webauthn-register", challengeStr, sessionId)).toBe(false)
	})

	test("verifyHmac checks challenge", () => {
		const hmac = challenge.computeHmac(secret, "webauthn-login", challengeStr)
		expect(challenge.verifyHmac(secret, hmac, "webauthn-login", "other-challenge")).toBe(false)
	})

	test("webauthn-register requires sessionId", () => {
		expect(() => challenge.computeHmac(secret, "webauthn-register", challengeStr)).toThrow()
	})

	test("verifyHmac with sessionId binding", () => {
		const hmac = challenge.computeHmac(secret, "webauthn-register", challengeStr, sessionId)
		expect(challenge.verifyHmac(secret, hmac, "webauthn-register", challengeStr, sessionId)).toBe(true)
		expect(challenge.verifyHmac(secret, hmac, "webauthn-register", challengeStr, "other-session")).toBe(false)
	})

	test("createCookieHeader format", () => {
		const cookie = challenge.createCookieHeader("some-hmac", false)
		expect(cookie).toContain("wac=some-hmac")
		expect(cookie).toContain("HttpOnly")
		expect(cookie).toContain("SameSite=Strict")
		expect(cookie).toContain("Max-Age=300")
		expect(cookie).not.toContain("Secure")
	})

	test("createCookieHeader format prod", () => {
		const cookie = challenge.createCookieHeader("some-hmac", true)
		expect(cookie).toContain(`${challenge.getCookieName(true)}=some-hmac`)
		expect(cookie).toContain("Secure")
	})

	test("clearCookieHeader format", () => {
		const cookie = challenge.clearCookieHeader(false)
		expect(cookie).toContain("wac=")
		expect(cookie).toContain("Max-Age=0")
	})
})
