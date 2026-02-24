import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as base64 from "@shm/shared/base64"
import * as blobs from "@shm/shared/blobs"
import * as simplewebauthn from "@simplewebauthn/browser"
import { createStore } from "./store"
import { createMockClient, createSuccessMockClient } from "./test-utils"
import * as vault from "./vault"

// Mock simplewebauthn browser functions (external dependency).
const mockStartRegistration = spyOn(simplewebauthn, "startRegistration")
const mockStartAuthentication = spyOn(simplewebauthn, "startAuthentication")

/**
 * Creates vault state with the given number of accounts, each with delegations.
 * Returns the state object and references to principals for assertions.
 */
async function makeVaultState(accountCount: number) {
	const keyPairs = Array.from({ length: accountCount }, () => blobs.generateNobleKeyPair())
	const profiles = await Promise.all(keyPairs.map((kp, i) => blobs.createProfile(kp, { name: `Acc ${i}` }, Date.now())))

	// Create cross-account capabilities: each account delegates to the next one's principal.
	const capabilities = await Promise.all(
		keyPairs.map((kp, i) => {
			const targetIdx = (i + 1) % accountCount
			return blobs.createCapability(kp, keyPairs[targetIdx]!.principal, "WRITER", 0)
		}),
	)

	const accounts: vault.State["accounts"] = keyPairs.map((_kp, i) => ({
		seed: keyPairs[i]!.seed,
		profile: { cid: profiles[i]!.cid, decoded: profiles[i]!.decoded },
		createTime: Date.now(),
		delegations: [
			{
				clientId: String(i),
				createTime: 0,
				deviceType: "desktop" as const,
				capability: { cid: capabilities[i]!.cid, decoded: capabilities[i]!.decoded },
			},
		],
	}))

	const principals = keyPairs.map((kp) => blobs.principalToString(kp.principal))

	return {
		vaultData: { version: 1 as const, accounts },
		principals,
	}
}

describe("Store", () => {
	describe("handlePreLogin", () => {
		test("navigates to verify-pending when user does not exist", async () => {
			const client = createMockClient({
				preLogin: async () => ({ exists: false }),
				registerStart: async () => ({
					message: "ok",
					challengeId: "test-challenge",
				}),
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
				getSession: async () => ({
					authenticated: true,
					relyingPartyOrigin: "https://vault.example.com",
					email: "test@test.com",
				}),
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
				getSession: async () => ({
					authenticated: true,
					relyingPartyOrigin: "https://vault.example.com",
					email: "test@test.com",
				}),
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
				registerStart: async () => ({
					message: "ok",
					challengeId: "test-challenge-123",
				}),
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

			state.session = { authenticated: true, relyingPartyOrigin: "https://vault.example.com", email: "test@test.com" }
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
		test("sets error when user cancels registration prompt", async () => {
			const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
			const { state, actions } = createStore(
				createSuccessMockClient({
					getSession: async () => ({
						authenticated: true,
						relyingPartyOrigin: "https://vault.example.com",
						email: "test@passkey.com",
					}),
				}),
			)
			state.session = {
				authenticated: true,
				relyingPartyOrigin: "https://vault.example.com",
			}

			mockStartRegistration.mockRejectedValueOnce(new Error("The operation was canceled"))

			await actions.handleSetPasskey()

			expect(state.error).toContain("try again")
			expect(state.session).not.toBeNull()

			consoleErrorSpy.mockRestore()
			mockStartRegistration.mockReset()
		})

		test("completes registration with PRF from auth fallback", async () => {
			const { state, actions } = createStore(
				createSuccessMockClient({
					getSession: async () => ({
						authenticated: true,
						relyingPartyOrigin: "https://vault.example.com",
						email: "test@passkey.com",
					}),
				}),
			)
			state.email = "test@passkey.com"
			state.session = {
				authenticated: true,
				relyingPartyOrigin: "https://vault.example.com",
			}

			// Registration succeeds but without PRF output.
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

			// Auth fallback provides PRF output.
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

			expect(state.error).toBe("")
			expect(state.decryptedDEK).not.toBeNull()

			mockStartRegistration.mockReset()
			mockStartAuthentication.mockReset()
		})
	})

	describe("createAccount", () => {
		test("creates an account when description is omitted", async () => {
			const saveVaultDataCalls: unknown[] = []
			const client = createMockClient({
				saveVaultData: async (req) => {
					saveVaultDataCalls.push(req)
					return { success: true }
				},
			})
			const { state, actions } = createStore(client)

			state.decryptedDEK = new Uint8Array(32)
			state.vaultData = {
				version: 1,
				accounts: [],
			}
			state.selectedAccountIndex = -1
			state.creatingAccount = true

			await actions.createAccount("Test")

			expect(state.vaultData.accounts.length).toBe(1)
			expect(state.selectedAccountIndex).toBe(0)
			expect(state.creatingAccount).toBe(false)
			expect(state.error).toBe("")
			expect(saveVaultDataCalls.length).toBe(1)
		})

		test("rolls back local state when vault save fails", async () => {
			const client = createMockClient({
				saveVaultData: async () => ({ success: true }),
			})
			const { state, actions } = createStore(client)
			const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
			const serializeSpy = spyOn(vault, "serialize").mockRejectedValueOnce(new Error("dag-cbor failed"))

			state.decryptedDEK = new Uint8Array(32)
			state.vaultData = {
				version: 1,
				accounts: [],
			}
			state.selectedAccountIndex = -1
			state.creatingAccount = true

			await actions.createAccount("Test", "Description")

			expect(state.vaultData.accounts.length).toBe(0)
			expect(state.selectedAccountIndex).toBe(-1)
			expect(state.creatingAccount).toBe(true)
			expect(state.error).toContain("dag-cbor failed")
			serializeSpy.mockRestore()
			consoleErrorSpy.mockRestore()
		})
	})

	describe("deleteAccount", () => {
		test("removes account and related delegations, and updates indexes", async () => {
			const saveVaultDataCalls: unknown[] = []
			const client = createMockClient({
				saveVaultData: async (req) => {
					saveVaultDataCalls.push(req)
					return { success: true }
				},
			})
			const { state, actions } = createStore(client)

			const { vaultData } = await makeVaultState(3)

			// Add extra cross-delegation to account 1 for richer coverage.
			const extraCap = await blobs.createCapability(
				blobs.generateNobleKeyPair(), // issuer doesn't matter for this test
				blobs.generateNobleKeyPair().principal,
				"WRITER",
				0,
			)
			vaultData.accounts[1]!.delegations.push({
				clientId: "1b",
				createTime: 0,
				deviceType: "mobile",
				capability: { cid: extraCap.cid, decoded: extraCap.decoded },
			})

			state.decryptedDEK = new Uint8Array(32)
			state.vaultData = vaultData
			state.selectedAccountIndex = 1

			const principal2 = blobs.principalToString(state.vaultData!.accounts[1]!.profile.decoded.signer)
			await actions.deleteAccount(principal2)

			expect(state.vaultData!.accounts.length).toBe(2)
			expect(state.vaultData!.accounts[0]!.profile.decoded.name).toBe("Acc 0")
			expect(state.vaultData!.accounts[1]!.profile.decoded.name).toBe("Acc 2")

			expect(state.selectedAccountIndex).toBe(0)
			expect(saveVaultDataCalls.length).toBe(1)
		})
	})

	describe("reorderAccount", () => {
		test("moves account correctly, shifts selection and delegations", async () => {
			const saveVaultDataCalls: unknown[] = []
			const client = createMockClient({
				saveVaultData: async (req) => {
					saveVaultDataCalls.push(req)
					return { success: true }
				},
			})
			const { state, actions } = createStore(client)

			const { vaultData, principals } = await makeVaultState(3)
			state.decryptedDEK = new Uint8Array(32)
			state.vaultData = vaultData
			state.selectedAccountIndex = 0

			// Move index 0 to index 2
			await actions.reorderAccount(principals[0]!, principals[2]!)

			expect(state.vaultData!.accounts.length).toBe(3)
			expect(state.vaultData!.accounts[0]!.profile.decoded.name).toBe("Acc 1")
			expect(state.vaultData!.accounts[1]!.profile.decoded.name).toBe("Acc 2")
			expect(state.vaultData!.accounts[2]!.profile.decoded.name).toBe("Acc 0")

			// The selected account was 0 ("Acc 0"). It moved to index 2.
			expect(state.selectedAccountIndex).toBe(2)

			// Delegations correctly follow their respective accounts
			expect(state.vaultData!.accounts[0]!.delegations[0]!.clientId).toBe("1")
			expect(state.vaultData!.accounts[1]!.delegations[0]!.clientId).toBe("2")
			expect(state.vaultData!.accounts[2]!.delegations[0]!.clientId).toBe("0")

			expect(saveVaultDataCalls.length).toBe(1)
		})
	})
})

describe("delegation flow", () => {
	const originalLocation = window.location

	async function makeSignedDelegationUrl(
		clientId = "https://example.com",
		redirectUri = "https://example.com/callback",
		vaultOrigin = "https://vault.example.com",
	) {
		const keyPair = (await crypto.subtle.generateKey("Ed25519" as unknown as AlgorithmIdentifier, false, [
			"sign",
			"verify",
		])) as CryptoKeyPair
		const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
		const sessionKeyPrincipal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
		const state = "AAAAAAAAAAAAAAAAAAAAAA"
		const ts = Date.now()
		const unsignedUrl = new URL(`${vaultOrigin}/delegate`)
		unsignedUrl.searchParams.set("client_id", clientId)
		unsignedUrl.searchParams.set("redirect_uri", redirectUri)
		unsignedUrl.searchParams.set("session_key", sessionKeyPrincipal)
		unsignedUrl.searchParams.set("state", state)
		unsignedUrl.searchParams.set("ts", String(ts))
		const payload = new TextEncoder().encode(unsignedUrl.toString())
		const proof = new Uint8Array(
			await crypto.subtle.sign(
				"Ed25519" as unknown as AlgorithmIdentifier,
				keyPair.privateKey,
				payload as ArrayBufferView<ArrayBuffer>,
			),
		)
		const proofBase64 = base64.encode(proof)
		const delimiter = unsignedUrl.search ? "&" : "?"
		const url = new URL(`${unsignedUrl.toString()}${delimiter}proof=${encodeURIComponent(proofBase64)}`)
		return { url, state }
	}

	async function setupDelegationState(store: ReturnType<typeof createStore>, delegationUrl: URL) {
		store.actions.parseDelegationFromUrl(delegationUrl)

		const kp = blobs.generateNobleKeyPair()
		const ts = Date.now()
		const profile = await blobs.createProfile(kp, { name: "Test" }, ts)

		store.state.decryptedDEK = new Uint8Array(32)
		store.state.vaultData = {
			version: 1,
			accounts: [
				{
					seed: kp.seed,
					profile: { cid: profile.cid, decoded: profile.decoded },
					createTime: ts,
					delegations: [],
				},
			],
		}
		store.state.selectedAccountIndex = 0
		store.state.vaultVersion = 0
		store.state.relyingPartyOrigin = "https://vault.example.com"
	}

	beforeEach(() => {
		// @ts-expect-error
		delete window.location
		// @ts-expect-error
		window.location = { href: "", pathname: "/", origin: "https://vault.example.com" }
	})

	afterEach(() => {
		window.location = originalLocation as any
	})

	test("completes delegation with signed protocol request and redirects with state", async () => {
		const saveVaultDataCalls: unknown[] = []
		const client = createMockClient({
			saveVaultData: async (req) => {
				saveVaultDataCalls.push(req)
				return { success: true }
			},
		})
		const store = createStore(client)
		const request = await makeSignedDelegationUrl()
		await setupDelegationState(store, request.url)

		await store.actions.completeDelegation()

		expect(saveVaultDataCalls.length).toBe(1)
		expect(window.location.href).toContain("https://example.com/callback")
		expect(window.location.href).toContain("data=")
		expect(window.location.href).toContain(`state=${request.state}`)
		expect(store.state.vaultData!.accounts[0]!.delegations.length).toBe(1)
		expect(store.state.vaultData!.accounts[0]!.delegations[0]!.deviceType).toBeDefined()
		expect(store.state.delegationRequest).toBeNull()
		expect(store.state.delegationConsented).toBe(false)
		expect(store.state.error).toBe("")
	})

	test("surfaces serialization errors and does not redirect during delegation completion", async () => {
		const store = createStore(createMockClient())
		const request = await makeSignedDelegationUrl()
		await setupDelegationState(store, request.url)

		const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const serializeSpy = spyOn(vault, "serialize").mockRejectedValueOnce(new Error("dag-cbor failed"))

		await store.actions.completeDelegation()

		expect(store.state.error).toContain("dag-cbor failed")
		expect(store.state.delegationRequest).not.toBeNull()
		expect(window.location.href).toBe("")
		serializeSpy.mockRestore()
		consoleErrorSpy.mockRestore()
	})

	test("rejects tampered proof during delegation completion", async () => {
		const store = createStore(createMockClient())
		const request = await makeSignedDelegationUrl()
		request.url.searchParams.set("proof", "bad-proof")
		await setupDelegationState(store, request.url)

		await store.actions.completeDelegation()

		expect(store.state.error).toContain("Invalid proof signature encoding")
	})

	test("cancelDelegation redirects with error param", async () => {
		const { state, actions } = createStore(createMockClient())
		const sessionKeyPair = blobs.generateNobleKeyPair()

		state.delegationRequest = {
			originalUrl:
				"https://vault.example.com/delegate?client_id=https%3A%2F%2Fexample.com&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&session_key=missing&state=AAAAAAAAAAAAAAAAAAAAAA&ts=1700000000000&proof=cA",
			clientId: "https://example.com",
			redirectUri: "https://example.com/callback",
			sessionKeyPrincipal: blobs.principalToString(sessionKeyPair.principal),
			state: "AAAAAAAAAAAAAAAAAAAAAA",
			requestTs: Date.now(),
			proof: "cA",
			vaultOrigin: "https://vault.example.com",
		}

		actions.cancelDelegation()

		expect(window.location.href).toContain("https://example.com/callback")
		expect(window.location.href).toContain("error=access_denied")
		expect(state.delegationRequest).toBeNull()
		expect(state.delegationConsented).toBe(false)
	})
})
