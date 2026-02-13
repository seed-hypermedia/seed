import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as simplewebauthn from "@simplewebauthn/browser"
import * as blobs from "./blobs"
import { createStore } from "./store"
import { createMockClient } from "./test-utils"
import * as vaultDataMod from "./vault"

// Mock simplewebauthn browser functions (external dependency).
const mockStartRegistration = spyOn(simplewebauthn, "startRegistration")
const mockStartAuthentication = spyOn(simplewebauthn, "startAuthentication")

describe("Store", () => {
	describe("resetState", () => {
		test("resets all state to initial values", () => {
			const { state, actions } = createStore(createMockClient())

			state.email = "test@test.com"
			state.loading = true

			actions.resetState()

			expect(state.email).toBe("")
			expect(state.loading).toBe(false)
		})
	})

	describe("setters", () => {
		test("setEmail changes email", () => {
			const { state, actions } = createStore(createMockClient())

			actions.setEmail("new@email.com")

			expect(state.email).toBe("new@email.com")
		})

		test("setPassword changes password", () => {
			const { state, actions } = createStore(createMockClient())

			actions.setPassword("secret123")

			expect(state.password).toBe("secret123")
		})

		test("setConfirmPassword changes confirmPassword", () => {
			const { state, actions } = createStore(createMockClient())

			actions.setConfirmPassword("secret123")

			expect(state.confirmPassword).toBe("secret123")
		})

		test("setChallengeId changes challengeId", () => {
			const { state, actions } = createStore(createMockClient())

			actions.setChallengeId("test-challenge-id")

			expect(state.challengeId).toBe("test-challenge-id")
		})

		test("setError changes error", () => {
			const { state, actions } = createStore(createMockClient())

			actions.setError("Something went wrong")

			expect(state.error).toBe("Something went wrong")
		})
	})

	describe("handlePreLogin", () => {
		test("navigates to verify-pending when user does not exist", async () => {
			const client = createMockClient({
				preLogin: async () => ({ exists: false }),
				registerStart: async () => ({ message: "ok", challengeId: "test-challenge" }),
				registerPoll: async () => ({ verified: false }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.email = "new@user.com"

			await actions.handlePreLogin()

			expect(navigate).toHaveBeenCalledWith("/verify/pending")
			expect(state.challengeId).toBe("test-challenge")
		})

		test("navigates to login when user exists", async () => {
			const client = createMockClient({
				preLogin: async () => ({ exists: true, hasPassword: true }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.email = "existing@user.com"

			await actions.handlePreLogin()

			expect(navigate).toHaveBeenCalledWith("/login")
			expect(state.userHasPassword).toBe(true)
		})

		test("sets error on fetch failure", async () => {
			const client = createMockClient({
				preLogin: async () => {
					throw new Error("Network error")
				},
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.email = "test@user.com"

			await actions.handlePreLogin()

			expect(state.error).toBe("Connection failed. Please try again.")
			expect(navigate).not.toHaveBeenCalled()
		})

		test("sets loading state correctly", async () => {
			let loadingDuringFetch = false
			const { state, actions } = createStore(
				createMockClient({
					preLogin: async () => {
						loadingDuringFetch = state.loading
						return { exists: false }
					},
					registerStart: async () => ({ message: "ok", challengeId: "c" }),
					registerPoll: async () => ({ verified: false }),
				}),
			)

			await actions.handlePreLogin()

			await actions.handlePreLogin()

			expect(loadingDuringFetch).toBe(true)
			expect(state.loading).toBe(false)
		})
	})

	describe("checkSession", () => {
		const originalLocation = window.location

		// Mock window.location for these tests
		beforeEach(() => {
			// @ts-expect-error
			delete window.location
			// @ts-expect-error
			window.location = { pathname: "/" }
		})

		afterEach(() => {
			window.location = originalLocation as any
		})

		test("does not redirect if authenticated but keys missing", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			await actions.checkSession()

			expect(navigate).not.toHaveBeenCalled()
			expect(state.session?.authenticated).toBe(true)
			expect(state.sessionChecked).toBe(true)
		})

		test("does not redirect if authenticated with keys", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.decryptedDEK = new Uint8Array(32)
			window.location.pathname = "/vault"
			await actions.checkSession()

			expect(navigate).not.toHaveBeenCalled()
			expect(state.sessionChecked).toBe(true)
		})
	})

	describe("handleStartRegistration", () => {
		test("navigates to verify-pending on success and stores challengeId", async () => {
			const client = createMockClient({
				registerStart: async () => ({ message: "ok", challengeId: "test-challenge-123" }),
				registerPoll: async () => ({ verified: false }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.email = "new@user.com"

			await actions.handleStartRegistration()

			expect(navigate).toHaveBeenCalledWith("/verify/pending")
			expect(state.challengeId).toBe("test-challenge-123")
		})

		test("sets error on failure", async () => {
			const client = createMockClient({
				registerStart: async () => {
					throw new Error("Rate limited")
				},
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			await actions.handleStartRegistration()

			expect(state.error).toBe("Rate limited")
			expect(navigate).not.toHaveBeenCalled()
		})
	})

	describe("handleVerifyLink", () => {
		test("calls verify-link API with challengeId and token", async () => {
			let receivedChallengeId = ""
			let receivedToken = ""
			const client = createMockClient({
				registerVerifyLink: async (req) => {
					receivedChallengeId = req.challengeId
					receivedToken = req.token
					return { verified: true, email: "test@example.com" }
				},
			})
			const { state, actions } = createStore(client)

			await actions.handleVerifyLink("test-challenge-123", "test-token-456")

			expect(receivedChallengeId).toBe("test-challenge-123")
			expect(receivedToken).toBe("test-token-456")
			expect(state.email).toBe("test@example.com")
		})

		test("sets error on invalid token", async () => {
			const client = createMockClient({
				registerVerifyLink: async () => {
					throw new Error("Invalid or expired link")
				},
			})
			const { state, actions } = createStore(client)

			await actions.handleVerifyLink("invalid-challenge", "invalid-token")

			expect(state.error).toBe("Invalid or expired link")
		})
	})

	describe("handleSetPassword", () => {
		test("validates password match", async () => {
			const { state, actions } = createStore(createMockClient())
			state.password = "password1"
			state.confirmPassword = "password2"

			await actions.handleSetPassword()

			expect(state.error).toBe("Passwords do not match")
		})

		test("validates password strength", async () => {
			const { state, actions } = createStore(createMockClient())

			// Use a genuinely weak password (< 8 chars).
			state.password = "weak"
			state.confirmPassword = "weak"

			await actions.handleSetPassword()

			expect(state.error).toContain("too weak")
		})
	})

	describe("handleLogout", () => {
		test("resets session state and navigates to pre-login", async () => {
			const client = createMockClient({
				logout: async () => ({ success: true }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.session = { authenticated: true, email: "test@test.com" }
			state.decryptedDEK = new Uint8Array(64)
			state.password = "secret"

			await actions.handleLogout()

			expect(state.session).toBeNull()
			expect(state.decryptedDEK).toBeNull()
			expect(state.password).toBe("")
			expect(navigate).toHaveBeenCalledWith("/")
		})
	})

	describe("handleSetPasskey", () => {
		test("failed registration should not clear session if it persists", async () => {
			// Suppress console.error for this test since we're simulating a cancel error.
			const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})

			const calls: string[] = []

			const client = createMockClient({
				getSession: async () => {
					calls.push("getSession")
					return { authenticated: true, userId: "test-user", email: "test@passkey.com" }
				},
				webAuthnRegisterStart: async () => {
					calls.push("webAuthnRegisterStart")
					return {
						challenge: "abc123",
						rp: { name: "test", id: "test" },
						user: { id: "id", name: "name", displayName: "name" },
						pubKeyCredParams: [],
					}
				},
				webAuthnRegisterComplete: async () => {
					calls.push("webAuthnRegisterComplete")
					return {
						success: true,
						credentialId: "cred123",
						backupEligible: true,
						backupState: true,
						prfEnabled: true,
					}
				},
				webAuthnLoginStart: async () => {
					calls.push("webAuthnLoginStart")
					return { challenge: "authchallenge", allowCredentials: [] }
				},
				webAuthnLoginComplete: async () => {
					calls.push("webAuthnLoginComplete")
					return { success: true, userId: "test-user", vault: null }
				},
				webAuthnVaultStore: async () => {
					calls.push("webAuthnVaultStore")
					return { success: true }
				},
			})

			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.email = "test@passkey.com"
			// Pre-set session as if obtained from previous step
			state.session = { authenticated: true, hasPassword: false, hasPasskeys: false }

			// First attempt: simulate user cancel at startRegistration.
			mockStartRegistration.mockRejectedValueOnce(new Error("The operation was canceled"))

			await actions.handleSetPasskey()

			expect(state.error).toContain("try again")

			// Reset for second attempt
			state.error = ""
			calls.length = 0

			// Second attempt: startRegistration succeeds with PRF.
			mockStartRegistration.mockResolvedValueOnce({
				id: "cred123",
				rawId: "cred123",
				type: "public-key",
				response: {
					clientDataJSON: "mock-client-data",
					attestationObject: "mock-attestation",
				},
				authenticatorAttachment: "platform",
				clientExtensionResults: { prf: { enabled: true } },
			} as unknown as Awaited<ReturnType<typeof simplewebauthn.startRegistration>>)

			// PRF not in registration, so we try auth.
			mockStartAuthentication.mockResolvedValueOnce({
				id: "cred123",
				rawId: "cred123",
				type: "public-key",
				response: {
					clientDataJSON: "mock-client-data",
					authenticatorData: "mock-auth-data",
					signature: "mock-signature",
				},
				authenticatorAttachment: "platform",
				clientExtensionResults: {
					prf: {
						results: {
							first: new Uint8Array(32).buffer,
						},
					},
				},
			} as unknown as Awaited<ReturnType<typeof simplewebauthn.startAuthentication>>)

			await actions.handleSetPasskey()

			expect(calls).toContain("webAuthnRegisterStart")
			expect(state.error).toBe("")
			expect(state.decryptedDEK).not.toBeNull()

			// Restore.
			consoleErrorSpy.mockRestore()
			mockStartRegistration.mockReset()
			mockStartAuthentication.mockReset()
		})
	})
})

describe("delegation flow", () => {
	const originalLocation = window.location

	function makeDelegationUrl(
		clientId = "https://example.com",
		redirectUri = "https://example.com/callback",
		sessionKey?: string,
	): URL {
		// Generate a real session key principal if not provided.
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

	beforeEach(() => {
		// @ts-expect-error
		delete window.location
		// @ts-expect-error
		window.location = { href: "", pathname: "/" }
	})

	afterEach(() => {
		window.location = originalLocation as any
	})

	test("parseDelegationFromUrl stores valid request", () => {
		const { state, actions } = createStore(createMockClient())
		const url = makeDelegationUrl()

		actions.parseDelegationFromUrl(url)

		expect(state.delegationRequest).not.toBeNull()
		expect(state.delegationRequest!.clientId).toBe("https://example.com")
		expect(state.delegationRequest!.redirectUri).toBe("https://example.com/callback")
		expect(state.delegationRequest!.sessionKeyPrincipal).toBeTruthy()
		expect(state.error).toBe("")
	})

	test("parseDelegationFromUrl sets error on invalid params", () => {
		const { state, actions } = createStore(createMockClient())
		// http non-localhost is invalid for client_id.
		const url = makeDelegationUrl("http://evil.com", "http://evil.com/callback")

		actions.parseDelegationFromUrl(url)

		expect(state.delegationRequest).toBeNull()
		expect(state.error).toContain("HTTPS")
	})

	test("parseDelegationFromUrl ignores URL without delegation params", () => {
		const { state, actions } = createStore(createMockClient())
		const url = new URL("https://vault.example.com/some-page")

		actions.parseDelegationFromUrl(url)

		expect(state.delegationRequest).toBeNull()
		expect(state.error).toBe("")
	})

	test("completeDelegation creates capability and redirects", async () => {
		const saveVaultDataCalls: unknown[] = []
		const client = createMockClient({
			saveVaultData: async (req) => {
				saveVaultDataCalls.push(req)
				return { success: true }
			},
		})
		const { state, actions } = createStore(client)

		// Set up vault state.
		const kp = blobs.generateKeyPair()
		const sessionKp = blobs.generateKeyPair()
		const ts = Date.now()
		const profile = blobs.createProfile(kp, { name: "Test" }, ts)

		state.decryptedDEK = new Uint8Array(32)
		state.vaultData = {
			version: 1,
			accounts: [
				{
					seed: kp.privateKey,
					profile: profile.decoded,
					createdAt: ts,
				},
			],
			delegations: [],
		}
		state.selectedAccountIndex = 0
		state.vaultVersion = 0

		// Set up delegation request.
		state.delegationRequest = {
			clientId: "https://example.com",
			redirectUri: "https://example.com/callback",
			sessionKeyPrincipal: blobs.principalToString(sessionKp.principal),
		}

		await actions.completeDelegation()

		// saveVaultData should have been called.
		expect(saveVaultDataCalls.length).toBe(1)

		// Should redirect to callback URL.
		expect(window.location.href).toContain("https://example.com/callback")
		expect(window.location.href).toContain("capability=")
		expect(window.location.href).toContain("account=")

		// Delegation state should be cleared.
		expect(state.delegationRequest).toBeNull()
		expect(state.delegationConsented).toBe(false)
		expect(state.error).toBe("")
	})

	test("completeDelegation errors without selected account", async () => {
		const { state, actions } = createStore(createMockClient())

		state.decryptedDEK = new Uint8Array(32)
		state.vaultData = vaultDataMod.emptyVault()
		state.selectedAccountIndex = -1
		state.delegationRequest = {
			clientId: "https://example.com",
			redirectUri: "https://example.com/callback",
			sessionKeyPrincipal: blobs.principalToString(blobs.generateKeyPair().principal),
		}

		// Suppress console.error for expected error.
		const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})

		await actions.completeDelegation()

		expect(state.error).toContain("No account selected")

		consoleErrorSpy.mockRestore()
	})

	test("cancelDelegation redirects with error param", () => {
		const { state, actions } = createStore(createMockClient())

		state.delegationRequest = {
			clientId: "https://example.com",
			redirectUri: "https://example.com/callback",
			sessionKeyPrincipal: blobs.principalToString(blobs.generateKeyPair().principal),
		}

		actions.cancelDelegation()

		expect(window.location.href).toContain("https://example.com/callback")
		expect(window.location.href).toContain("error=access_denied")
		expect(state.delegationRequest).toBeNull()
		expect(state.delegationConsented).toBe(false)
	})
})
