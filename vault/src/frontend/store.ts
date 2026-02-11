import * as webauthn from "@simplewebauthn/browser"
import { createContext, useContext } from "react"
import { proxy, useSnapshot } from "valtio"
import type * as api from "@/api"
import * as localCrypto from "./crypto"

export interface SessionInfo {
	authenticated: boolean
	userId?: string
	email?: string
	hasPassword?: boolean
}

/** Creates the initial state for the store. */
export function initialState() {
	return {
		email: "",
		password: "",
		confirmPassword: "",
		challengeId: "", // For polling during magic link verification.
		error: "",
		loading: false,
		session: null as SessionInfo | null,
		decryptedDEK: null as Uint8Array | null,
		passkeySupported: false,
		platformAuthAvailable: false,
		userHasPassword: true,
		vaultContent: "",
		vaultVersion: 0,
		newEmail: "", // For email change flow.
		emailChangeChallengeId: "", // For email change polling.
		returnTo: "", // Store the intended destination when redirected to locked/login.
	}
}

export type AppState = ReturnType<typeof initialState>

export interface Navigator {
	go(path: string): void
}

/** Strips the `/vault` base path prefix from a pathname. */
function stripBasePath(pathname: string): string {
	if (pathname.startsWith("/vault")) {
		const stripped = pathname.slice("/vault".length)
		return stripped === "" ? "/" : stripped
	}
	return pathname
}

/** Creates actions bound to a specific state proxy and client. */
function createActions(state: AppState, client: api.ClientInterface, navigator: Navigator) {
	const actions = {
		resetState() {
			Object.assign(state, initialState())
		},

		setEmail(email: string) {
			state.email = email
		},

		setPassword(password: string) {
			state.password = password
		},

		setConfirmPassword(confirmPassword: string) {
			state.confirmPassword = confirmPassword
		},

		setChallengeId(challengeId: string) {
			state.challengeId = challengeId
		},

		setError(error: string) {
			state.error = error
		},

		async checkPasskeySupport() {
			state.passkeySupported = localCrypto.isWebAuthnSupported()
			state.platformAuthAvailable = await localCrypto.isPlatformAuthenticatorAvailable()
		},

		async checkSession() {
			try {
				const data = await client.getSession()
				if (data.authenticated && data.email) {
					state.session = data
					state.email = data.email
					if (!state.decryptedDEK) {
						// Capture intended URL if we are forced to lock screen.
						// We check window.location.pathname directly as we are in the browser.
						const current = stripBasePath(window.location.pathname)
						if (current !== "/locked" && current !== "/login" && current !== "/") {
							state.returnTo = current
						}
						navigator.go("/locked")
					} else {
						if (state.returnTo) {
							const dest = state.returnTo
							state.returnTo = ""
							navigator.go(dest)
						} else {
							const current = stripBasePath(window.location.pathname)
							if (["/", "/login", "/locked", "/auth/choose", "/password/set", "/verify/pending"].includes(current)) {
								navigator.go("/")
							}
						}
					}
				}
			} catch (e) {
				console.error("Session check failed:", e)
			}
		},

		async handlePreLogin() {
			state.error = ""
			state.loading = true

			try {
				const data = await client.preLogin({ email: state.email })

				if (data.exists) {
					// User exists, proceed to login.
					state.userHasPassword = data.hasPassword ?? false
					navigator.go("/login")
				} else {
					await actions.handleStartRegistration()
				}
			} catch (_e) {
				state.error = "Connection failed. Please try again."
			} finally {
				state.loading = false
			}
		},

		async handleStartRegistration() {
			state.error = ""
			state.loading = true

			try {
				const data = await client.registerStart({ email: state.email })
				state.challengeId = data.challengeId
				navigator.go("/verify/pending")
				actions.startPollingVerification()
			} catch (e) {
				state.error = (e as Error).message || "Registration failed"
			} finally {
				state.loading = false
			}
		},

		/**
		 * Polls the server to check if the magic link was clicked.
		 * Automatically proceeds to auth setup once verified.
		 */
		async startPollingVerification() {
			const pollInterval = 2000 // Poll every 2 seconds.
			const maxAttempts = 60 // 2 minutes max (matching link expiry).

			let attempts = 0

			const poll = async () => {
				if (!state.challengeId) return

				try {
					const data = await client.registerPoll({ challengeId: state.challengeId })

					if (data.verified) {
						navigator.go("/auth/choose")
						return
					}

					attempts++
					if (attempts < maxAttempts) {
						setTimeout(poll, pollInterval)
					} else {
						state.error = "Verification link expired. Please try again."
						navigator.go("/")
					}
				} catch (_e) {
					// Challenge expired or error - stop polling.
					state.error = "Verification failed or expired. Please try again."
					navigator.go("/")
				}
			}

			poll()
		},

		/**
		 * Called when user clicks the magic link. Verifies the token and shows confirmation.
		 */
		async handleVerifyLink(challengeId: string, token: string) {
			state.loading = true
			state.error = ""

			try {
				const data = await client.registerVerifyLink({ challengeId, token })
				state.email = data.email
			} catch (e) {
				state.error = (e as Error).message || "Verification failed"
			} finally {
				state.loading = false
			}
		},

		async handleSetPassword() {
			state.error = ""

			if (state.password !== state.confirmPassword) {
				state.error = "Passwords do not match"
				return
			}

			if (localCrypto.checkPasswordStrength(state.password) === 0) {
				state.error = "Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols."
				return
			}

			state.loading = true

			try {
				const salt = localCrypto.emailToSalt(state.email)
				const masterKey = await localCrypto.deriveKeyFromPassword(state.password, salt)

				const stretchedKey = await localCrypto.stretchKey(masterKey)
				const dek = localCrypto.generateDEK()
				const encryptedDEK = await localCrypto.encrypt(dek, stretchedKey)
				const authHash = await localCrypto.computeAuthHash(stretchedKey)

				await client.registerComplete({
					email: state.email,
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
					authHash: localCrypto.base64urlEncode(authHash),
				})

				state.decryptedDEK = dek
				await actions.checkSession()
			} catch (e) {
				console.error("Registration error:", e)
				state.error = (e as Error).message || "Registration failed. Please try again."
			} finally {
				state.loading = false
			}
		},

		async handleAddPassword() {
			state.error = ""

			if (!state.decryptedDEK) {
				state.error = "Vault must be unlocked first"
				return
			}

			if (state.password !== state.confirmPassword) {
				state.error = "Passwords do not match"
				return
			}

			if (localCrypto.checkPasswordStrength(state.password) === 0) {
				state.error = "Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols."
				return
			}

			state.loading = true

			try {
				const salt = localCrypto.emailToSalt(state.email)
				const masterKey = await localCrypto.deriveKeyFromPassword(state.password, salt)

				const stretchedKey = await localCrypto.stretchKey(masterKey)
				const encryptedDEK = await localCrypto.encrypt(state.decryptedDEK, stretchedKey)
				const authHash = await localCrypto.computeAuthHash(stretchedKey)

				await client.addPassword({
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
					authHash: localCrypto.base64urlEncode(authHash),
				})

				await actions.checkSession()
				state.password = ""
				state.confirmPassword = ""
				navigator.go("/")
				alert("Master password added successfully!")
			} catch (e) {
				console.error("Add password error:", e)
				state.error = (e as Error).message || "Failed to add password. Please try again."
			} finally {
				state.loading = false
			}
		},

		async handleChangePassword() {
			state.error = ""

			if (!state.decryptedDEK) {
				state.error = "Vault must be unlocked first"
				return
			}

			if (state.password !== state.confirmPassword) {
				state.error = "Passwords do not match"
				return
			}

			if (localCrypto.checkPasswordStrength(state.password) === 0) {
				state.error = "Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols."
				return
			}

			state.loading = true

			try {
				const salt = localCrypto.emailToSalt(state.email)
				const masterKey = await localCrypto.deriveKeyFromPassword(state.password, salt)

				const stretchedKey = await localCrypto.stretchKey(masterKey)
				const encryptedDEK = await localCrypto.encrypt(state.decryptedDEK, stretchedKey)
				const authHash = await localCrypto.computeAuthHash(stretchedKey)

				await client.changePassword({
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
					authHash: localCrypto.base64urlEncode(authHash),
				})

				await actions.checkSession()
				state.password = ""
				state.confirmPassword = ""
				navigator.go("/")
				alert("Password changed successfully!")
			} catch (e) {
				console.error("Change password error:", e)
				state.error = (e as Error).message || "Failed to change password. Please try again."
			} finally {
				state.loading = false
			}
		},

		async handleSetPasskey() {
			state.error = ""
			state.loading = true

			try {
				// Check if we already have a session.
				const sessionData = await client.getSession()

				if (!sessionData.authenticated) {
					await client.registerCompletePasskey({
						email: state.email,
					})
				}

				// Step 1: Register the passkey with PRF extension enabled and try to evaluate it immediately.
				const regOptions = await client.webAuthnRegisterStart()

				const regOptionsWithPrf = {
					...regOptions,
					extensions: {
						...regOptions.extensions,
						prf: {
							eval: {
								first: localCrypto.PRF_SALT,
							},
						},
					},
				}

				const regResponse = await webauthn.startRegistration({ optionsJSON: regOptionsWithPrf })

				const completeData = await client.webAuthnRegisterComplete({
					response: regResponse,
				})

				// Check if we got PRF output from registration.
				let wrapKey: Uint8Array | null = null
				const regPrfOutput = regResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
				wrapKey = localCrypto.extractPRFKey(regPrfOutput.prf)

				if (!wrapKey) {
					// Step 2: PRF not evaluated during registration. Try to authenticate immediately to get PRF output.
					try {
						const authOptions = await client.webAuthnLoginStart({ email: state.email })

						const authOptionsWithPrf = {
							...authOptions,
							extensions: {
								...authOptions.extensions,
								prf: {
									eval: {
										first: localCrypto.PRF_SALT,
									},
								},
							},
						}

						const authResponse = await webauthn.startAuthentication({ optionsJSON: authOptionsWithPrf })

						// Extract the PRF key from the authenticator response to wrap the DEK.
						const authPrfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
						wrapKey = localCrypto.extractPRFKey(authPrfOutput.prf)

						// Cleanup the pending login challenge on server best-effort (or just let it expire).
					} catch (e) {
						console.warn("Failed to perform immediate PRF evaluation after registration:", e)
					}
				}

				if (!wrapKey) {
					// PRF is not supported by this authenticator at all.
					state.error =
						"Passkey created, but your authenticator doesn't support encryption. You'll need to use your master password to unlock the vault."

					if (!completeData.backupState) {
						alert("⚠️ Your passkey is not backed up. Consider adding a password or more passkeys for account recovery.")
					}

					// Cannot create vault without encryption support, fallback to password setup.
					state.error = "Your authenticator doesn't support encryption. Please set up a password instead."

					// Delete the just-created user/credential? The server created a user.
					// For now, let's just fail.
					state.loading = false
					return
				}

				// Step 3: Encrypt DEK with PRF-derived key.
				const dek = localCrypto.generateDEK()
				const encryptedDEK = await localCrypto.encrypt(dek, wrapKey)

				// Store encrypted DEK for this credential.
				await client.webAuthnVaultStore({
					credentialId: completeData.credentialId,
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
				})

				if (!completeData.backupState) {
					alert("⚠️ Your passkey is not backed up. Consider adding a password or more passkeys for account recovery.")
				}

				state.decryptedDEK = dek
				await actions.checkSession()
			} catch (e) {
				console.error("Passkey registration error:", e)
				state.error = "Passkey wasn't created. You can try again or use a password instead."
			} finally {
				state.loading = false
			}
		},

		async handleLogin() {
			state.error = ""
			state.loading = true

			try {
				const salt = localCrypto.emailToSalt(state.email)
				const masterKey = await localCrypto.deriveKeyFromPassword(state.password, salt)

				const stretchedKey = await localCrypto.stretchKey(masterKey)
				const authHash = await localCrypto.computeAuthHash(stretchedKey)

				const response = await client.login({
					email: state.email,
					authHash: localCrypto.base64urlEncode(authHash),
				})

				if (response.vault) {
					const encryptedDEK = localCrypto.base64urlDecode(response.vault.encryptedDEK)
					const dek = await localCrypto.decrypt(encryptedDEK, stretchedKey)
					state.decryptedDEK = dek
				} else {
					// Should not happen for password users based on current schema,
					// but defensive coding.
				}

				await actions.checkSession()
			} catch (e) {
				console.error("Login error:", e)
				state.error = (e as Error).message || "Sign in failed. Check your password and try again."
			} finally {
				state.loading = false
			}
		},

		async handlePasskeyLogin() {
			state.error = ""
			state.loading = true

			try {
				const options = await client.webAuthnLoginStart({
					email: state.email,
				})

				// Add PRF extension with our fixed salt.
				const optionsWithPrf = {
					...options,
					extensions: {
						...options.extensions,
						prf: {
							eval: {
								first: localCrypto.PRF_SALT,
							},
						},
					},
				}

				const authResponse = await webauthn.startAuthentication({ optionsJSON: optionsWithPrf })

				const data = await client.webAuthnLoginComplete({
					email: state.email,
					response: authResponse,
				})

				if (data.vault) {
					// Extract PRF output for wrapKey.
					const prfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
					const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

					if (!wrapKey) {
						state.error = "PRF not supported by this authenticator. Please use your password."
						state.loading = false
						return
					}

					const encryptedDEK = localCrypto.base64urlDecode(data.vault.encryptedDEK)
					const dek = await localCrypto.decrypt(encryptedDEK, wrapKey)
					state.decryptedDEK = dek
				}

				await actions.checkSession()
			} catch (e) {
				console.error("Passkey login error:", e)
				state.error = (e as Error).message || "Passkey sign in failed. Try using your password."
			} finally {
				state.loading = false
			}
		},

		async handleQuickUnlock() {
			state.error = ""
			state.loading = true

			try {
				let options: api.WebAuthnLoginStartResponse
				try {
					options = await client.webAuthnLoginStart({ email: state.email })
				} catch (e) {
					if ((e as Error).message === "No passkeys registered") {
						navigator.go("/login")
						return
					}
					throw e
				}

				// Add PRF extension with our fixed salt.
				const optionsWithPrf = {
					...options,
					extensions: {
						...options.extensions,
						prf: {
							eval: {
								first: localCrypto.PRF_SALT,
							},
						},
					},
				}

				const authResponse = await webauthn.startAuthentication({ optionsJSON: optionsWithPrf })

				const data = await client.webAuthnLoginComplete({
					email: state.email,
					response: authResponse,
				})

				if (data.vault) {
					// Extract PRF output for wrapKey.
					const prfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
					const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

					if (!wrapKey) {
						state.error = "PRF not supported by this authenticator. Please use your password."
						state.loading = false
						return
					}

					const encryptedDEK = localCrypto.base64urlDecode(data.vault.encryptedDEK)
					const dek = await localCrypto.decrypt(encryptedDEK, wrapKey)
					state.decryptedDEK = dek
					navigator.go("/")
				} else {
					state.error = "No vault found for this passkey"
				}
			} catch (e) {
				console.error("Quick unlock error:", e)
				state.error = (e as Error).message || "Unlock failed. Try using your password."
			} finally {
				state.loading = false
			}
		},

		async handleRegisterPasskey() {
			if (!state.decryptedDEK) {
				state.error = "Vault not unlocked"
				return
			}

			state.error = ""
			state.loading = true

			try {
				// Step 1: Register the passkey with PRF extension enabled and try to evaluate immediately.
				const regOptions = await client.webAuthnRegisterStart()

				const regOptionsWithPrf = {
					...regOptions,
					extensions: {
						...regOptions.extensions,
						prf: {
							eval: {
								first: localCrypto.PRF_SALT,
							},
						},
					},
				}

				const regResponse = await webauthn.startRegistration({ optionsJSON: regOptionsWithPrf })

				const data = await client.webAuthnRegisterComplete({
					response: regResponse,
				})

				// Check if we got PRF output from registration.
				let wrapKey: Uint8Array | null = null
				const regPrfOutput = regResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
				wrapKey = localCrypto.extractPRFKey(regPrfOutput.prf)

				if (!wrapKey) {
					// Step 2: PRF not evaluated during registration. Try to authenticate immediately to get PRF output.
					try {
						const authOptions = await client.webAuthnLoginStart({ email: state.email })

						const authOptionsWithPrf = {
							...authOptions,
							extensions: {
								...authOptions.extensions,
								prf: {
									eval: {
										first: localCrypto.PRF_SALT, // Only first salt needed needed for one key (hmac-secret).
									},
								},
							},
						}

						const authResponse = await webauthn.startAuthentication({ optionsJSON: authOptionsWithPrf })

						const authPrfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
						wrapKey = localCrypto.extractPRFKey(authPrfOutput.prf)
					} catch (e) {
						console.warn("Failed to perform immediate PRF evaluation after registration:", e)
					}
				}

				if (!wrapKey) {
					state.error =
						"Passkey registered for authentication, but it doesn't support encryption. You'll need to use your master password (or another passkey) to unlock the vault."
					// Passkey can be used for authentication but not vault encryption.
					state.loading = false

					if (!data.backupState) {
						alert("⚠️ Your passkey is not backed up.")
					}
					alert("Passkey registered (login only). This authenticator doesn't support encryption.")
					return
				}

				// Step 3: Encrypt DEK with PRF-derived key.
				const encryptedDEK = await localCrypto.encrypt(state.decryptedDEK, wrapKey)

				// Store encrypted DEK for this credential.
				await client.webAuthnVaultStore({
					credentialId: data.credentialId,
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
				})

				if (!data.backupState) {
					alert("⚠️ Your passkey is not backed up. Consider adding more passkeys for account recovery.")
				}

				alert("Passkey registered successfully!")
			} catch (e) {
				console.error("Passkey registration error:", e)
				state.error = (e as Error).message || "Passkey registration failed."
			} finally {
				state.loading = false
			}
		},

		setVaultContent(content: string) {
			state.vaultContent = content
		},

		async loadVaultContent() {
			if (!state.decryptedDEK) {
				return
			}

			try {
				const vaultData = await client.getVault()
				if (vaultData.encryptedData) {
					const encryptedData = localCrypto.base64urlDecode(vaultData.encryptedData)
					const decryptedData = await localCrypto.decrypt(encryptedData, state.decryptedDEK)
					state.vaultContent = new TextDecoder().decode(decryptedData)
				}
				state.vaultVersion = vaultData.version ?? 0
			} catch (e) {
				console.error("Failed to load vault content:", e)
			}
		},

		async saveVaultContent() {
			if (!state.decryptedDEK) {
				state.error = "Vault must be unlocked first"
				return
			}

			state.error = ""
			state.loading = true

			try {
				const dataBytes = new TextEncoder().encode(state.vaultContent)
				const encryptedData = await localCrypto.encrypt(dataBytes, state.decryptedDEK)

				await client.saveVaultData({
					encryptedData: localCrypto.base64urlEncode(encryptedData),
					version: state.vaultVersion,
				})

				state.vaultVersion++

				alert("Vault saved successfully!")
			} catch (e) {
				console.error("Failed to save vault:", e)
				state.error = (e as Error).message || "Failed to save vault"
			} finally {
				state.loading = false
			}
		},

		// Email Change Actions.

		setNewEmail(email: string) {
			state.newEmail = email
		},

		/**
		 * Start the email change process. Sends a magic link to the new email.
		 */
		async handleStartEmailChange() {
			if (!state.newEmail) {
				state.error = "Please enter a new email address"
				return
			}

			if (!state.session?.authenticated) {
				state.error = "You must be signed in to change your email"
				return
			}

			state.error = ""
			state.loading = true

			try {
				const data = await client.changeEmailStart({ newEmail: state.newEmail })
				state.emailChangeChallengeId = data.challengeId
				navigator.go("/email/change-pending")
				actions.startPollingEmailChange()
			} catch (e) {
				state.error = (e as Error).message || "Failed to start email change"
			} finally {
				state.loading = false
			}
		},

		/**
		 * Polls the server to check if the email change magic link was clicked.
		 */
		async startPollingEmailChange() {
			const pollInterval = 2000
			const maxAttempts = 60

			let attempts = 0

			const poll = async () => {
				if (!state.emailChangeChallengeId) {
					return
				}

				try {
					const data = await client.changeEmailPoll({ challengeId: state.emailChangeChallengeId })

					if (data.verified && data.newEmail) {
						// Update session with new email.
						if (state.session) {
							state.session.email = data.newEmail
							state.email = data.newEmail
						}
						state.newEmail = ""
						state.emailChangeChallengeId = ""
						navigator.go("/")
						alert(`Email changed successfully to ${data.newEmail}`)
						return
					}

					attempts++
					if (attempts < maxAttempts) {
						setTimeout(poll, pollInterval)
					} else {
						state.error = "Verification link expired. Please try again."
						navigator.go("/email/change")
					}
				} catch (_e) {
					state.error = "Verification failed or expired. Please try again."
					navigator.go("/email/change")
				}
			}

			poll()
		},

		/**
		 * Called when user clicks the email change magic link.
		 */
		async handleVerifyEmailChangeLink(challengeId: string, token: string) {
			state.loading = true
			state.error = ""

			try {
				const data = await client.changeEmailVerifyLink({ challengeId, token })
				state.newEmail = data.newEmail
			} catch (e) {
				state.error = (e as Error).message || "Verification failed"
			} finally {
				state.loading = false
			}
		},

		async handleLogout() {
			await client.logout()
			state.session = null
			state.decryptedDEK = null
			state.password = ""
			state.vaultContent = ""
			state.email = ""
			navigator.go("/")
		},
	}

	return actions
}

/** Return type of createStore for typing purposes. */
export type StoreActions = ReturnType<typeof createActions>

/**
 * Creates a new store instance with its own state and actions.
 * The client is an immutable dependency — pass it at construction time.
 *
 * @param client - The API client to use.
 */
export function createStore(client: api.ClientInterface) {
	const state = proxy<AppState>(initialState())

	// Default navigator prevents crashes before router is connected
	let navigate = (path: string) => {
		console.warn("Navigator not connected, attempted to go to:", path)
	}

	const navigator: Navigator = {
		go: (path: string) => navigate(path),
	}

	const actions = createActions(state, client, navigator)

	return {
		state,
		actions,
		client,
		navigator: {
			...navigator,
			setNavigate: (fn: (path: string) => void) => {
				navigate = fn
			},
		},
	}
}

/** Store type for convenience. */
export type Store = ReturnType<typeof createStore>

/** Context for providing a store to the component tree. */
export const StoreContext = createContext<Store | null>(null)

/**
 * Hook to access the store from the context.
 * Must be used within a StoreContext.Provider.
 */
export function useStore(): Store {
	const store = useContext(StoreContext)
	if (!store) {
		throw new Error("useStore must be used within a StoreContext.Provider")
	}
	return store
}

/**
 * Hook to access the state with a snapshot for reactive updates.
 * This is the recommended way to read state in components.
 */
export function useAppState(): Readonly<AppState> {
	const { state } = useStore()
	return useSnapshot(state)
}

/**
 * Hook to access just the actions from the store.
 * Actions can be called directly to mutate state.
 */
export function useActions(): StoreActions {
	return useStore().actions
}
