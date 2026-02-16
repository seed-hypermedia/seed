import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as blobs from "./blobs"
import { createStore, type SessionInfo } from "./store"
import { createMockClient } from "./test-utils"

function makeDelegationUrl(
	clientId = "https://example.com",
	redirectUri = "https://example.com/callback",
	sessionKey?: string,
): URL {
	if (!sessionKey) {
		const kp = blobs.generateKeyPair()
		sessionKey = blobs.principalToString(kp.principal)
	}
	const url = new URL("https://vault.example.com/delegate")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("session_key", sessionKey)
	return url
}

describe("delegation flow - scenario 3: account exists but not signed in", () => {
	const originalLocation = window.location

	beforeEach(() => {
		delete (window as any).location
		window.location = { href: "", pathname: "/", search: "" } as any
	})

	afterEach(() => {
		window.location = originalLocation as any
	})

	test("BUG: visiting /delegate while not authenticated - delegationRequest stays null because parse is never called", () => {
		const client = createMockClient()
		const { state } = createStore(client)

		const delegationUrl = makeDelegationUrl()
		window.location.href = delegationUrl.toString()
		window.location.pathname = "/delegate"
		window.location.search = delegationUrl.search

		expect(state.session).toBeNull()
		expect(state.sessionChecked).toBe(false)
		expect(state.delegationRequest).toBeNull()

		state.sessionChecked = true
		state.session = null

		expect((state.session as SessionInfo | null)?.authenticated).toBeFalsy()
		expect(state.delegationRequest).toBeNull()

		const kp = blobs.generateKeyPair()
		const ts = Date.now()
		const profile = blobs.createProfile(kp, { name: "Test User" }, ts)
		state.vaultData = {
			version: 1,
			accounts: [{ seed: kp.privateKey, profile: profile.decoded, createdAt: ts }],
			delegations: [],
		}

		state.session = {
			authenticated: true,
			email: "test@example.com",
			hasPassword: true,
		}
		state.decryptedDEK = new Uint8Array(32)

		expect(state.session?.authenticated).toBe(true)
		expect(state.decryptedDEK).not.toBeNull()
		expect(state.delegationRequest).toBeNull()
	})

	test("WORKAROUND: if parseDelegationFromUrl is called before login, delegationRequest persists", () => {
		const client = createMockClient()
		const { state, actions } = createStore(client)

		const delegationUrl = makeDelegationUrl()
		actions.parseDelegationFromUrl(delegationUrl)

		expect(state.delegationRequest).not.toBeNull()

		state.sessionChecked = true
		state.session = null

		state.session = {
			authenticated: true,
			email: "test@example.com",
			hasPassword: true,
		}
		state.decryptedDEK = new Uint8Array(32)

		expect(state.session?.authenticated).toBe(true)
		expect(state.decryptedDEK).not.toBeNull()
		expect(state.delegationRequest).not.toBeNull()
	})
})
