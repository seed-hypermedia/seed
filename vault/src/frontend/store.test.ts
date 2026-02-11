import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as simplewebauthn from "@simplewebauthn/browser"
import { createStore } from "./store"
import { createMockClient } from "./test-utils"

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
			window.location = { pathname: "/vault" }
		})

		afterEach(() => {
			window.location = originalLocation as any
		})

		test("redirects to locked if authenticated but keys missing", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			await actions.checkSession()

			expect(navigate).toHaveBeenCalledWith("/locked")
		})

		test("stores returnTo if redirected to locked from a deep link", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			// Simulate being on a deep link (with /vault base path prefix)
			window.location.pathname = "/vault/email/change"

			await actions.checkSession()

			expect(state.returnTo).toBe("/email/change")
			expect(navigate).toHaveBeenCalledWith("/locked")
		})

		test("redirects to root if authenticated and keys present (default)", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.decryptedDEK = new Uint8Array(32)
			window.location.pathname = "/vault/locked"
			await actions.checkSession()

			expect(navigate).toHaveBeenCalledWith("/")
		})

		test("redirects to returnTo if set and keys present", async () => {
			const client = createMockClient({
				getSession: async () => ({ authenticated: true, email: "test@test.com" }),
			})
			const { state, actions, navigator } = createStore(client)
			const navigate = mock()
			navigator.setNavigate(navigate)

			state.decryptedDEK = new Uint8Array(32)
			state.returnTo = "/email/change"
			window.location.pathname = "/vault/locked"
			await actions.checkSession()

			expect(navigate).toHaveBeenCalledWith("/email/change")
			expect(state.returnTo).toBe("")
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
		test("on retry after cancel, should skip complete-passkey if session exists", async () => {
			// Suppress console.error for this test since we're simulating a cancel error.
			const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})

			// Track calls to verify behavior.
			const calls: string[] = []

			// Separate counter for getSession that doesn't get reset.
			// After first handleSetPasskey (cancelled), user has a session from registerCompletePasskey.
			let getSessionCallCount = 0

			const client = createMockClient({
				getSession: async () => {
					getSessionCallCount++
					calls.push("getSession")
					// First call (during first attempt): not authenticated.
					// All subsequent calls: authenticated (user was created by registerCompletePasskey).
					if (getSessionCallCount === 1) {
						return { authenticated: false }
					}
					return { authenticated: true, userId: "test-user", email: "test@passkey.com" }
				},
				registerCompletePasskey: async () => {
					calls.push("registerCompletePasskey")
					return { success: true, userId: "test-user" }
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

			// First attempt: simulate user cancel at startRegistration.
			mockStartRegistration.mockRejectedValueOnce(new Error("The operation was canceled"))

			await actions.handleSetPasskey()

			// Error should be set from the cancel.
			expect(state.error).toContain("try again")
			expect(calls).toContain("registerCompletePasskey")

			// Reset for second attempt — only clear the calls tracking array, not getSessionCallCount.
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

			// Mock location to ensure checkSession redirects to root
			// @ts-expect-error
			window.location = { pathname: "/vault/login" }

			await actions.handleSetPasskey()

			// Key assertion: registerCompletePasskey should NOT be called again
			// because session is already authenticated from the first attempt.
			expect(calls).not.toContain("registerCompletePasskey")
			expect(state.error).toBe("")

			expect(navigate).toHaveBeenCalledWith("/")

			// Restore.
			consoleErrorSpy.mockRestore()
			mockStartRegistration.mockReset()
			mockStartAuthentication.mockReset()
		})
	})
})
