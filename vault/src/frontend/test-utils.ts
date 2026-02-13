import type * as api from "@/api"

/**
 * Creates a mock IdentityService with all methods stubbed to throw by default.
 * Override specific methods as needed for your test.
 */
export function createMockClient(overrides: Partial<api.ClientInterface> = {}): api.ClientInterface {
	const notImplemented = (method: string) => () => {
		throw new Error(`Mock not implemented: ${method}`)
	}

	return {
		preLogin: notImplemented("preLogin"),
		registerStart: notImplemented("registerStart"),
		registerPoll: notImplemented("registerPoll"),
		registerVerifyLink: notImplemented("registerVerifyLink"),
		addPassword: notImplemented("addPassword"),
		changePassword: notImplemented("changePassword"),
		login: notImplemented("login"),
		getVault: notImplemented("getVault"),
		saveVaultData: notImplemented("saveVaultData"),
		logout: notImplemented("logout"),
		getSession: notImplemented("getSession"),
		changeEmailStart: notImplemented("changeEmailStart"),
		changeEmailPoll: notImplemented("changeEmailPoll"),
		changeEmailVerifyLink: notImplemented("changeEmailVerifyLink"),
		webAuthnRegisterStart: notImplemented("webAuthnRegisterStart"),
		webAuthnRegisterComplete: notImplemented("webAuthnRegisterComplete"),
		webAuthnLoginStart: notImplemented("webAuthnLoginStart"),
		webAuthnLoginComplete: notImplemented("webAuthnLoginComplete"),
		webAuthnVaultStore: notImplemented("webAuthnVaultStore"),
		...overrides,
	}
}

/**
 * Creates a mock client where all methods return empty success responses.
 * Useful as a base when you only care about specific method behaviors.
 */
export function createSuccessMockClient(overrides: Partial<api.ClientInterface> = {}): api.ClientInterface {
	return {
		preLogin: async () => ({ exists: false }),
		registerStart: async () => ({ message: "ok", challengeId: "test-challenge" }),
		registerPoll: async () => ({ verified: false }),
		registerVerifyLink: async () => ({ verified: true, email: "test@example.com" }),
		addPassword: async () => ({ success: true }),
		changePassword: async () => ({ success: true }),
		login: async () => ({ success: true, userId: "user-1", vault: undefined }),
		getVault: async () => ({}),
		saveVaultData: async () => ({ success: true }),
		logout: async () => ({ success: true }),
		getSession: async () => ({ authenticated: false }),
		changeEmailStart: async () => ({ message: "ok", challengeId: "change-challenge" }),
		changeEmailPoll: async () => ({ verified: false }),
		changeEmailVerifyLink: async () => ({ verified: true, newEmail: "new@example.com" }),
		webAuthnRegisterStart: async () => ({
			challenge: "challenge",
			rp: { name: "test", id: "test" },
			user: { id: "id", name: "name", displayName: "name" },
			pubKeyCredParams: [],
		}),
		webAuthnRegisterComplete: async () => ({
			success: true,
			credentialId: "cred-1",
			backupEligible: true,
			backupState: true,
			prfEnabled: true,
		}),
		webAuthnLoginStart: async () => ({ challenge: "challenge", allowCredentials: [] }),
		webAuthnLoginComplete: async () => ({ success: true, userId: "user-1", vault: null }),
		webAuthnVaultStore: async () => ({ success: true }),
		...overrides,
	}
}
