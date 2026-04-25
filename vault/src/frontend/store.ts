import type * as api from '@/api'
import {code as cborCodec} from '@ipld/dag-cbor'
import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import * as encryption from '@shm/shared/encryption'
import * as hmauth from '@shm/shared/hmauth'
import * as keyfile from '@shm/shared/keyfile'
import * as webauthn from '@simplewebauthn/browser'
import {code as rawCodec} from 'multiformats/codecs/raw'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {createContext, useContext} from 'react'
import {proxy, useSnapshot} from 'valtio'
import * as joinedSite from '@shm/shared/publish-default-joined-site'
import {APIError} from './api-client'
import type {Blockstore} from './blockstore'
import * as localCrypto from './crypto'
import * as notificationApi from './notification-api'
import type {AccountProfileSummary, ProfileLoadState} from './profile'
import * as vault from './vault'

export interface SessionInfo {
  authenticated: boolean
  relyingPartyOrigin: string
  userId?: string
  email?: string
  credentials?: {
    password?: true
    passkey?: true
  }
}

type VaultConnectionRequest = {
  handoffToken: string
  callbackURL: string
}

type VaultConnectionHandoffResponse = {
  success: boolean
}

const VAULT_CONNECTION_SUCCESS_MESSAGE = 'Your Seed desktop app has been linked with this remote vault successfully.'

/**
 * Returns the route to continue a pending external flow after auth or profile setup completes.
 */
export function getPendingFlowPath(state: Pick<AppState, 'delegationRequest' | 'vaultConnectionRequest'>): string {
  if (state.delegationRequest) {
    return '/delegate'
  }
  if (state.vaultConnectionRequest) {
    return '/connect'
  }
  return '/'
}

/** Creates the initial state for the store. */
function initialState(backendHttpBaseUrl = '', notificationServerUrl = '') {
  return {
    email: '',
    password: '',
    passwordSalt: '',
    confirmPassword: '',
    challengeId: '', // For polling during magic link verification.
    error: '',
    loading: false,
    session: null as SessionInfo | null,
    decryptedDEK: null as Uint8Array | null,
    passkeySupported: false,
    platformAuthAvailable: false,
    userHasPassword: false,
    userHasPasskey: false,
    vaultData: null as vault.State | null,
    vaultVersion: 0,
    vaultLoaded: false,
    selectedAccountIndex: -1,
    creatingAccount: false,
    newEmail: '', // For email change flow.
    emailChangeChallengeId: '', // For email change polling.
    sessionChecked: false,
    /** Active delegation request parsed from URL params. Null when not in delegation flow. */
    delegationRequest: null as hmauth.DelegationRequest | null,
    /** Whether the user has given consent for the current delegation. */
    delegationConsented: false,
    /** Pending vault handoff parsed from URL fragment. */
    vaultConnectionRequest: null as VaultConnectionRequest | null,
    /** Prevent duplicate handoff completion calls. */
    vaultConnectionInProgress: false,
    /** Success notice shown after a desktop handoff completes. */
    vaultConnectionSuccessMessage: '',
    /** Server-configured relying party origin used by WebAuthn verification. */
    relyingPartyOrigin: '',
    /** Daemon base URL used for direct IPFS asset reads. */
    backendHttpBaseUrl,
    /** Notification server URL surfaced in the application footer. */
    notificationServerUrl,
    /** Signed email prevalidation from the vault server, used to skip email verification on the notify server. */
    emailPrevalidation: null as api.EmailPrevalidation | null,
    /** Cache of loaded profiles mapped by their principal */
    profiles: {} as Record<string, AccountProfileSummary>,
    /** Tracks degraded profile states so the UI can distinguish not found from temporary failures. */
    profileLoadStates: {} as Record<string, ProfileLoadState>,
  }
}

export type AppState = ReturnType<typeof initialState>

export interface Navigator {
  go(path: string): void
}

function getErrorMessage(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : '') || fallback
}

function isNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    error instanceof TypeError ||
    message === 'load failed' ||
    message === 'failed to fetch' ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  )
}

async function derivePasskeyWrapKey(
  registrationOptions: api.AddPasskeyStartResponse,
  registrationResponse: webauthn.RegistrationResponseJSON,
): Promise<Uint8Array | null> {
  const registrationPrfOutput = registrationResponse.clientExtensionResults as {
    prf?: localCrypto.PRFOutput
  }
  const registrationWrapKey = localCrypto.extractPRFKey(registrationPrfOutput.prf)
  if (registrationWrapKey) {
    return registrationWrapKey
  }

  try {
    const authenticationResponse = await webauthn.startAuthentication({
      optionsJSON: {
        challenge: base64.encode(crypto.getRandomValues(new Uint8Array(32))),
        rpId: registrationOptions.rp.id,
        allowCredentials: [
          {
            id: registrationResponse.id,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: localCrypto.PRF_SALT,
            },
          },
        },
      } as Parameters<typeof webauthn.startAuthentication>[0]['optionsJSON'],
    })

    const authenticationPrfOutput = authenticationResponse.clientExtensionResults as {
      prf?: localCrypto.PRFOutput
    }
    return localCrypto.extractPRFKey(authenticationPrfOutput.prf)
  } catch (e) {
    console.warn('Failed to evaluate passkey PRF after registration:', e)
    return null
  }
}

function getVaultSaveErrorMessage(error: unknown) {
  if (isNetworkError(error)) {
    return "Couldn't reach the Vault backend to save your changes. Make sure the backend server is running and try again."
  }

  return getErrorMessage(error, 'Failed to save vault')
}

function getProfilePublishErrorMessage(error: unknown) {
  if (isNetworkError(error)) {
    return "Couldn't reach the Vault backend to publish your profile. Make sure the backend server is running and try again."
  }

  return getErrorMessage(error, 'Failed to update profile')
}

function getNotificationRegistrationErrorMessage(error: unknown) {
  if (isNetworkError(error)) {
    return "Your account was created, but the notification server couldn't be reached. You can connect notifications later."
  }

  return getErrorMessage(error, 'Your account was created, but notification registration failed.')
}

function normalizeNotificationServerUrl(notificationServerUrl: string) {
  const trimmedNotificationServerUrl = notificationServerUrl.trim()
  if (!trimmedNotificationServerUrl) {
    return ''
  }

  return new URL(trimmedNotificationServerUrl).toString()
}

function normalizeBaseURL(rawURL: string, fieldName: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawURL)
  } catch {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (!parsed.host) {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`Invalid ${fieldName}`)
  }

  const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${normalizedPath}`
}

function getCurrentVaultBaseURL() {
  return normalizeBaseURL(new URL('.', window.location.href).toString(), 'current vault URL')
}

function normalizeCallbackURL(rawURL: string) {
  let parsed: URL
  try {
    parsed = new URL(rawURL)
  } catch {
    throw new Error('Invalid callback URL: must be a valid URL')
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('Invalid callback URL: protocol must be http')
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Invalid callback URL: host must be localhost or 127.0.0.1')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Invalid callback URL: username and password are not allowed')
  }
  if (parsed.pathname !== '/vault-handoff') {
    throw new Error('Invalid callback URL: path must be /vault-handoff')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Invalid callback URL: query string and fragment are not allowed')
  }

  return `${parsed.origin}${parsed.pathname}`
}

function parseVaultConnectionRequest(urlLike: URL | string): VaultConnectionRequest | null {
  const parsedURL = typeof urlLike === 'string' ? new URL(urlLike) : urlLike
  const fragment = parsedURL.hash.startsWith('#') ? parsedURL.hash.slice(1) : parsedURL.hash
  if (!fragment) {
    return null
  }

  const params = new URLSearchParams(fragment)
  const handoffToken = (params.get('token') ?? '').trim()
  const callback = (params.get('callback') ?? '').trim()
  if (!handoffToken && !callback) {
    return null
  }
  if (!handoffToken || !callback) {
    throw new Error('Invalid vault connection fragment')
  }

  return {
    handoffToken,
    callbackURL: normalizeCallbackURL(callback),
  }
}

/** Creates actions bound to a specific state proxy and client. */
function createActions(state: AppState, client: api.ClientInterface, navigator: Navigator, blockstore: Blockstore) {
  let pendingVaultLoad: Promise<void> | null = null

  async function ensurePasswordSalt() {
    if (state.passwordSalt) {
      return state.passwordSalt
    }

    const data = await client.preLogin({email: state.email})
    if (!data.exists || !data.salt) {
      throw new Error('Password login is not available for this account.')
    }

    state.passwordSalt = data.salt
    return data.salt
  }

  async function derivePasswordMaterial(password: string, salt: string) {
    const masterKey = await encryption.deriveKeyFromPassword(password, base64.decode(salt))
    const encryptionKey = await localCrypto.deriveEncryptionKey(masterKey)
    const authKey = await localCrypto.deriveAuthKey(masterKey)
    return {encryptionKey, authKey}
  }

  function getEffectiveNotificationServerUrl() {
    return state.vaultData?.notificationServerUrl?.trim() || state.notificationServerUrl
  }

  function setVaultNotificationServerUrl(notificationServerUrl: string | undefined) {
    if (!state.vaultData) {
      return
    }

    if (notificationServerUrl) {
      state.vaultData.notificationServerUrl = notificationServerUrl
    } else {
      delete state.vaultData.notificationServerUrl
    }
  }

  function isVaultDataResponse(vaultData: api.GetVaultResponse): vaultData is api.GetVaultDataResponse {
    return 'version' in vaultData
  }

  function getPasswordCredential(vaultData: api.GetVaultDataResponse): api.PasswordVaultCredential | null {
    const credential = vaultData.credentials.find((item) => item.kind === 'password')
    return credential?.kind === 'password' ? credential : null
  }

  function getPasskeyCredential(
    vaultData: api.GetVaultDataResponse,
    credentialId: string,
  ): api.PasskeyVaultCredential | null {
    const credential = vaultData.credentials.find(
      (item) => item.kind === 'passkey' && item.credentialId === credentialId,
    )
    return credential?.kind === 'passkey' ? credential : null
  }

  function cacheProfile(
    principal: string,
    profile: {
      name: string
      avatar?: string
      description?: string
    },
  ) {
    state.profiles[principal] = {
      name: profile.name,
      avatar: profile.avatar,
      description: profile.description,
    }
    delete state.profileLoadStates[principal]
  }

  async function uploadAvatar(avatarFile: File): Promise<string> {
    const data = new Uint8Array(await avatarFile.arrayBuffer())
    const cid = CID.createV1(rawCodec, await sha256.digest(data))
    await blockstore.put(cid, data)
    return `ipfs://${cid}`
  }

  async function publishProfile(
    signer: blobs.NobleKeyPair,
    profile: {
      name: string
      avatar?: string
      description?: string
    },
    ts = Date.now(),
  ) {
    const encoded = await blobs.createProfile(signer, profile, ts)
    await blockstore.put(encoded.cid, encoded.data)
    const principal = blobs.principalToString(signer.principal)
    cacheProfile(principal, profile)
    return {encoded, principal}
  }

  async function registerAccountOnNotificationServer(
    signer: blobs.NobleKeyPair,
    options: {includeEmail: boolean},
  ): Promise<void> {
    const notifyServiceHost = getEffectiveNotificationServerUrl().trim()
    if (!notifyServiceHost) {
      return
    }

    const notificationEmail = options.includeEmail ? state.session?.email?.trim() || state.email.trim() : ''
    await notificationApi.registerNotificationInbox(notifyServiceHost, signer)

    if (notificationEmail) {
      await notificationApi.setNotificationConfig(
        notifyServiceHost,
        signer,
        notificationEmail,
        state.emailPrevalidation,
      )
    }
  }

  type CreateAccountOptions = {
    notificationRegistration?: {
      includeEmail: boolean
    }
  }

  async function hydrateVaultData(serverData?: api.GetVaultResponse) {
    if (!state.decryptedDEK) {
      return
    }

    const vaultResponse = serverData ?? (await client.getVault({}))
    if (!isVaultDataResponse(vaultResponse)) {
      return
    }

    const passwordCredential = getPasswordCredential(vaultResponse)
    if (passwordCredential) {
      state.passwordSalt = passwordCredential.salt
    }

    state.emailPrevalidation = vaultResponse.emailPrevalidation ?? null

    if (vaultResponse.encryptedData) {
      const encryptedData = base64.decode(vaultResponse.encryptedData)
      const decryptedData = await localCrypto.decrypt(encryptedData, state.decryptedDEK)
      state.vaultData = await vault.deserialize(decryptedData)

      if (state.vaultData.accounts.length === 1) {
        state.selectedAccountIndex = 0
      }
      if (state.vaultData.accounts.length === 0) {
        state.creatingAccount = true
      }
    } else {
      state.vaultData = vault.createEmpty()
      state.creatingAccount = true
    }

    state.vaultVersion = vaultResponse.version ?? 0
    state.vaultLoaded = true
  }

  async function ensureVaultLoaded(serverData?: api.GetVaultResponse) {
    if (!state.decryptedDEK) {
      return
    }

    if (serverData) {
      const loadPromise = hydrateVaultData(serverData)
      pendingVaultLoad = loadPromise
      try {
        await loadPromise
      } finally {
        if (pendingVaultLoad === loadPromise) {
          pendingVaultLoad = null
        }
      }
      return
    }

    if (state.vaultLoaded) {
      return
    }

    if (pendingVaultLoad) {
      await pendingVaultLoad
      return
    }

    const loadPromise = hydrateVaultData()
    pendingVaultLoad = loadPromise
    try {
      await loadPromise
    } finally {
      if (pendingVaultLoad === loadPromise) {
        pendingVaultLoad = null
      }
    }
  }

  async function reloadVaultAfterConflict() {
    const freshVaultResponse = await client.getVault({})
    await ensureVaultLoaded(freshVaultResponse)
  }

  const actions = {
    resetState() {
      Object.assign(state, initialState(state.backendHttpBaseUrl, state.notificationServerUrl))
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

    async ensureProfileLoaded(principal: string) {
      if (state.profiles[principal]) return
      try {
        const account = await client.getAccount({id: principal})
        const profile = account.profile
        const metadata = account.metadata?.toJson({emitDefaultValues: true}) as Record<string, unknown> | undefined

        delete state.profileLoadStates[principal]

        if (profile || metadata) {
          state.profiles[principal] = {
            name: profile?.name || (typeof metadata?.name === 'string' ? metadata.name : undefined),
            avatar: profile?.icon || (typeof metadata?.icon === 'string' ? metadata.icon : undefined),
            description:
              profile?.description || (typeof metadata?.description === 'string' ? metadata.description : undefined),
          }
        }
      } catch (err) {
        state.profileLoadStates[principal] =
          err instanceof APIError && err.statusCode === 404 ? 'not_found' : 'unavailable'
        console.error('Failed to fetch profile', err)
      }
    },

    async checkSession() {
      try {
        const data = await client.getSession()
        state.relyingPartyOrigin = data.relyingPartyOrigin
        if (data.authenticated && data.email) {
          state.session = data
          state.email = data.email

          if (!data.credentials?.password && !data.credentials?.passkey) {
            navigator.go('/auth/choose')
          }
        }
      } catch (e) {
        console.error('Session check failed:', e)
      } finally {
        state.sessionChecked = true
        state.passkeySupported = localCrypto.isWebAuthnSupported()
        state.platformAuthAvailable = await localCrypto.isPlatformAuthenticatorAvailable()
      }
    },

    async handlePreLogin() {
      state.error = ''
      state.loading = true

      try {
        const data = await client.preLogin({email: state.email})
        const hasPassword = data.credentials?.password ?? false
        const hasPasskey = data.credentials?.passkey ?? false

        if (data.exists) {
          state.userHasPassword = hasPassword
          state.userHasPasskey = hasPasskey
          state.passwordSalt = data.salt ?? ''

          if (!hasPassword && !hasPasskey) {
            await actions.handleStartRegistration()
            return
          }

          navigator.go('/login')
        } else {
          await actions.handleStartRegistration()
        }
      } catch (_e) {
        state.error = 'Connection failed. Please try again.'
      } finally {
        state.loading = false
      }
    },

    async handleStartRegistration() {
      state.error = ''
      state.loading = true

      try {
        const data = await client.registerStart({email: state.email})
        state.challengeId = data.challengeId
        navigator.go('/verify/pending')
        actions.startPollingVerification()
      } catch (e) {
        state.error = (e as Error).message || 'Registration failed'
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
          const data = await client.registerPoll({
            challengeId: state.challengeId,
          })

          if (data.verified) {
            // Poll successful, session created. Update local state.
            await actions.checkSession()
            navigator.go('/auth/choose')
            return
          }

          attempts++
          if (attempts < maxAttempts) {
            setTimeout(poll, pollInterval)
          } else {
            state.error = 'Verification link expired. Please try again.'
          }
        } catch (_e) {
          // Challenge expired or error - stop polling.
          state.error = 'Verification failed or expired. Please try again.'
        }
      }

      poll()
    },

    /**
     * Called when user clicks the magic link. Verifies the token and shows confirmation.
     */
    async handleVerifyLink(challengeId: string, token: string) {
      state.loading = true
      state.error = ''

      try {
        const data = await client.registerVerifyLink({challengeId, token})
        state.email = data.email
      } catch (e) {
        state.error = (e as Error).message || 'Verification failed'
      } finally {
        state.loading = false
      }
    },

    async handleSetPassword() {
      state.error = ''

      if (state.password !== state.confirmPassword) {
        state.error = 'Passwords do not match'
        return
      }

      if (localCrypto.checkPasswordStrength(state.password) === 0) {
        state.error = 'Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols.'
        return
      }

      state.loading = true

      try {
        const salt = base64.encode(localCrypto.generatePasswordSalt())
        const {encryptionKey, authKey} = await derivePasswordMaterial(state.password, salt)
        const dek = localCrypto.generateDEK()
        const wrappedDEK = await localCrypto.encrypt(dek, encryptionKey)

        await client.addPassword({
          wrappedDEK: base64.encode(wrappedDEK),
          authKey: base64.encode(authKey),
          salt,
        })

        state.passwordSalt = salt
        state.decryptedDEK = dek
        await actions.loadVaultData()
        navigator.go('/profile/create')
        await actions.checkSession()
      } catch (e) {
        console.error('Registration error:', e)
        state.error = (e as Error).message || 'Registration failed. Please try again.'
      } finally {
        state.loading = false
      }
    },

    async handleAddPassword() {
      state.error = ''

      if (!state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return
      }

      if (state.password !== state.confirmPassword) {
        state.error = 'Passwords do not match'
        return
      }

      if (localCrypto.checkPasswordStrength(state.password) === 0) {
        state.error = 'Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols.'
        return
      }

      state.loading = true

      try {
        const salt = base64.encode(localCrypto.generatePasswordSalt())
        const {encryptionKey, authKey} = await derivePasswordMaterial(state.password, salt)
        const wrappedDEK = await localCrypto.encrypt(state.decryptedDEK, encryptionKey)

        await client.addPassword({
          wrappedDEK: base64.encode(wrappedDEK),
          authKey: base64.encode(authKey),
          salt,
        })

        state.passwordSalt = salt
        await actions.checkSession()
        state.password = ''
        state.confirmPassword = ''
        navigator.go('/')
        alert('Master password added successfully!')
      } catch (e) {
        console.error('Add password error:', e)
        state.error = (e as Error).message || 'Failed to add password. Please try again.'
      } finally {
        state.loading = false
      }
    },

    async handleChangePassword() {
      state.error = ''

      if (!state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return
      }

      if (state.password !== state.confirmPassword) {
        state.error = 'Passwords do not match'
        return
      }

      if (localCrypto.checkPasswordStrength(state.password) === 0) {
        state.error = 'Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols.'
        return
      }

      state.loading = true

      try {
        const salt = base64.encode(localCrypto.generatePasswordSalt())
        const {encryptionKey, authKey} = await derivePasswordMaterial(state.password, salt)
        const wrappedDEK = await localCrypto.encrypt(state.decryptedDEK, encryptionKey)

        await client.changePassword({
          wrappedDEK: base64.encode(wrappedDEK),
          authKey: base64.encode(authKey),
          salt,
        })

        state.passwordSalt = salt
        await actions.checkSession()
        state.password = ''
        state.confirmPassword = ''
        navigator.go('/')
        alert('Password changed successfully!')
      } catch (e) {
        console.error('Change password error:', e)
        state.error = (e as Error).message || 'Failed to change password. Please try again.'
      } finally {
        state.loading = false
      }
    },

    async handleSetPasskey() {
      state.error = ''
      state.loading = true

      try {
        // Step 0: Ensure we are authenticated (should be handled by email verification).
        const sessionData = await client.getSession()
        if (!sessionData.authenticated) {
          throw new Error('Session expired. Please verify your email again.')
        }

        // Step 1: Start registration and perform the WebAuthn create() ceremony with PRF enabled.
        const regOptions = await client.addPasskeyStart()

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

        const regResponse = await webauthn.startRegistration({
          optionsJSON: regOptionsWithPrf,
        })

        // PRF may surface during create() or only on an immediate get() retry for this credential.
        const wrapKey = await derivePasskeyWrapKey(regOptions, regResponse)
        let dek = state.decryptedDEK ?? localCrypto.generateDEK()

        if (!wrapKey) {
          state.error = "Your authenticator doesn't support encryption. Please set up a password instead."
          state.loading = false
          return
        }

        const wrappedDEK = await localCrypto.encrypt(dek, wrapKey)
        const completeData = await client.addPasskeyFinish({
          response: regResponse,
          wrappedDEK: base64.encode(wrappedDEK),
        })

        if (!completeData.backupState) {
          alert(
            'Your passkey is not backed up to the cloud. If you lose this device, you may not be able to sign in. Consider adding a password or another passkey as a backup.',
          )
        }

        state.decryptedDEK = dek
        await actions.loadVaultData()
        navigator.go('/profile/create')
        await actions.checkSession()
      } catch (e) {
        console.error('Passkey registration error:', e)
        state.error = "Passkey wasn't created. You can try again or use a password instead."
      } finally {
        state.loading = false
      }
    },

    async handleLogin() {
      state.error = ''
      state.loading = true

      try {
        const salt = await ensurePasswordSalt()
        const {encryptionKey, authKey} = await derivePasswordMaterial(state.password, salt)

        await client.login({
          email: state.email,
          authKey: base64.encode(authKey),
        })

        const vaultData = await client.getVault({})
        if (!isVaultDataResponse(vaultData)) {
          throw new Error('Vault data was not returned.')
        }

        const passwordCredential = getPasswordCredential(vaultData)
        if (!passwordCredential) {
          throw new Error('No password credential found for this account.')
        }

        const dek = await localCrypto.decrypt(base64.decode(passwordCredential.wrappedDEK), encryptionKey)
        state.passwordSalt = passwordCredential.salt
        state.decryptedDEK = dek
        await actions.loadVaultData(vaultData)

        await actions.checkSession()
      } catch (e) {
        console.error('Login error:', e)
        state.error = (e as Error).message || 'Sign in failed. Check your password and try again.'
      } finally {
        state.loading = false
      }
    },

    async handlePasskeyLogin() {
      state.error = ''
      state.loading = true

      try {
        const options = await client.loginPasskeyStart({
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

        const authResponse = await webauthn.startAuthentication({
          optionsJSON: optionsWithPrf,
        })

        await client.loginPasskeyFinish({
          response: authResponse,
        })

        // Extract PRF output for wrapKey.
        const prfOutput = authResponse.clientExtensionResults as {
          prf?: localCrypto.PRFOutput
        }
        const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

        if (!wrapKey) {
          state.error =
            'This passkey does not support the encryption needed to protect your vault. Please sign in with your password instead.'
          state.loading = false
          return
        }

        const vaultData = await client.getVault({})
        if (!isVaultDataResponse(vaultData)) {
          throw new Error('Vault data was not returned.')
        }

        const passkeyCredential = getPasskeyCredential(vaultData, authResponse.id)
        if (!passkeyCredential) {
          state.error =
            'This passkey is not linked to any account. Try a different passkey or sign in with your password.'
          state.loading = false
          return
        }

        const dek = await localCrypto.decrypt(base64.decode(passkeyCredential.wrappedDEK), wrapKey)
        state.decryptedDEK = dek
        await actions.loadVaultData(vaultData)

        await actions.checkSession()
      } catch (e) {
        console.error('Passkey login error:', e)
        state.error = (e as Error).message || 'Passkey sign-in failed. Please try again or sign in with your password.'
      } finally {
        state.loading = false
      }
    },

    async handleQuickUnlock() {
      state.error = ''
      state.loading = true

      try {
        let options: api.LoginPasskeyStartResponse
        try {
          options = await client.loginPasskeyStart({email: state.email})
        } catch (e) {
          if ((e as Error).message === 'No passkeys registered') {
            navigator.go('/login')
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

        const authResponse = await webauthn.startAuthentication({
          optionsJSON: optionsWithPrf,
        })

        await client.loginPasskeyFinish({
          response: authResponse,
        })

        const prfOutput = authResponse.clientExtensionResults as {
          prf?: localCrypto.PRFOutput
        }
        const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

        if (!wrapKey) {
          state.error =
            'This passkey does not support the encryption needed to protect your vault. Please sign in with your password instead.'
          state.loading = false
          return
        }

        const vaultData = await client.getVault({})
        if (!isVaultDataResponse(vaultData)) {
          throw new Error('Vault data was not returned.')
        }

        const passkeyCredential = getPasskeyCredential(vaultData, authResponse.id)
        if (!passkeyCredential) {
          state.error =
            'This passkey is not linked to any account. Try a different passkey or sign in with your password.'
          return
        }

        const dek = await localCrypto.decrypt(base64.decode(passkeyCredential.wrappedDEK), wrapKey)
        state.decryptedDEK = dek
        await actions.loadVaultData(vaultData)
      } catch (e) {
        console.error('Quick unlock error:', e)
        state.error =
          (e as Error).message || 'Could not unlock your vault. Please try again or sign in with your password.'
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
        console.log('Webauthn not supported')
        return
      }

      try {
        const available = await webauthn.browserSupportsWebAuthnAutofill()
        if (!available) {
          console.log('Webauthn autofill not supported')
          return
        }
      } catch (err) {
        console.log('Webauthn autfill error', err)
        return
      }

      try {
        // Request an anonymous challenge (no email).
        const options = await client.loginPasskeyStart({})

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
        await client.loginPasskeyFinish({
          response: authResponse,
        })

        const prfOutput = authResponse.clientExtensionResults as {
          prf?: localCrypto.PRFOutput
        }
        const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

        if (!wrapKey) {
          state.error =
            'This passkey does not support the encryption needed to protect your vault. Please sign in with your password instead.'
          return
        }

        const vaultData = await client.getVault({})
        if (!isVaultDataResponse(vaultData)) {
          throw new Error('Vault data was not returned.')
        }

        const passkeyCredential = getPasskeyCredential(vaultData, authResponse.id)
        if (!passkeyCredential) {
          state.error =
            'This passkey is not linked to any account. Try a different passkey or sign in with your password.'
          return
        }

        const dek = await localCrypto.decrypt(base64.decode(passkeyCredential.wrappedDEK), wrapKey)
        state.decryptedDEK = dek
        await actions.loadVaultData(vaultData)

        await actions.checkSession()
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error('Conditional mediation error:', e)
      }
    },

    /**
     * Manual passkey login without email. Triggered by the "Sign in with a
     * passkey" link on the pre-login page. Forces the browser modal.
     */
    async handleModalPasskeyLogin() {
      state.error = ''
      state.loading = true

      try {
        const options = await client.loginPasskeyStart({})

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

        await client.loginPasskeyFinish({
          response: authResponse,
        })

        const prfOutput = authResponse.clientExtensionResults as {
          prf?: localCrypto.PRFOutput
        }
        const wrapKey = localCrypto.extractPRFKey(prfOutput.prf)

        if (!wrapKey) {
          state.error =
            'This passkey does not support the encryption needed to protect your vault. Please sign in with your password instead.'
          return
        }

        const vaultData = await client.getVault({})
        if (!isVaultDataResponse(vaultData)) {
          throw new Error('Vault data was not returned.')
        }

        const passkeyCredential = getPasskeyCredential(vaultData, authResponse.id)
        if (!passkeyCredential) {
          state.error =
            'This passkey is not linked to any account. Try a different passkey or sign in with your password.'
          return
        }

        const dek = await localCrypto.decrypt(base64.decode(passkeyCredential.wrappedDEK), wrapKey)
        state.decryptedDEK = dek
        await actions.loadVaultData(vaultData)

        await actions.checkSession()
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error('Modal passkey login error:', e)
        state.error = (e as Error).message || 'Passkey sign-in failed. Please try again or sign in with your password.'
      } finally {
        state.loading = false
      }
    },

    async handleRegisterPasskey() {
      const session = state.session
      if (!session) {
        state.error = 'Not authenticated'
        return
      }

      const isNewUser = !session.credentials?.password && !session.credentials?.passkey

      if (!isNewUser && !state.decryptedDEK) {
        state.error = 'Vault not unlocked'
        return
      }

      state.error = ''
      state.loading = true

      try {
        // Step 1: Start registration and perform the WebAuthn create() ceremony with PRF enabled.
        const regOptions = await client.addPasskeyStart()

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

        const regResponse = await webauthn.startRegistration({
          optionsJSON: regOptionsWithPrf,
        })

        const wrapKey = await derivePasskeyWrapKey(regOptions, regResponse)

        let dek = state.decryptedDEK
        if (!dek) {
          if (isNewUser) {
            dek = localCrypto.generateDEK()
          } else {
            throw new Error('Vault locked')
          }
        }

        if (!wrapKey) {
          state.error = "Your authenticator doesn't support encryption. Please set up a password instead."
          state.loading = false
          return
        }

        const wrappedDEK = await localCrypto.encrypt(dek, wrapKey)
        const data = await client.addPasskeyFinish({
          response: regResponse,
          wrappedDEK: base64.encode(wrappedDEK),
        })

        if (!data.backupState) {
          alert(
            'Your passkey is not backed up to the cloud. If you lose this device, you may not be able to sign in. Consider adding a password or another passkey as a backup.',
          )
        }

        state.decryptedDEK = dek
        await actions.loadVaultData()
        navigator.go('/')
        await actions.checkSession()
      } catch (e) {
        console.error('Passkey registration error:', e)
        state.error = (e as Error).message || 'Could not set up your passkey. Please try again.'
      } finally {
        state.loading = false
      }
    },

    async loadVaultData(serverData?: api.GetVaultResponse) {
      try {
        await ensureVaultLoaded(serverData)
      } catch (e) {
        state.vaultLoaded = false
        console.error('Failed to load vault data:', e)
      }
    },

    async saveVaultData() {
      if (!state.decryptedDEK || !state.vaultData) {
        state.error = 'Vault must be unlocked first'
        return
      }

      state.error = ''

      try {
        const dataBytes = await vault.serialize(state.vaultData)
        const encryptedData = await localCrypto.encrypt(dataBytes, state.decryptedDEK)

        await client.saveVault({
          encryptedData: base64.encode(encryptedData),
          version: state.vaultVersion,
        })

        state.vaultVersion++
      } catch (e) {
        console.error('Failed to save vault:', e)
        state.error = getVaultSaveErrorMessage(e)
        throw e
      }
    },

    async saveNotificationServerUrl(notificationServerUrl: string) {
      if (!state.decryptedDEK || !state.vaultData) {
        state.error = 'Vault must be unlocked first'
        return false
      }

      let normalizedNotificationServerUrl = ''
      let normalizedDefaultNotificationServerUrl = ''

      try {
        normalizedNotificationServerUrl = normalizeNotificationServerUrl(notificationServerUrl)
        normalizedDefaultNotificationServerUrl = normalizeNotificationServerUrl(state.notificationServerUrl)
      } catch {
        state.error = `Invalid notification server URL: ${notificationServerUrl.trim()}`
        return false
      }

      const nextStoredNotificationServerUrl =
        normalizedNotificationServerUrl && normalizedNotificationServerUrl !== normalizedDefaultNotificationServerUrl
          ? normalizedNotificationServerUrl
          : undefined
      const previousNotificationServerUrl = state.vaultData.notificationServerUrl

      if ((previousNotificationServerUrl ?? '') === (nextStoredNotificationServerUrl ?? '')) {
        state.error = ''
        return true
      }

      state.loading = true
      state.error = ''
      setVaultNotificationServerUrl(nextStoredNotificationServerUrl)

      try {
        await actions.saveVaultData()
        return true
      } catch {
        setVaultNotificationServerUrl(previousNotificationServerUrl)
        return false
      } finally {
        state.loading = false
      }
    },

    async createAccount(name: string, description?: string, avatarFile?: File, options?: CreateAccountOptions) {
      if (!state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return false
      }

      state.loading = true
      state.error = ''

      if (!state.vaultLoaded && !state.vaultData) {
        try {
          await ensureVaultLoaded()
        } catch (e) {
          state.error = state.error || getErrorMessage(e, 'Failed to load vault')
          state.loading = false
          return false
        }
      }

      const vaultData = state.vaultData ?? (state.vaultData = vault.createEmpty())
      const previousSelectedAccountIndex = state.selectedAccountIndex
      const previousCreatingAccount = state.creatingAccount
      let didSaveAccount = false
      let insertedAccount = false
      let postSaveStage: 'profile' | 'notifications' = 'profile'

      try {
        const kp = blobs.generateNobleKeyPair()
        const accountUid = blobs.principalToString(kp.principal)
        const ts = Date.now()
        const profileOptions: {name: string; avatar?: string; description?: string} = {name}
        if (description) {
          profileOptions.description = description
        }

        const account: vault.Account = {
          name: accountUid,
          seed: kp.seed,
          createTime: ts,
          delegations: [],
        }

        vaultData.accounts.push(account)
        insertedAccount = true
        state.selectedAccountIndex = vaultData.accounts.length - 1

        try {
          await actions.saveVaultData()
        } catch (error) {
          if (!(error instanceof APIError) || error.statusCode !== 409) {
            throw error
          }

          await reloadVaultAfterConflict()
          const refreshedVaultData = state.vaultData ?? (state.vaultData = vault.createEmpty())
          const existingAccountIndex = refreshedVaultData.accounts.findIndex((candidate) => {
            return vault.getAccountName(candidate) === accountUid
          })

          if (existingAccountIndex === -1) {
            refreshedVaultData.accounts.push(account)
            state.selectedAccountIndex = refreshedVaultData.accounts.length - 1
          } else {
            state.selectedAccountIndex = existingAccountIndex
          }

          await actions.saveVaultData()
        }
        didSaveAccount = true
        state.creatingAccount = false

        if (avatarFile) {
          profileOptions.avatar = await uploadAvatar(avatarFile)
        }

        await publishProfile(kp, profileOptions, ts)
        // Vault runs in the browser but does not use the web app's query cache.
        // Import the pure shared publisher directly so account creation keeps the
        // auto-join behavior without pulling React Query and other broader shared
        // side effects into the client bundle.
        await joinedSite.publishDefaultJoinedSite(
          {
            accountUid,
          },
          {
            getSigner: (signerAccountUid) => {
              if (signerAccountUid !== accountUid) {
                throw new Error(`Unexpected signer account ${signerAccountUid}`)
              }
              return {
                getPublicKey: async () => kp.principal,
                sign: kp.sign.bind(kp),
              }
            },
            publish: async (input) => {
              const cids = await Promise.all(
                input.blobs.map(async (blob) => {
                  const cid = blob.cid ? CID.parse(blob.cid) : CID.createV1(cborCodec, await sha256.digest(blob.data))
                  await blockstore.put(cid, blob.data)
                  return cid.toString()
                }),
              )
              return {cids}
            },
          },
        )

        const includeNotificationEmail = Boolean(options?.notificationRegistration?.includeEmail)
        postSaveStage = 'notifications'
        await registerAccountOnNotificationServer(kp, {
          includeEmail: includeNotificationEmail,
        })

        return true
      } catch (e) {
        if (!didSaveAccount && insertedAccount && state.vaultData) {
          // The seed never made it into the vault, so discard the in-memory account.
          state.vaultData.accounts.pop()
        }
        if (!didSaveAccount) {
          state.selectedAccountIndex = previousSelectedAccountIndex
          state.creatingAccount = previousCreatingAccount
        }

        console.error('Failed to create account:', e)
        state.error =
          state.error ||
          (didSaveAccount
            ? postSaveStage === 'notifications'
              ? getNotificationRegistrationErrorMessage(e)
              : getProfilePublishErrorMessage(e)
            : getErrorMessage(e, 'Failed to create account'))
        return didSaveAccount
      } finally {
        state.loading = false
      }
    },

    async importAccount(keyFileJSON: string, password?: string) {
      if (!state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        throw new Error(state.error)
      }

      state.loading = true
      state.error = ''

      if (!state.vaultLoaded) {
        try {
          await ensureVaultLoaded()
        } catch (e) {
          state.error = state.error || getErrorMessage(e, 'Failed to load vault')
          state.loading = false
          throw e
        }
      }

      const vaultData = state.vaultData ?? (state.vaultData = vault.createEmpty())
      const previousSelectedAccountIndex = state.selectedAccountIndex
      let insertedAccount = false

      try {
        const loaded = await keyfile.load(keyFileJSON, password)
        const alreadyExists = vaultData.accounts.some((candidate) => {
          return vault.getAccountName(candidate) === loaded.publicKey
        })

        if (alreadyExists) {
          throw new Error(`Account ${loaded.publicKey} already exists in vault`)
        }

        const importedAccount: vault.Account = {
          name: loaded.publicKey,
          seed: loaded.seed,
          createTime: Date.now(),
          delegations: [],
        }

        vaultData.accounts.push(importedAccount)
        insertedAccount = true
        state.selectedAccountIndex = vaultData.accounts.length - 1

        try {
          await actions.saveVaultData()
        } catch (error) {
          if (!(error instanceof APIError) || error.statusCode !== 409) {
            throw error
          }

          await reloadVaultAfterConflict()
          const refreshedVaultData = state.vaultData ?? (state.vaultData = vault.createEmpty())
          const existingAccountIndex = refreshedVaultData.accounts.findIndex((candidate) => {
            return vault.getAccountName(candidate) === loaded.publicKey
          })

          if (existingAccountIndex !== -1) {
            throw new Error(`Account ${loaded.publicKey} already exists in vault`)
          }

          refreshedVaultData.accounts.push(importedAccount)
          state.selectedAccountIndex = refreshedVaultData.accounts.length - 1
          await actions.saveVaultData()
        }
        return loaded.publicKey
      } catch (e) {
        if (insertedAccount) {
          state.vaultData.accounts.pop()
          state.selectedAccountIndex = previousSelectedAccountIndex
        }

        // Error is surfaced to the user via state.error; no console.error
        // to avoid noisy output in tests that intentionally trigger failures.
        state.error = state.error || getErrorMessage(e, 'Failed to import account')
        throw e
      } finally {
        state.loading = false
      }
    },

    selectAccount(index: number) {
      state.selectedAccountIndex = index
    },

    async updateAccountProfile(
      principal: string,
      nextProfile: {name: string; description?: string; avatarFile?: File},
    ) {
      if (!state.vaultData || !state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return false
      }

      const account = state.vaultData.accounts.find((candidate) => {
        const kp = blobs.nobleKeyPairFromSeed(candidate.seed)
        return blobs.principalToString(kp.principal) === principal
      })

      if (!account) {
        state.error = 'Account not found'
        return false
      }

      if (state.profileLoadStates[principal] === 'unavailable' && !state.profiles[principal]) {
        state.error = 'Current profile data is temporarily unavailable. Retry once it finishes loading.'
        return false
      }

      state.loading = true
      state.error = ''

      try {
        const kp = blobs.nobleKeyPairFromSeed(account.seed)
        const currentProfile = state.profiles[principal]
        const avatar = nextProfile.avatarFile ? await uploadAvatar(nextProfile.avatarFile) : currentProfile?.avatar
        await publishProfile(kp, {
          name: nextProfile.name,
          description: nextProfile.description,
          avatar,
        })
        return true
      } catch (e) {
        console.error('Failed to update profile:', e)
        state.error = state.error || getProfilePublishErrorMessage(e)
        return false
      } finally {
        state.loading = false
      }
    },

    setCreatingAccount(open: boolean) {
      state.creatingAccount = open
      if (open) {
        state.error = ''
      }
    },

    getSelectedAccount(): vault.Account | null {
      if (
        !state.vaultData ||
        state.selectedAccountIndex < 0 ||
        state.selectedAccountIndex >= state.vaultData.accounts.length
      ) {
        return null
      }
      return state.vaultData.accounts[state.selectedAccountIndex] ?? null
    },

    async deleteAccount(principal: string) {
      if (!state.vaultData || !state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return
      }

      const index = state.vaultData.accounts.findIndex((a) => {
        const kp = blobs.nobleKeyPairFromSeed(a.seed)
        return blobs.principalToString(kp.principal) === principal
      })

      if (index === -1) {
        state.error = 'Account not found'
        return
      }

      state.loading = true
      state.error = ''

      try {
        // 1. Record the deletion as a tombstone before removing
        if (!state.vaultData.deletedAccounts) {
          state.vaultData.deletedAccounts = {}
        }
        const account = state.vaultData.accounts[index]
        if (!account) {
          state.error = 'Account not found'
          return
        }
        const accountName = vault.getAccountName(account)
        state.vaultData.deletedAccounts[accountName] = Date.now()

        // 2. Remove the account
        state.vaultData.accounts.splice(index, 1)

        // 3. Adjust selectedAccountIndex
        if (state.vaultData.accounts.length === 0) {
          state.selectedAccountIndex = -1
        } else if (state.selectedAccountIndex === index) {
          state.selectedAccountIndex = Math.max(0, index - 1)
        } else if (state.selectedAccountIndex > index) {
          state.selectedAccountIndex--
        }

        await actions.saveVaultData()
      } catch (e) {
        console.error('Failed to delete account:', e)
        state.error = state.error || getErrorMessage(e, 'Failed to delete account')
      } finally {
        state.loading = false
      }
    },

    async reorderAccount(activePrincipal: string, overPrincipal: string) {
      if (!state.vaultData || !state.decryptedDEK) {
        state.error = 'Vault must be unlocked first'
        return
      }

      if (activePrincipal === overPrincipal) return

      const oldIndex = state.vaultData.accounts.findIndex((a) => {
        const kp = blobs.nobleKeyPairFromSeed(a.seed)
        return blobs.principalToString(kp.principal) === activePrincipal
      })
      const newIndex = state.vaultData.accounts.findIndex((a) => {
        const kp = blobs.nobleKeyPairFromSeed(a.seed)
        return blobs.principalToString(kp.principal) === overPrincipal
      })

      if (oldIndex === -1 || newIndex === -1) {
        return
      }

      state.loading = true
      state.error = ''

      try {
        const [moved] = state.vaultData.accounts.splice(oldIndex, 1)
        if (!moved) throw new Error('Account not found during splice')
        state.vaultData.accounts.splice(newIndex, 0, moved)

        if (state.selectedAccountIndex === oldIndex) {
          state.selectedAccountIndex = newIndex
        } else if (state.selectedAccountIndex > oldIndex && state.selectedAccountIndex <= newIndex) {
          state.selectedAccountIndex--
        } else if (state.selectedAccountIndex < oldIndex && state.selectedAccountIndex >= newIndex) {
          state.selectedAccountIndex++
        }

        await actions.saveVaultData()
      } catch (e) {
        console.error('Failed to reorder accounts:', e)
        state.error = state.error || getErrorMessage(e, 'Failed to reorder accounts')
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
        state.error = 'Please enter a new email address'
        return
      }

      if (!state.session?.authenticated) {
        state.error = 'You must be signed in to change your email'
        return
      }

      state.error = ''
      state.loading = true

      try {
        const data = await client.changeEmailStart({
          newEmail: state.newEmail,
        })
        state.emailChangeChallengeId = data.challengeId
        navigator.go('/email/change-pending')
        actions.startPollingEmailChange()
      } catch (e) {
        state.error = (e as Error).message || 'Failed to start email change'
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
          const data = await client.changeEmailPoll({
            challengeId: state.emailChangeChallengeId,
          })

          if (data.verified && data.newEmail) {
            // Update session with new email.
            if (state.session) {
              state.session.email = data.newEmail
              state.email = data.newEmail
            }
            state.newEmail = ''
            state.emailChangeChallengeId = ''
            navigator.go('/')
            alert(`Email changed successfully to ${data.newEmail}`)
            return
          }

          attempts++
          if (attempts < maxAttempts) {
            setTimeout(poll, pollInterval)
          } else {
            state.error = 'Verification link expired. Please try again.'
            navigator.go('/email/change')
          }
        } catch (_e) {
          state.error = 'Verification failed or expired. Please try again.'
          navigator.go('/email/change')
        }
      }

      poll()
    },

    /**
     * Called when user clicks the email change magic link.
     */
    async handleVerifyEmailChangeLink(challengeId: string, token: string) {
      state.loading = true
      state.error = ''

      try {
        const data = await client.changeEmailVerifyLink({challengeId, token})
        state.newEmail = data.newEmail
      } catch (e) {
        state.error = (e as Error).message || 'Verification failed'
      } finally {
        state.loading = false
      }
    },

    /**
     * Parse delegation parameters from a URL and store the request.
     * If the URL has no delegation params, this is a no-op.
     * If params are present but invalid, sets state.error.
     */
    parseDelegationFromUrl(url: URL | string) {
      try {
        const request = hmauth.parseDelegationRequest(url)
        if (request) {
          state.delegationRequest = request
          if (request.email) {
            state.email = request.email
          }
        }
      } catch (e) {
        state.error = (e as Error).message || 'Invalid delegation request'
      }
    },

    /**
     * Parse vault handoff connection data from URL fragment and store it for post-login completion.
     * The fragment must include a handoff token and callback URL.
     */
    parseVaultConnectionFromUrl(url: URL | string) {
      try {
        const request = parseVaultConnectionRequest(url)
        if (!request) {
          return
        }

        state.vaultConnectionRequest = request
      } catch (e) {
        state.error = getErrorMessage(e, 'Invalid vault connection request')
        state.vaultConnectionRequest = null
      }
    },

    /**
     * Complete vault handoff by registering a daemon credential and sending it to the desktop callback.
     */
    async completeVaultConnection() {
      if (state.vaultConnectionInProgress) {
        return
      }
      if (!state.vaultConnectionRequest) {
        state.error = 'No desktop connection request is active.'
        return
      }
      if (!state.session?.authenticated) {
        state.error = 'Your session expired. Sign in again and retry connecting desktop.'
        return
      }
      if (!state.decryptedDEK) {
        state.error = 'Vault must be unlocked before connecting desktop.'
        return
      }

      state.vaultConnectionInProgress = true
      state.error = ''

      const {handoffToken, callbackURL} = state.vaultConnectionRequest
      try {
        const expectedVaultBaseURL = getCurrentVaultBaseURL()
        const userId = state.session.userId?.trim()
        if (!userId) {
          throw new Error('Session is missing the authenticated user ID')
        }

        const daemonSecret = crypto.getRandomValues(new Uint8Array(32))
        const encodedSecret = base64.encode(daemonSecret)
        const authKey = await localCrypto.deriveSecretCredentialAuthKey(daemonSecret)
        const wrappedDEK = await localCrypto.encrypt(state.decryptedDEK, daemonSecret)
        const credential = await client.addSecretCredential({
          authKey: base64.encode(authKey),
          wrappedDEK: base64.encode(wrappedDEK),
        })
        const handoffResp = await fetch(callbackURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            handoffToken,
            vaultUrl: expectedVaultBaseURL,
            userId,
            credentialId: credential.credentialId,
            secret: encodedSecret,
          }),
        })
        if (!handoffResp.ok) {
          const bodyText = await handoffResp.text()
          throw new Error(bodyText || 'Failed to complete vault handoff')
        }
        const handoff = (await handoffResp.json()) as VaultConnectionHandoffResponse
        if (!handoff.success) {
          throw new Error('Failed to complete vault handoff')
        }

        state.vaultConnectionRequest = null
        state.vaultConnectionSuccessMessage = VAULT_CONNECTION_SUCCESS_MESSAGE
        navigator.go('/')
      } catch (e) {
        state.error = getErrorMessage(e, 'Failed to complete vault connection')
      } finally {
        state.vaultConnectionInProgress = false
      }
    },

    /** Cancel the current desktop vault connection flow. */
    cancelVaultConnection() {
      state.error = ''
      state.vaultConnectionRequest = null
      navigator.go('/')
    },

    /** Clear the desktop connection success notice after the user sees it. */
    clearVaultConnectionSuccessMessage() {
      state.vaultConnectionSuccessMessage = ''
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
      state.error = ''
      state.loading = true

      try {
        if (!state.delegationRequest) {
          throw new Error('No active delegation request')
        }
        if (!state.decryptedDEK) {
          throw new Error('Vault is not unlocked')
        }
        if (!state.vaultData) {
          throw new Error('Vault data not loaded')
        }

        const account = state.vaultData.accounts[state.selectedAccountIndex]
        if (!account) {
          throw new Error('No account selected')
        }
        if (!state.relyingPartyOrigin) {
          throw new Error('Missing relying party origin')
        }
        const configuredVaultOrigin = new URL(state.relyingPartyOrigin).origin
        if (configuredVaultOrigin !== state.delegationRequest.vaultOrigin) {
          throw new Error('Delegation request vault origin mismatch')
        }
        await hmauth.verifyDelegationRequestProof(state.delegationRequest, configuredVaultOrigin)

        const issuerKeyPair = blobs.nobleKeyPairFromSeed(account.seed)
        const sessionKeyPrincipal = blobs.principalFromString(state.delegationRequest.sessionKeyPrincipal)
        const encoded = await hmauth.createDelegation(
          issuerKeyPair,
          sessionKeyPrincipal,
          state.delegationRequest.clientId,
        )

        await blockstore.put(encoded.cid, encoded.data)

        const delegatedSession: vault.DelegatedSession = {
          clientId: state.delegationRequest.clientId,
          deviceType: getDeviceType(),
          capability: {
            cid: encoded.cid,
            delegate: blobs.principalFromString(state.delegationRequest.sessionKeyPrincipal),
          },
          createTime: Date.now(),
        }
        account.delegations.push(delegatedSession)

        await actions.saveVaultData()

        const callbackUrl = new URL(state.delegationRequest.redirectUri)
        const callbackData = {
          account: issuerKeyPair.principal,
          capability: encoded.decoded,
          capabilityCid: encoded.cid,
          notifyServerUrl: getEffectiveNotificationServerUrl(),
        }
        const compressedCallbackData = await (async () => {
          const stream = new CompressionStream('gzip')
          const writer = stream.writable.getWriter()
          writer.write(new Uint8Array(cbor.encode(callbackData)) as Uint8Array<ArrayBuffer>)
          writer.close()

          const reader = stream.readable.getReader()
          const chunks: Uint8Array[] = []
          let totalLength = 0
          for (;;) {
            const {done, value} = await reader.read()
            if (done) {
              break
            }
            chunks.push(value)
            totalLength += value.length
          }

          const result = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          return result
        })()
        callbackUrl.searchParams.set(hmauth.PARAM_DATA, base64.encode(compressedCallbackData))
        callbackUrl.searchParams.set(hmauth.PARAM_STATE, state.delegationRequest.state)

        state.delegationRequest = null
        state.delegationConsented = false

        window.location.href = callbackUrl.toString()
      } catch (e) {
        // Error is surfaced to the user via state.error; no console.error
        // to avoid noisy output in tests that intentionally trigger failures.
        state.error = state.error || getErrorMessage(e, 'Delegation failed')
      } finally {
        state.loading = false
      }
    },

    /** Cancel the delegation flow and redirect back with an error. */
    cancelDelegation() {
      if (state.delegationRequest) {
        const url = new URL(state.delegationRequest.redirectUri)
        url.searchParams.set('error', 'access_denied')
        url.searchParams.set('state', state.delegationRequest.state)
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
      state.password = ''
      state.vaultData = null
      state.vaultVersion = 0
      state.vaultLoaded = false
      state.selectedAccountIndex = -1
      state.email = ''
      navigator.go('/')
    },
  }

  return actions
}

/** Return type of createStore for typing purposes. */
export type StoreActions = ReturnType<typeof createActions>

/**
 * Creates a new store instance with its own state and actions.
 * The client and blockstore are immutable dependencies — pass them at construction time.
 *
 * @param client - The API client to use.
 * @param blockstore - The IPFS blockstore used for blob storage.
 * @param backendHttpBaseUrl - Daemon base URL used for IPFS-backed assets.
 * @param notificationServerUrl - Notification server URL shown in the footer.
 */
export function createStore(
  client: api.ClientInterface,
  blockstore: Blockstore,
  backendHttpBaseUrl = '',
  notificationServerUrl = '',
) {
  const state = proxy<AppState>(initialState(backendHttpBaseUrl, notificationServerUrl))

  // Default navigator prevents crashes before router is connected
  let navigate = (path: string) => {
    console.warn('Navigator not connected, attempted to go to:', path)
  }

  const navigator: Navigator = {
    go: (path: string) => navigate(path),
  }

  const actions = createActions(state, client, navigator, blockstore)

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
function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useStore must be used within a StoreContext.Provider')
  }
  return store
}

/**
 * Hook to access the state with a snapshot for reactive updates.
 * This is the recommended way to read state in components.
 */
export function useAppState() {
  const {state} = useStore()
  return useSnapshot(state)
}

/**
 * Hook to access just the actions from the store.
 * Actions can be called directly to mutate state.
 */
export function useActions(): StoreActions {
  return useStore().actions
}

function getDeviceType(): vault.DelegatedSession['deviceType'] {
  if (typeof navigator === 'undefined') return undefined

  if ('userAgentData' in navigator) {
    const uaData = navigator.userAgentData as {mobile: boolean}
    return uaData.mobile ? 'mobile' : 'desktop'
  }

  // Fallback for Safari/Firefox
  const ua = navigator.userAgent
  if (/Tablet|iPad|PlayBook|Silk/i.test(ua)) {
    return 'tablet'
  }
  if (/Mobi|Android|iPhone/i.test(ua)) {
    return 'mobile'
  }
  return 'desktop'
}
