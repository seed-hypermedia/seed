import * as webauthn from "@simplewebauthn/browser"
import { createContext, useContext } from "react"
import { proxy, useSnapshot } from "valtio"
import type * as api from "@/api"
import * as blobs from "./blobs"
import * as localCrypto from "./crypto"
import * as delegation from "./delegation"
import * as vaultDataMod from "./vault"

export interface SessionInfo {
	authenticated: boolean
	userId?: string
	email?: string
	hasPassword?: boolean
	hasPasskeys?: boolean
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
		vaultData: null as vaultDataMod.VaultData | null,
		vaultVersion: 0,
		selectedAccountIndex: -1,
		creatingAccount: false,
		newEmail: "", // For email change flow.
		emailChangeChallengeId: "", // For email change polling.
		sessionChecked: false,
		/** Active delegation request parsed from URL params. Null when not in delegation flow. */
		delegationRequest: null as delegation.DelegationRequest | null,
		/** Whether the user has given consent for the current delegation. */
		delegationConsented: false,
	}
}

export type AppState = ReturnType<typeof initialState>

export interface Navigator {
	go(path: string): void
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
				}
			} catch (e) {
				console.error("Session check failed:", e)
			} finally {
				state.sessionChecked = true
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
						// Poll successful, session created. Update local state.
						await actions.checkSession()
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

				await client.addPassword({
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
					authHash: localCrypto.base64urlEncode(authHash),
				})

				state.decryptedDEK = dek
				await actions.loadVaultData()
				navigator.go("/")
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
				// Step 0: Ensure we are authenticated (should be handled by email verification).
				const sessionData = await client.getSession()
				if (!sessionData.authenticated) {
					throw new Error("Session expired. Please verify your email again.")
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
					state.error = "Your authenticator doesn't support encryption. Please set up a password instead."
					state.loading = false
					return
				}

				// Step 3: Encrypt DEK with PRF-derived key.
				let dek = state.decryptedDEK
				if (!dek) {
					dek = localCrypto.generateDEK()
				}

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
				await actions.loadVaultData()
				navigator.go("/")
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
					await actions.loadVaultData()
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
					await actions.loadVaultData()
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
					await actions.loadVaultData()
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

		/**
		 * Attempts passkey sign-in via conditional mediation (browser autofill).
		 * Should be called on mount of the pre-login page. The browser will show
		 * available passkeys in the autofill dropdown of the email input. If the
		 * user selects one, we complete authentication and navigate to the vault.
		 */
		async handleConditionalLogin() {
			if (!localCrypto.isWebAuthnSupported()) {
				console.log("Webauthn not supported")
				return
			}

			try {
				const available = await webauthn.browserSupportsWebAuthnAutofill()
				if (!available) {
					console.log("Webauthn autofill not supported")
					return
				}
			} catch (err) {
				console.log("Webauthn autfill error", err)
				return
			}

			try {
				// Request an anonymous challenge (no email).
				const options = await client.webAuthnLoginStart({})

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

				const authResponse = await webauthn.startAuthentication({
					optionsJSON: optionsWithPrf,
					useBrowserAutofill: true,
					verifyBrowserAutofillInput: true,
				})

				// User selected a passkey from autofill.
				const data = await client.webAuthnLoginComplete({
					response: authResponse,
				})

				if (data.vault) {
					const prfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
					const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

					if (!wrapKey) {
						state.error = "PRF not supported by this authenticator. Please use your password."
						return
					}

					const encryptedDEK = localCrypto.base64urlDecode(data.vault.encryptedDEK)
					const dek = await localCrypto.decrypt(encryptedDEK, wrapKey)
					state.decryptedDEK = dek
					await actions.loadVaultData()
				}

				await actions.checkSession()
			} catch (e) {
				console.error("Conditional mediation error:", e)
			}
		},

		/**
		 * Manual passkey login without email. Triggered by the "Sign in with a
		 * passkey" link on the pre-login page. Forces the browser modal.
		 */
		async handleModalPasskeyLogin() {
			state.error = ""
			state.loading = true

			try {
				const options = await client.webAuthnLoginStart({})

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

				const authResponse = await webauthn.startAuthentication({
					optionsJSON: optionsWithPrf,
				})

				const data = await client.webAuthnLoginComplete({
					response: authResponse,
				})

				if (data.vault) {
					const prfOutput = authResponse.clientExtensionResults as { prf?: localCrypto.PRFOutput }
					const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

					if (!wrapKey) {
						state.error = "PRF not supported by this authenticator. Please use your password."
						return
					}

					const encryptedDEK = localCrypto.base64urlDecode(data.vault.encryptedDEK)
					const dek = await localCrypto.decrypt(encryptedDEK, wrapKey)
					state.decryptedDEK = dek
					await actions.loadVaultData()
				} else {
					state.error = "No vault found for this passkey"
					return
				}

				await actions.checkSession()
			} catch (e) {
				if ((e as Error).name === "AbortError") return
				console.error("Modal passkey login error:", e)
				state.error = (e as Error).message || "Passkey sign in failed."
			} finally {
				state.loading = false
			}
		},

		async handleRegisterPasskey() {
			const session = state.session
			if (!session) {
				state.error = "Not authenticated"
				return
			}

			const isNewUser = !session.hasPassword && !session.hasPasskeys

			if (!isNewUser && !state.decryptedDEK) {
				state.error = "Vault not unlocked"
				return
			}

			state.error = ""
			state.loading = true

			try {
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
						"Passkey registered for authentication, but it doesn't support encryption. Please set up a password instead."
					state.loading = false
					if (!data.backupState) {
						alert("⚠️ Your passkey is not backed up.")
					}
					return
				}

				// Step 3: Encrypt DEK with PRF-derived key.
				let dek = state.decryptedDEK
				if (!dek) {
					if (isNewUser) {
						dek = localCrypto.generateDEK()
					} else {
						// Should not reach here due to check above.
						throw new Error("Vault locked")
					}
				}

				const encryptedDEK = await localCrypto.encrypt(dek, wrapKey)

				// Store encrypted DEK for this credential.
				await client.webAuthnVaultStore({
					credentialId: data.credentialId,
					encryptedDEK: localCrypto.base64urlEncode(encryptedDEK),
				})

				if (!data.backupState) {
					alert("⚠️ Your passkey is not backed up. Consider adding more passkeys for account recovery.")
				}

				state.decryptedDEK = dek
				await actions.loadVaultData()
				navigator.go("/")
				await actions.checkSession()
			} catch (e) {
				console.error("Passkey registration error:", e)
				state.error = (e as Error).message || "Passkey registration failed."
			} finally {
				state.loading = false
			}
		},

		async loadVaultData() {
			if (!state.decryptedDEK) {
				return
			}

			try {
				const serverData = await client.getVault()
				if (serverData.encryptedData) {
					const encryptedData = localCrypto.base64urlDecode(serverData.encryptedData)
					const decryptedData = await localCrypto.decrypt(encryptedData, state.decryptedDEK)
					state.vaultData = await vaultDataMod.deserializeVault(decryptedData)

					if (state.vaultData.accounts.length === 1) {
						state.selectedAccountIndex = 0
					}
				} else {
					state.vaultData = vaultDataMod.emptyVault()
				}
				state.vaultVersion = serverData.version ?? 0
			} catch (e) {
				console.error("Failed to load vault data:", e)
			}
		},

		async saveVaultData() {
			if (!state.decryptedDEK || !state.vaultData) {
				state.error = "Vault must be unlocked first"
				return
			}

			state.error = ""

			try {
				const dataBytes = await vaultDataMod.serializeVault(state.vaultData)
				const encryptedData = await localCrypto.encrypt(dataBytes, state.decryptedDEK)

				await client.saveVaultData({
					encryptedData: localCrypto.base64urlEncode(encryptedData),
					version: state.vaultVersion,
				})

				state.vaultVersion++
			} catch (e) {
				console.error("Failed to save vault:", e)
				state.error = (e as Error).message || "Failed to save vault"
			}
		},

		async createAccount(name: string, description?: string) {
			if (!state.vaultData || !state.decryptedDEK) {
				state.error = "Vault must be unlocked first"
				return
			}

			state.loading = true
			state.error = ""

			try {
				const kp = blobs.generateKeyPair()
				const ts = Date.now()
				const encoded = blobs.createProfile(kp, { name, description }, ts)

				const account: vaultDataMod.Account = {
					seed: kp.privateKey,
					profile: encoded.decoded,
					createdAt: ts,
				}

				state.vaultData.accounts.push(account)
				state.selectedAccountIndex = state.vaultData.accounts.length - 1
				state.creatingAccount = false

				await actions.saveVaultData()
			} catch (e) {
				console.error("Failed to create account:", e)
				state.error = (e as Error).message || "Failed to create account"
			} finally {
				state.loading = false
			}
		},

		selectAccount(index: number) {
			state.selectedAccountIndex = index
		},

		setCreatingAccount(open: boolean) {
			state.creatingAccount = open
		},

		getSelectedAccount(): vaultDataMod.Account | null {
			if (
				!state.vaultData ||
				state.selectedAccountIndex < 0 ||
				state.selectedAccountIndex >= state.vaultData.accounts.length
			) {
				return null
			}
			return state.vaultData.accounts[state.selectedAccountIndex] ?? null
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

		/**
		 * Parse delegation parameters from a URL and store the request.
		 * If the URL has no delegation params, this is a no-op.
		 * If params are present but invalid, sets state.error.
		 */
		parseDelegationFromUrl(url: URL) {
			try {
				const request = delegation.parseDelegationRequest(url)
				if (request) {
					state.delegationRequest = request
				}
			} catch (e) {
				state.error = (e as Error).message || "Invalid delegation request"
			}
		},

		/** Set whether the user has consented to the current delegation. */
		setDelegationConsent(consented: boolean) {
			state.delegationConsented = consented
		},

		/**
		 * Complete the delegation flow: sign a capability for the session key,
		 * record the delegation, save the vault, and redirect back to the client.
		 */
		async completeDelegation() {
			state.error = ""
			state.loading = true

			try {
				if (!state.delegationRequest) {
					throw new Error("No active delegation request")
				}
				if (!state.decryptedDEK) {
					throw new Error("Vault is not unlocked")
				}
				if (!state.vaultData) {
					throw new Error("Vault data not loaded")
				}

				const account = state.vaultData.accounts[state.selectedAccountIndex]
				if (!account) {
					throw new Error("No account selected")
				}

				const issuerKeyPair = blobs.keyPairFromPrivateKey(account.seed)
				const sessionKeyPrincipal = blobs.principalFromString(state.delegationRequest.sessionKeyPrincipal)
				const encoded = delegation.createDelegation(
					issuerKeyPair,
					sessionKeyPrincipal,
					state.delegationRequest.clientId,
				)

				const delegatedSession: vaultDataMod.DelegatedSession = {
					clientId: state.delegationRequest.clientId,
					sessionKeyPrincipal: state.delegationRequest.sessionKeyPrincipal,
					accountIndex: state.selectedAccountIndex,
					createdAt: Date.now(),
					label: `Session for ${state.delegationRequest.clientId}`,
				}
				state.vaultData.delegations.push(delegatedSession)

				await actions.saveVaultData()

				const accountPrincipal = blobs.principalToString(issuerKeyPair.principal)
				const callbackUrl = delegation.buildCallbackUrl(
					state.delegationRequest.redirectUri,
					encoded.data,
					accountPrincipal,
					{
						name: account.profile.name,
						description: account.profile.description,
						avatar: account.profile.avatar,
					},
				)

				state.delegationRequest = null
				state.delegationConsented = false

				window.location.href = callbackUrl
			} catch (e) {
				console.error("Delegation failed:", e)
				state.error = (e as Error).message || "Delegation failed"
			} finally {
				state.loading = false
			}
		},

		/** Cancel the delegation flow and redirect back with an error. */
		cancelDelegation() {
			if (state.delegationRequest) {
				const url = new URL(state.delegationRequest.redirectUri)
				url.searchParams.set("error", "access_denied")
				state.delegationRequest = null
				state.delegationConsented = false
				window.location.href = url.toString()
			} else {
				state.delegationRequest = null
				state.delegationConsented = false
			}
		},

		async handleLogout() {
			await client.logout()
			state.session = null
			state.decryptedDEK = null
			state.password = ""
			state.vaultData = null
			state.selectedAccountIndex = -1
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
export function useAppState() {
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
