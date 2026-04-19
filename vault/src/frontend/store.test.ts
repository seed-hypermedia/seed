import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {Account, Profile} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import * as keyfile from '@shm/shared/keyfile'
import * as simplewebauthn from '@simplewebauthn/browser'
import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {code as rawCodec} from 'multiformats/codecs/raw'
import {CID} from 'multiformats/cid'
import type {SaveVaultRequest} from '@/api'
import * as joinedSite from '@shm/shared/publish-default-joined-site'
import {APIError} from './api-client'
import * as localCrypto from './crypto'
import * as notificationApi from './notification-api'
import {createStore, getPendingFlowPath} from './store'
import {createMockBlockstore, createMockClient, createSuccessMockClient} from './test-utils'
import * as vault from './vault'

// Mock simplewebauthn browser functions (external dependency).
const mockStartRegistration = spyOn(simplewebauthn, 'startRegistration')
const mockStartAuthentication = spyOn(simplewebauthn, 'startAuthentication')

/**
 * Creates vault state with the given number of accounts, each with delegations.
 * Returns the state object and references to principals for assertions.
 */
async function makeVaultState(accountCount: number) {
  const keyPairs = Array.from({length: accountCount}, () => blobs.generateNobleKeyPair())
  const profiles = await Promise.all(keyPairs.map((kp, i) => blobs.createProfile(kp, {name: `Acc ${i}`}, Date.now())))

  // Create cross-account capabilities: each account delegates to the next one's principal.
  const capabilities = await Promise.all(
    keyPairs.map((kp, i) => {
      const targetIdx = (i + 1) % accountCount
      return blobs.createCapability(kp, keyPairs[targetIdx]!.principal, 'WRITER', 0)
    }),
  )

  const accounts: vault.State['accounts'] = keyPairs.map((_kp, i) => ({
    seed: keyPairs[i]!.seed,
    createTime: Date.now(),
    delegations: [
      {
        clientId: String(i),
        createTime: 0,
        deviceType: 'desktop' as const,
        capability: {
          cid: capabilities[i]!.cid,
          delegate: keyPairs[(i + 1) % accountCount]!.principal,
        },
      },
    ],
  }))

  const principals = keyPairs.map((kp) => blobs.principalToString(kp.principal))

  return {
    vaultData: {version: 2 as const, accounts},
    principals,
  }
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>)
  writer.close()
  return collectStream(ds.readable)
}

describe('Store', () => {
  describe('getPendingFlowPath', () => {
    test('returns delegation route when delegation is pending', () => {
      expect(
        getPendingFlowPath({
          delegationRequest: {} as any,
          vaultConnectionRequest: {handoffToken: 'token', callbackURL: 'http://127.0.0.1:7777/vault-handoff'},
        }),
      ).toBe('/delegate')
    })

    test('returns connect route when desktop connection is pending', () => {
      expect(
        getPendingFlowPath({
          delegationRequest: null,
          vaultConnectionRequest: {handoffToken: 'token', callbackURL: 'http://127.0.0.1:7777/vault-handoff'},
        }),
      ).toBe('/connect')
    })

    test('returns root route when no external flow is pending', () => {
      expect(
        getPendingFlowPath({
          delegationRequest: null,
          vaultConnectionRequest: null,
        }),
      ).toBe('/')
    })
  })

  describe('handlePreLogin', () => {
    test('navigates to verify-pending when user does not exist', async () => {
      const client = createMockClient({
        preLogin: async () => ({exists: false}),
        registerStart: async () => ({
          message: 'ok',
          challengeId: 'test-challenge',
        }),
        registerPoll: async () => ({verified: false}),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'new@user.com'

      await actions.handlePreLogin()

      expect(navigate).toHaveBeenCalledWith('/verify/pending')
      expect(state.challengeId).toBe('test-challenge')
    })

    test('navigates to login when user exists', async () => {
      const client = createMockClient({
        preLogin: async () => ({
          exists: true,
          credentials: {
            password: true,
          },
        }),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'existing@user.com'

      await actions.handlePreLogin()

      expect(navigate).toHaveBeenCalledWith('/login')
      expect(state.userHasPassword).toBe(true)
    })

    test('restarts verification when an existing user has no credentials yet', async () => {
      const client = createMockClient({
        preLogin: async () => ({
          exists: true,
          credentials: {},
        }),
        registerStart: async () => ({
          message: 'ok',
          challengeId: 'retry-challenge',
        }),
        registerPoll: async () => ({verified: false}),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'existing@user.com'

      await actions.handlePreLogin()

      expect(navigate).toHaveBeenCalledWith('/verify/pending')
      expect(state.challengeId).toBe('retry-challenge')
      expect(state.userHasPassword).toBe(false)
      expect(state.userHasPasskey).toBe(false)
    })

    test('sets error on fetch failure', async () => {
      const client = createMockClient({
        preLogin: async () => {
          throw new Error('Network error')
        },
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'test@user.com'

      await actions.handlePreLogin()

      expect(state.error).toBe('Connection failed. Please try again.')
      expect(navigate).not.toHaveBeenCalled()
    })

    test('sets loading state correctly', async () => {
      let loadingDuringFetch = false
      const {state, actions} = createStore(
        createMockClient({
          preLogin: async () => {
            loadingDuringFetch = state.loading
            return {exists: false}
          },
          registerStart: async () => ({message: 'ok', challengeId: 'c'}),
          registerPoll: async () => ({verified: false}),
        }),
        createMockBlockstore(),
      )

      await actions.handlePreLogin()

      expect(loadingDuringFetch).toBe(true)
      expect(state.loading).toBe(false)
    })
  })

  describe('checkSession', () => {
    const originalLocation = window.location

    // Mock window.location for these tests
    beforeEach(() => {
      // @ts-expect-error
      delete window.location
      // @ts-expect-error
      window.location = {pathname: '/'}
    })

    afterEach(() => {
      window.location = originalLocation as any
    })

    test('redirects to credential setup if authenticated without credentials', async () => {
      const client = createMockClient({
        getSession: async () => ({
          authenticated: true,
          relyingPartyOrigin: 'https://example.com',
          email: 'test@test.com',
          credentials: {},
        }),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      await actions.checkSession()

      expect(navigate).toHaveBeenCalledWith('/auth/choose')
      expect(state.session?.authenticated).toBe(true)
      expect(state.sessionChecked).toBe(true)
    })

    test('does not redirect if authenticated with keys', async () => {
      const client = createMockClient({
        getSession: async () => ({
          authenticated: true,
          relyingPartyOrigin: 'https://example.com',
          email: 'test@test.com',
          credentials: {
            password: true,
          },
        }),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.decryptedDEK = new Uint8Array(32)
      window.location.pathname = '/vault'
      await actions.checkSession()

      expect(navigate).not.toHaveBeenCalled()
      expect(state.sessionChecked).toBe(true)
    })
  })

  describe('loadVaultData', () => {
    test('creates an empty vault when the server returns an empty encrypted payload', async () => {
      const client = createMockClient({
        getVault: async () => ({
          encryptedData: '',
          version: 7,
          credentials: [],
        }),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)

      await actions.loadVaultData()

      expect(state.vaultData).toEqual(vault.createEmpty())
      expect(state.creatingAccount).toBe(true)
      expect(state.vaultVersion).toBe(7)
    })
  })

  describe('saveNotificationServerUrl', () => {
    test('stores a custom notification server URL in encrypted vault data', async () => {
      const saveVaultDataCalls: SaveVaultRequest[] = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore(), '', 'https://notify.default.example.com')

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultVersion = 4

      await actions.saveNotificationServerUrl('https://notify.custom.example.com/path')

      expect(state.vaultData.notificationServerUrl).toBe('https://notify.custom.example.com/path')
      expect(state.vaultVersion).toBe(5)
      expect(saveVaultDataCalls).toHaveLength(1)

      const decryptedVaultData = await localCrypto.decrypt(
        base64.decode(saveVaultDataCalls[0]!.encryptedData),
        state.decryptedDEK,
      )
      const savedVaultData = await vault.deserialize(decryptedVaultData)
      expect(savedVaultData.notificationServerUrl).toBe('https://notify.custom.example.com/path')
    })

    test('resets the notification server URL override when saving the server default', async () => {
      const saveVaultDataCalls: SaveVaultRequest[] = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore(), '', 'https://notify.default.example.com')

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        notificationServerUrl: 'https://notify.custom.example.com',
        accounts: [],
      }
      state.vaultVersion = 9

      await actions.saveNotificationServerUrl('https://notify.default.example.com')

      expect(state.vaultData.notificationServerUrl).toBeUndefined()
      expect(state.vaultVersion).toBe(10)
      expect(saveVaultDataCalls).toHaveLength(1)

      const decryptedVaultData = await localCrypto.decrypt(
        base64.decode(saveVaultDataCalls[0]!.encryptedData),
        state.decryptedDEK,
      )
      const savedVaultData = await vault.deserialize(decryptedVaultData)
      expect(savedVaultData.notificationServerUrl).toBeUndefined()
    })
  })

  describe('ensureProfileLoaded', () => {
    let consoleErrorSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    test('loads profile data from the vault account API', async () => {
      const client = createMockClient({
        getAccount: async () =>
          new Account({
            id: 'alice',
            profile: new Profile({
              name: 'Alice',
              icon: 'ipfs://avatar',
              description: 'Hello',
            }),
          }),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.ensureProfileLoaded('alice')

      expect(state.profiles.alice).toEqual({
        name: 'Alice',
        avatar: 'ipfs://avatar',
        description: 'Hello',
      })
    })

    test('does not cache an empty profile response', async () => {
      const client = createMockClient({
        getAccount: async () => new Account({id: 'alice'}),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.ensureProfileLoaded('alice')

      expect(state.profiles.alice).toBeUndefined()
    })

    test('tracks unavailable profile loads so the UI can show a graceful fallback', async () => {
      const client = createMockClient({
        getAccount: async () => {
          throw new Error('profile fetch failed')
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.ensureProfileLoaded('alice')

      expect(state.profiles.alice).toBeUndefined()
      expect(state.profileLoadStates.alice).toBe('unavailable')
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch profile', expect.any(Error))
    })

    test('tracks not found profile loads separately from backend failures', async () => {
      const client = createMockClient({
        getAccount: async () => {
          throw new APIError('Account not found', 404)
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.ensureProfileLoaded('alice')

      expect(state.profiles.alice).toBeUndefined()
      expect(state.profileLoadStates.alice).toBe('not_found')
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch profile', expect.any(APIError))
    })

    test('clears a previous profile load failure after a successful retry', async () => {
      const client = createMockClient({
        getAccount: mock(async () => {
          throw new APIError('Account not found', 404)
        }),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.ensureProfileLoaded('alice')

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch profile', expect.any(APIError))

      client.getAccount = mock(
        async () =>
          new Account({
            id: 'alice',
            profile: new Profile({
              name: 'Alice',
            }),
          }),
      )

      await actions.ensureProfileLoaded('alice')

      expect(state.profileLoadStates.alice).toBeUndefined()
      expect(state.profiles.alice).toEqual({name: 'Alice', avatar: undefined, description: undefined})
    })
  })

  describe('handleStartRegistration', () => {
    test('navigates to verify-pending on success and stores challengeId', async () => {
      const client = createMockClient({
        registerStart: async () => ({
          message: 'ok',
          challengeId: 'test-challenge-123',
        }),
        registerPoll: async () => ({verified: false}),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'new@user.com'

      await actions.handleStartRegistration()

      expect(navigate).toHaveBeenCalledWith('/verify/pending')
      expect(state.challengeId).toBe('test-challenge-123')
    })

    test('sets error on failure', async () => {
      const client = createMockClient({
        registerStart: async () => {
          throw new Error('Rate limited')
        },
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      await actions.handleStartRegistration()

      expect(state.error).toBe('Rate limited')
      expect(navigate).not.toHaveBeenCalled()
    })
  })

  describe('handleVerifyLink', () => {
    test('calls verify-link API with challengeId and token', async () => {
      let receivedChallengeId = ''
      let receivedToken = ''
      const client = createMockClient({
        registerVerifyLink: async (req) => {
          receivedChallengeId = req.challengeId
          receivedToken = req.token
          return {verified: true, email: 'test@example.com'}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.handleVerifyLink('test-challenge-123', 'test-token-456')

      expect(receivedChallengeId).toBe('test-challenge-123')
      expect(receivedToken).toBe('test-token-456')
      expect(state.email).toBe('test@example.com')
    })

    test('sets error on invalid token', async () => {
      const client = createMockClient({
        registerVerifyLink: async () => {
          throw new Error('Invalid or expired link')
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      await actions.handleVerifyLink('invalid-challenge', 'invalid-token')

      expect(state.error).toBe('Invalid or expired link')
    })
  })

  describe('handleSetPassword', () => {
    test('validates password match', async () => {
      const {state, actions} = createStore(createMockClient(), createMockBlockstore())
      state.password = 'password1'
      state.confirmPassword = 'password2'

      await actions.handleSetPassword()

      expect(state.error).toBe('Passwords do not match')
    })

    test('validates password strength', async () => {
      const {state, actions} = createStore(createMockClient(), createMockBlockstore())

      // Use a genuinely weak password (< 8 chars).
      state.password = 'weak'
      state.confirmPassword = 'weak'

      await actions.handleSetPassword()

      expect(state.error).toContain('too weak')
    })
  })

  describe('handleLogout', () => {
    test('resets session state and navigates to pre-login', async () => {
      const client = createMockClient({
        logout: async () => ({success: true}),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://example.com',
        email: 'test@test.com',
      }
      state.decryptedDEK = new Uint8Array(64)
      state.password = 'secret'

      await actions.handleLogout()

      expect(state.session).toBeNull()
      expect(state.decryptedDEK).toBeNull()
      expect(state.password).toBe('')
      expect(navigate).toHaveBeenCalledWith('/')
    })
  })

  describe('handleSetPasskey', () => {
    test('sets error when user cancels registration prompt', async () => {
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const {state, actions} = createStore(
        createSuccessMockClient({
          getSession: async () => ({
            authenticated: true,
            relyingPartyOrigin: 'https://example.com',
            email: 'test@passkey.com',
          }),
        }),
        createMockBlockstore(),
      )
      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://example.com',
      }

      mockStartRegistration.mockRejectedValueOnce(new Error('The operation was canceled'))

      await actions.handleSetPasskey()

      expect(state.error).toContain('try again')
      expect(state.session).not.toBeNull()

      consoleErrorSpy.mockRestore()
      mockStartRegistration.mockReset()
    })

    test('completes registration with PRF from auth fallback', async () => {
      const addPasskeyFinish = mock(async (_req: {response: {id: string}; wrappedDEK: string}) => ({
        success: true,
        credentialId: 'cred-1',
        backupEligible: true,
        backupState: true,
        prfEnabled: true,
      }))
      const loginPasskeyStart = mock(async () => ({
        challenge: 'server-login-should-not-run',
        allowCredentials: [],
      }))
      const {state, actions} = createStore(
        createSuccessMockClient({
          addPasskeyFinish,
          getSession: async () => ({
            authenticated: true,
            relyingPartyOrigin: 'https://example.com',
            email: 'test@passkey.com',
          }),
          loginPasskeyStart,
        }),
        createMockBlockstore(),
      )
      state.email = 'test@passkey.com'
      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://example.com',
      }

      // Registration succeeds but without PRF output.
      mockStartRegistration.mockResolvedValueOnce({
        id: 'cred123',
        rawId: 'cred123',
        type: 'public-key',
        response: {
          clientDataJSON: 'mock-client-data',
          attestationObject: 'mock-attestation',
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {prf: {enabled: true}},
      } as unknown as Awaited<ReturnType<typeof simplewebauthn.startRegistration>>)

      // Auth fallback provides PRF output.
      mockStartAuthentication.mockResolvedValueOnce({
        id: 'cred123',
        rawId: 'cred123',
        type: 'public-key',
        response: {
          clientDataJSON: 'mock-client-data',
          authenticatorData: 'mock-auth-data',
          signature: 'mock-signature',
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {
          prf: {
            results: {
              first: new Uint8Array(32).buffer,
            },
          },
        },
      } as unknown as Awaited<ReturnType<typeof simplewebauthn.startAuthentication>>)

      await actions.handleSetPasskey()

      expect(state.error).toBe('')
      expect(state.decryptedDEK).not.toBeNull()
      expect(addPasskeyFinish).toHaveBeenCalledTimes(1)
      const firstAddPasskeyFinishCall = addPasskeyFinish.mock.calls.at(0)?.[0]
      expect(firstAddPasskeyFinishCall).toMatchObject({
        response: {id: 'cred123'},
      })
      expect(firstAddPasskeyFinishCall?.wrappedDEK).toBeTruthy()
      expect(loginPasskeyStart).not.toHaveBeenCalled()

      mockStartRegistration.mockReset()
      mockStartAuthentication.mockReset()
    })
  })

  describe('createAccount', () => {
    test('creates an account when description is omitted', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const saveVaultDataCalls: unknown[] = []
      const publishCalls: Array<{cid: unknown; data: Uint8Array}> = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(
        client,
        createMockBlockstore({
          put: async (cid, data) => {
            publishCalls.push({cid, data})
          },
        }),
      )

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      expect(state.vaultData!.accounts.length).toBe(1)
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.creatingAccount).toBe(false)
      expect(state.error).toBe('')
      expect(saveVaultDataCalls.length).toBe(1)
      expect(publishCalls.length).toBe(1)
      expect(publishDefaultJoinedSiteSpy).toHaveBeenCalledTimes(1)
      expect(publishDefaultJoinedSiteSpy.mock.calls[0]?.[0]).toEqual({
        accountUid: expect.any(String),
      })
      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('creates an account when the vault payload has not loaded yet', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        getVault: async () => ({
          encryptedData: '',
          version: 0,
          credentials: [],
        }),
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = null
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      const vaultData = state.vaultData as vault.State | null
      expect(vaultData).not.toBeNull()
      expect(vaultData?.version).toBe(2)
      expect(vaultData?.accounts).toEqual([expect.objectContaining({createTime: expect.any(Number), delegations: []})])
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.creatingAccount).toBe(false)
      expect(state.error).toBe('')
      expect(saveVaultDataCalls.length).toBe(1)

      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('waits for the initial vault load before saving a new account', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const saveVaultDataCalls: Array<{version: number}> = []
      let resolveGetVault: (value: {encryptedData: string; version: number; credentials: []}) => void = () => {}
      const client = createMockClient({
        getVault: () =>
          new Promise<{encryptedData: string; version: number; credentials: []}>((resolve) => {
            resolveGetVault = resolve
          }),
        saveVault: async (req) => {
          saveVaultDataCalls.push({version: req.version})
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = null
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      const initialLoad = actions.loadVaultData()
      const createAccountPromise = actions.createAccount('Test')

      resolveGetVault({
        encryptedData: '',
        version: 7,
        credentials: [],
      })

      await initialLoad
      await createAccountPromise

      const vaultData = state.vaultData as vault.State | null

      expect(saveVaultDataCalls).toEqual([{version: 7}])
      expect(state.vaultVersion).toBe(8)
      expect(vaultData?.accounts).toHaveLength(1)
      expect(state.error).toBe('')

      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('does not save a new account when the initial vault load fails', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const saveVault = mock(async () => ({success: true}))
      const client = createMockClient({
        getVault: async () => {
          throw new Error('vault load failed')
        },
        saveVault,
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = null
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      expect(saveVault).not.toHaveBeenCalled()
      expect(state.vaultData).toBeNull()
      expect(state.selectedAccountIndex).toBe(-1)
      expect(state.creatingAccount).toBe(true)
      expect(state.error).toBe('vault load failed')
      expect(publishDefaultJoinedSiteSpy).not.toHaveBeenCalled()

      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('refetches and retries account creation after a version conflict', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const saveVaultDataCalls: number[] = []
      const client = createMockClient({
        getVault: mock(async () => ({
          encryptedData: '',
          version: 7,
          credentials: [],
        })),
        saveVault: mock(async (req) => {
          saveVaultDataCalls.push(req.version)
          if (saveVaultDataCalls.length === 1) {
            throw new APIError('Vault has been modified by another session. Please reload.', 409)
          }
          return {success: true}
        }),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      expect(saveVaultDataCalls).toEqual([0, 7])
      expect(client.getVault).toHaveBeenCalledTimes(1)
      expect(state.vaultData?.accounts).toHaveLength(1)
      expect(state.vaultData?.accounts[0]?.name).toBe(
        blobs.principalToString(blobs.nobleKeyPairFromSeed(state.vaultData!.accounts[0]!.seed).principal),
      )
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.creatingAccount).toBe(false)
      expect(state.error).toBe('')

      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('rolls back local state without publishing when vault save fails', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const client = createMockClient({
        saveVault: async () => ({success: true}),
      })
      const publishCalls: Array<{cid: unknown; data: Uint8Array}> = []
      const {state, actions} = createStore(
        client,
        createMockBlockstore({
          put: async (cid, data) => {
            publishCalls.push({cid, data})
          },
        }),
      )
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const serializeSpy = spyOn(vault, 'serialize').mockRejectedValueOnce(new Error('dag-cbor failed'))

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test', 'Description')

      expect(state.vaultData!.accounts.length).toBe(0)
      expect(state.selectedAccountIndex).toBe(-1)
      expect(state.creatingAccount).toBe(true)
      expect(state.error).toContain('dag-cbor failed')
      expect(publishCalls.length).toBe(0)
      expect(publishDefaultJoinedSiteSpy).not.toHaveBeenCalled()
      serializeSpy.mockRestore()
      consoleErrorSpy.mockRestore()
      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('surfaces a backend-unavailable error when saving the new account fails over the network', async () => {
      const client = createMockClient({
        saveVault: async () => {
          throw new TypeError('Load failed')
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      expect(state.vaultData!.accounts.length).toBe(0)
      expect(state.selectedAccountIndex).toBe(-1)
      expect(state.creatingAccount).toBe(true)
      expect(state.error).toBe(
        "Couldn't reach the Vault backend to save your changes. Make sure the backend server is running and try again.",
      )

      consoleErrorSpy.mockRestore()
    })

    test('keeps the saved account when publishing the new profile fails', async () => {
      const callOrder: string[] = []
      const client = createMockClient({
        saveVault: async () => {
          callOrder.push('save')
          return {success: true}
        },
      })
      const {state, actions} = createStore(
        client,
        createMockBlockstore({
          put: async () => {
            callOrder.push('put')
            throw new TypeError('Load failed')
          },
        }),
      )
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      await actions.createAccount('Test')

      expect(callOrder).toEqual(['save', 'put'])
      expect(state.vaultData!.accounts.length).toBe(1)
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.creatingAccount).toBe(false)
      expect(state.error).toBe(
        "Couldn't reach the Vault backend to publish your profile. Make sure the backend server is running and try again.",
      )

      const principal = blobs.principalToString(
        blobs.nobleKeyPairFromSeed(state.vaultData!.accounts[0]!.seed).principal,
      )
      expect(state.profiles[principal]).toBeUndefined()
      expect(state.profileLoadStates[principal]).toBeUndefined()

      consoleErrorSpy.mockRestore()
    })

    test('uploads an avatar block before publishing the new profile', async () => {
      // publishDefaultJoinedSite publishes an extra Contact blob for the SHM site.
      // That's not relevant to this test (avatar → profile order), so mock it out.
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockImplementation(
        async () => true,
      )

      const published: Array<{cid: string; data: Uint8Array}> = []
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore({
          put: async (cid, data) => {
            published.push({cid: cid.toString(), data})
          },
        }),
      )

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1
      state.creatingAccount = true

      const avatarBytes = new Uint8Array([1, 2, 3, 4, 5])
      const avatarFile = new File([avatarBytes], 'avatar.png', {type: 'image/png'})

      await actions.createAccount('Test', 'Description', avatarFile)

      expect(published.length).toBe(2)
      expect(published[0]?.data).toEqual(avatarBytes)
      expect(CID.parse(published[0]!.cid).code).toBe(rawCodec)

      const profileBlob = published[1]
      expect(profileBlob).toBeDefined()
      const decoded = blobs.decodeBlob<blobs.Profile>(profileBlob!.data, CID.parse(profileBlob!.cid))
      expect(decoded.decoded.avatar).toBe(`ipfs://${published[0]!.cid}`)
      expect(decoded.decoded.description).toBe('Description')

      publishDefaultJoinedSiteSpy.mockRestore()
    })

    test('registers the new account on the notification server by default without an email', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const registerNotificationInboxSpy = spyOn(notificationApi, 'registerNotificationInbox').mockResolvedValue(true)
      const setNotificationConfigSpy = spyOn(notificationApi, 'setNotificationConfig').mockResolvedValue({
        accountId: 'account-default',
        email: null,
        verifiedTime: null,
        verificationSendTime: null,
        verificationExpired: false,
        isRegistered: true,
      })
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore(),
        '',
        'https://notify.default.example.com',
      )

      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://vault.example.com',
        email: 'notify@example.com',
      }
      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }

      try {
        const didCreateAccount = await actions.createAccount('Test')

        expect(didCreateAccount).toBe(true)
        expect(registerNotificationInboxSpy).toHaveBeenCalledTimes(1)
        expect(setNotificationConfigSpy).not.toHaveBeenCalled()

        const [notifyServiceHost, signer] = registerNotificationInboxSpy.mock.calls[0]!
        expect(notifyServiceHost).toBe('https://notify.default.example.com')

        const createdAccount = state.vaultData!.accounts[0]
        expect(createdAccount).toBeDefined()
        expect(blobs.principalToString(signer.principal)).toBe(
          blobs.principalToString(blobs.nobleKeyPairFromSeed(createdAccount!.seed).principal),
        )
      } finally {
        registerNotificationInboxSpy.mockRestore()
        setNotificationConfigSpy.mockRestore()
        publishDefaultJoinedSiteSpy.mockRestore()
      }
    })

    test('registers the new account on the notification server with the user email when requested', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const registerNotificationInboxSpy = spyOn(notificationApi, 'registerNotificationInbox').mockResolvedValue(true)
      const setNotificationConfigSpy = spyOn(notificationApi, 'setNotificationConfig').mockResolvedValue({
        accountId: 'account-1',
        email: 'notify@example.com',
        verifiedTime: null,
        verificationSendTime: null,
        verificationExpired: false,
        isRegistered: true,
      })
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore(),
        '',
        'https://notify.default.example.com',
      )

      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://vault.example.com',
        email: 'notify@example.com',
      }
      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }

      try {
        const didCreateAccount = await actions.createAccount('Test', undefined, undefined, {
          notificationRegistration: {
            includeEmail: true,
          },
        })

        expect(didCreateAccount).toBe(true)
        expect(registerNotificationInboxSpy).toHaveBeenCalledTimes(1)
        expect(setNotificationConfigSpy).toHaveBeenCalledTimes(1)

        const [notifyServiceHost, signer] = registerNotificationInboxSpy.mock.calls[0]!
        expect(notifyServiceHost).toBe('https://notify.default.example.com')
        const createdAccount = state.vaultData!.accounts[0]
        expect(createdAccount).toBeDefined()
        expect(blobs.principalToString(signer.principal)).toBe(
          blobs.principalToString(blobs.nobleKeyPairFromSeed(createdAccount!.seed).principal),
        )

        const [configHost, configSigner, configEmail, configPrevalidation] = setNotificationConfigSpy.mock.calls[0]!
        expect(configHost).toBe('https://notify.default.example.com')
        expect(blobs.principalToString(configSigner.principal)).toBe(
          blobs.principalToString(blobs.nobleKeyPairFromSeed(createdAccount!.seed).principal),
        )
        expect(configEmail).toBe('notify@example.com')
        expect(configPrevalidation).toBeNull()
      } finally {
        registerNotificationInboxSpy.mockRestore()
        setNotificationConfigSpy.mockRestore()
        publishDefaultJoinedSiteSpy.mockRestore()
      }
    })

    test('registers the new account on the notification server without an email when requested', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const registerNotificationInboxSpy = spyOn(notificationApi, 'registerNotificationInbox').mockResolvedValue(true)
      const setNotificationConfigSpy = spyOn(notificationApi, 'setNotificationConfig').mockResolvedValue({
        accountId: 'account-2',
        email: null,
        verifiedTime: null,
        verificationSendTime: null,
        verificationExpired: false,
        isRegistered: true,
      })
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore(),
        '',
        'https://notify.default.example.com',
      )

      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://vault.example.com',
        email: 'notify@example.com',
      }
      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }

      try {
        const didCreateAccount = await actions.createAccount('Test', undefined, undefined, {
          notificationRegistration: {
            includeEmail: false,
          },
        })

        expect(didCreateAccount).toBe(true)
        expect(registerNotificationInboxSpy).toHaveBeenCalledTimes(1)
        expect(setNotificationConfigSpy).not.toHaveBeenCalled()

        const [notifyServiceHost, signer] = registerNotificationInboxSpy.mock.calls[0]!
        expect(notifyServiceHost).toBe('https://notify.default.example.com')

        const createdAccount = state.vaultData!.accounts[0]
        expect(createdAccount).toBeDefined()
        expect(blobs.principalToString(signer.principal)).toBe(
          blobs.principalToString(blobs.nobleKeyPairFromSeed(createdAccount!.seed).principal),
        )
      } finally {
        registerNotificationInboxSpy.mockRestore()
        setNotificationConfigSpy.mockRestore()
        publishDefaultJoinedSiteSpy.mockRestore()
      }
    })
  })

  describe('importAccount', () => {
    test('imports a plaintext key file into the vault', async () => {
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())
      const kp = blobs.generateNobleKeyPair()

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1

      const payload = await keyfile.create({
        publicKey: blobs.principalToString(kp.principal),
        key: kp.seed,
        createTime: '2026-03-17T00:00:00.000Z',
      })

      const principal = await actions.importAccount(keyfile.stringify(payload))

      expect(principal).toBe(blobs.principalToString(kp.principal))
      expect(state.vaultData!.accounts).toHaveLength(1)
      expect(state.vaultData!.accounts[0]!.name).toBe(blobs.principalToString(kp.principal))
      expect(state.vaultData!.accounts[0]!.seed).toEqual(kp.seed)
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.error).toBe('')
      expect(saveVaultDataCalls).toHaveLength(1)
    })

    test('imports an encrypted key file into the vault', async () => {
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore(),
      )
      const kp = blobs.generateNobleKeyPair()

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true

      const payload = await keyfile.create({
        publicKey: blobs.principalToString(kp.principal),
        key: kp.seed,
        password: 'secret-password',
        createTime: '2026-03-17T00:00:00.000Z',
      })

      await actions.importAccount(keyfile.stringify(payload), 'secret-password')

      expect(state.vaultData!.accounts).toHaveLength(1)
      expect(state.vaultData!.accounts[0]!.seed).toEqual(kp.seed)
    })

    test('rejects duplicate account imports', async () => {
      const {state, actions} = createStore(
        createMockClient({
          saveVault: async () => ({success: true}),
        }),
        createMockBlockstore(),
      )
      const kp = blobs.generateNobleKeyPair()

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [
          {
            seed: kp.seed,
            createTime: Date.now(),
            delegations: [],
          },
        ],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = 0

      const payload = await keyfile.create({
        publicKey: blobs.principalToString(kp.principal),
        key: kp.seed,
        createTime: '2026-03-17T00:00:00.000Z',
      })

      await expect(actions.importAccount(keyfile.stringify(payload))).rejects.toThrow(
        `Account ${blobs.principalToString(kp.principal)} already exists in vault`,
      )
      expect(state.vaultData!.accounts).toHaveLength(1)
      expect(state.selectedAccountIndex).toBe(0)
    })

    test('refetches and retries account import after a version conflict', async () => {
      const kp = blobs.generateNobleKeyPair()
      const saveVaultDataCalls: number[] = []
      const client = createMockClient({
        getVault: mock(async () => ({
          encryptedData: '',
          version: 4,
          credentials: [],
        })),
        saveVault: mock(async (req) => {
          saveVaultDataCalls.push(req.version)
          if (saveVaultDataCalls.length === 1) {
            throw new APIError('Vault has been modified by another session. Please reload.', 409)
          }
          return {success: true}
        }),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }
      state.vaultLoaded = true
      state.selectedAccountIndex = -1

      const payload = await keyfile.create({
        publicKey: blobs.principalToString(kp.principal),
        key: kp.seed,
        createTime: '2026-03-17T00:00:00.000Z',
      })

      const principal = await actions.importAccount(keyfile.stringify(payload))

      expect(principal).toBe(blobs.principalToString(kp.principal))
      expect(saveVaultDataCalls).toEqual([0, 4])
      expect(client.getVault).toHaveBeenCalledTimes(1)
      expect(state.vaultData?.accounts).toHaveLength(1)
      expect(state.vaultData?.accounts[0]?.name).toBe(blobs.principalToString(kp.principal))
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.error).toBe('')
    })
  })

  describe('updateAccountProfile', () => {
    test('publishes an updated profile and preserves cached avatar data', async () => {
      const published: Array<{cid: unknown; data: Uint8Array}> = []
      const {state, actions} = createStore(
        createMockClient(),
        createMockBlockstore({
          put: async (cid, data) => {
            published.push({cid, data})
          },
        }),
      )

      const kp = blobs.generateNobleKeyPair()
      const principal = blobs.principalToString(kp.principal)

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [
          {
            seed: kp.seed,
            createTime: Date.now(),
            delegations: [],
          },
        ],
      }
      state.profiles[principal] = {
        name: 'Alice',
        avatar: 'ipfs://avatar',
        description: 'Old bio',
      }

      const didUpdate = await actions.updateAccountProfile(principal, {
        name: 'Alice Updated',
        description: 'New bio',
      })

      expect(didUpdate).toBe(true)
      expect(state.profiles[principal]).toEqual({
        name: 'Alice Updated',
        avatar: 'ipfs://avatar',
        description: 'New bio',
      })
      expect(state.profileLoadStates[principal]).toBeUndefined()
      expect(published.length).toBe(1)

      const publishedProfile = published[0]
      expect(publishedProfile).toBeDefined()
      const decoded = blobs.decodeBlob<blobs.Profile>(publishedProfile!.data, publishedProfile!.cid as any)
      expect(decoded.decoded.name).toBe('Alice Updated')
      expect(decoded.decoded.description).toBe('New bio')
      expect(decoded.decoded.avatar).toBe('ipfs://avatar')
      expect(blobs.principalToString(decoded.decoded.signer)).toBe(principal)
    })

    test('uploads a replacement avatar and publishes its ipfs URI', async () => {
      const published: Array<{cid: string; data: Uint8Array}> = []
      const {state, actions} = createStore(
        createMockClient(),
        createMockBlockstore({
          put: async (cid, data) => {
            published.push({cid: cid.toString(), data})
          },
        }),
      )

      const kp = blobs.generateNobleKeyPair()
      const principal = blobs.principalToString(kp.principal)

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [
          {
            seed: kp.seed,
            createTime: Date.now(),
            delegations: [],
          },
        ],
      }
      state.profiles[principal] = {
        name: 'Alice',
        avatar: 'ipfs://old-avatar',
        description: 'Old bio',
      }

      const avatarBytes = new Uint8Array([9, 8, 7, 6])
      const avatarFile = new File([avatarBytes], 'next-avatar.png', {type: 'image/png'})

      const didUpdate = await actions.updateAccountProfile(principal, {
        name: 'Alice Updated',
        description: 'New bio',
        avatarFile,
      })

      expect(didUpdate).toBe(true)
      expect(published.length).toBe(2)
      expect(published[0]?.data).toEqual(avatarBytes)
      expect(CID.parse(published[0]!.cid).code).toBe(rawCodec)
      expect(state.profiles[principal]).toEqual({
        name: 'Alice Updated',
        avatar: `ipfs://${published[0]!.cid}`,
        description: 'New bio',
      })

      const profileBlob = published[1]
      expect(profileBlob).toBeDefined()
      const decoded = blobs.decodeBlob<blobs.Profile>(profileBlob!.data, CID.parse(profileBlob!.cid))
      expect(decoded.decoded.avatar).toBe(`ipfs://${published[0]!.cid}`)
      expect(decoded.decoded.description).toBe('New bio')
    })

    test('repairs a missing profile by publishing a fresh profile blob', async () => {
      const published: Array<{cid: unknown; data: Uint8Array}> = []
      const {state, actions} = createStore(
        createMockClient(),
        createMockBlockstore({
          put: async (cid, data) => {
            published.push({cid, data})
          },
        }),
      )

      const kp = blobs.generateNobleKeyPair()
      const principal = blobs.principalToString(kp.principal)

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [
          {
            seed: kp.seed,
            createTime: Date.now(),
            delegations: [],
          },
        ],
      }
      state.profileLoadStates[principal] = 'not_found'

      const didUpdate = await actions.updateAccountProfile(principal, {name: 'Recovered'})

      expect(didUpdate).toBe(true)
      expect(state.profiles[principal]).toEqual({
        name: 'Recovered',
        avatar: undefined,
        description: undefined,
      })
      expect(state.profileLoadStates[principal]).toBeUndefined()
      expect(published.length).toBe(1)

      const publishedProfile = published[0]
      expect(publishedProfile).toBeDefined()
      const decoded = blobs.decodeBlob<blobs.Profile>(publishedProfile!.data, publishedProfile!.cid as any)
      expect(decoded.decoded.name).toBe('Recovered')
      expect(decoded.decoded.avatar).toBeUndefined()
      expect(decoded.decoded.description).toBeUndefined()
    })

    test('refuses to overwrite a profile when the current state is unavailable', async () => {
      const published: Array<{cid: unknown; data: Uint8Array}> = []
      const {state, actions} = createStore(
        createMockClient(),
        createMockBlockstore({
          put: async (cid, data) => {
            published.push({cid, data})
          },
        }),
      )

      const kp = blobs.generateNobleKeyPair()
      const principal = blobs.principalToString(kp.principal)

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [
          {
            seed: kp.seed,
            createTime: Date.now(),
            delegations: [],
          },
        ],
      }
      state.profileLoadStates[principal] = 'unavailable'

      const didUpdate = await actions.updateAccountProfile(principal, {name: 'Should Not Publish'})

      expect(didUpdate).toBe(false)
      expect(state.error).toBe('Current profile data is temporarily unavailable. Retry once it finishes loading.')
      expect(published.length).toBe(0)
      expect(state.profiles[principal]).toBeUndefined()
      expect(state.profileLoadStates[principal]).toBe('unavailable')
    })
  })

  describe('deleteAccount', () => {
    test('removes account and related delegations, and updates indexes', async () => {
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      const {vaultData} = await makeVaultState(3)

      // Add extra cross-delegation to account 1 for richer coverage.
      const extraCap = await blobs.createCapability(
        blobs.generateNobleKeyPair(), // issuer doesn't matter for this test
        blobs.generateNobleKeyPair().principal,
        'WRITER',
        0,
      )
      vaultData.accounts[1]!.delegations.push({
        clientId: '1b',
        createTime: 0,
        deviceType: 'mobile',
        capability: {
          cid: extraCap.cid,
          delegate: extraCap.decoded.delegate,
        },
      })

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = vaultData
      state.selectedAccountIndex = 1

      const kp2 = blobs.nobleKeyPairFromSeed(state.vaultData!.accounts[1]!.seed)
      const principal2 = blobs.principalToString(kp2.principal)
      await actions.deleteAccount(principal2)

      expect(state.vaultData!.accounts.length).toBe(2)
      // They don't have stored profiles anymore, skip name tests

      expect(state.selectedAccountIndex).toBe(0)
      expect(saveVaultDataCalls.length).toBe(1)
    })

    test('records deletion tombstone in deletedAccounts before removing account', async () => {
      const client = createMockClient({
        saveVault: async () => ({success: true}),
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      const {vaultData, principals} = await makeVaultState(1)

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = vaultData
      state.selectedAccountIndex = 0

      const principal = principals[0]!

      await actions.deleteAccount(principal)

      expect(state.vaultData!.accounts.length).toBe(0)
      expect(state.vaultData!.deletedAccounts).toBeDefined()
      expect(state.vaultData!.deletedAccounts![principal]).toBeGreaterThan(0)
    })
  })

  describe('reorderAccount', () => {
    test('moves account correctly, shifts selection and delegations', async () => {
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        saveVault: async (req) => {
          saveVaultDataCalls.push(req)
          return {success: true}
        },
      })
      const {state, actions} = createStore(client, createMockBlockstore())

      const {vaultData, principals} = await makeVaultState(3)
      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = vaultData
      state.selectedAccountIndex = 0

      // Move index 0 to index 2
      await actions.reorderAccount(principals[0]!, principals[2]!)

      expect(state.vaultData!.accounts.length).toBe(3)
      // Name properties no longer stored on vault accounts.

      // The selected account was 0 ("Acc 0"). It moved to index 2.
      expect(state.selectedAccountIndex).toBe(2)

      // Delegations correctly follow their respective accounts
      expect(state.vaultData!.accounts[0]!.delegations[0]!.clientId).toBe('1')
      expect(state.vaultData!.accounts[1]!.delegations[0]!.clientId).toBe('2')
      expect(state.vaultData!.accounts[2]!.delegations[0]!.clientId).toBe('0')

      expect(saveVaultDataCalls.length).toBe(1)
    })
  })
})

describe('delegation flow', () => {
  const originalLocation = window.location

  async function makeSignedDelegationUrl(
    clientId = 'https://example.com',
    redirectUri = 'https://example.com/callback',
    vaultOrigin = 'https://example.com',
  ) {
    const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
    const sessionKeyPrincipal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
    const state = 'AAAAAAAAAAAAAAAAAAAAAA'
    const ts = Date.now()
    const unsignedUrl = new URL(`${vaultOrigin}/delegate`)
    unsignedUrl.searchParams.set('client_id', clientId)
    unsignedUrl.searchParams.set('redirect_uri', redirectUri)
    unsignedUrl.searchParams.set('session_key', sessionKeyPrincipal)
    unsignedUrl.searchParams.set('state', state)
    unsignedUrl.searchParams.set('ts', String(ts))
    const payload = new TextEncoder().encode(unsignedUrl.toString())
    const proof = new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519' as unknown as AlgorithmIdentifier,
        keyPair.privateKey,
        payload as ArrayBufferView<ArrayBuffer>,
      ),
    )
    const proofBase64 = base64.encode(proof)
    const delimiter = unsignedUrl.search ? '&' : '?'
    const url = new URL(`${unsignedUrl.toString()}${delimiter}proof=${encodeURIComponent(proofBase64)}`)
    return {url, state}
  }

  async function setupDelegationState(
    store: ReturnType<typeof createStore>,
    delegationUrl: URL,
    blockstore: {put: (cid: any, data: Uint8Array) => Promise<void>},
  ) {
    store.actions.parseDelegationFromUrl(delegationUrl)

    const kp = blobs.generateNobleKeyPair()
    const ts = Date.now()
    const profile = await blobs.createProfile(kp, {name: 'Test'}, ts)

    // Pre-populate the blockstore so completeDelegation can fetch the profile blob.
    await blockstore.put(profile.cid, profile.data)

    store.state.decryptedDEK = new Uint8Array(32)
    store.state.vaultData = {
      version: 2,
      accounts: [
        {
          seed: kp.seed,
          createTime: ts,
          delegations: [],
        },
      ],
    }
    store.state.selectedAccountIndex = 0
    store.state.vaultVersion = 0
    store.state.relyingPartyOrigin = 'https://example.com'
  }

  beforeEach(() => {
    // @ts-expect-error
    delete window.location
    // @ts-expect-error
    window.location = {
      href: '',
      pathname: '/',
      origin: 'https://example.com',
    }
  })

  afterEach(() => {
    window.location = originalLocation as any
  })

  test('completes delegation with signed protocol request and redirects with state', async () => {
    const saveVaultDataCalls: unknown[] = []
    const client = createMockClient({
      saveVault: async (req) => {
        saveVaultDataCalls.push(req)
        return {success: true}
      },
    })
    const bs = createMockBlockstore()
    const store = createStore(client, bs, '', 'https://notify.example.com')
    const request = await makeSignedDelegationUrl()
    await setupDelegationState(store, request.url, bs)

    await store.actions.completeDelegation()

    expect(saveVaultDataCalls.length).toBe(1)
    expect(window.location.href).toContain('https://example.com/callback')
    expect(window.location.href).toContain('data=')
    expect(window.location.href).toContain(`state=${request.state}`)
    const redirectUrl = new URL(window.location.href)
    const callbackData = cbor.decode<{notifyServerUrl: string}>(
      await decompress(base64.decode(redirectUrl.searchParams.get('data')!)),
    )
    expect(callbackData.notifyServerUrl).toBe('https://notify.example.com')
    expect(store.state.vaultData!.accounts[0]!.delegations.length).toBe(1)
    expect(store.state.vaultData!.accounts[0]!.delegations[0]!.deviceType).toBeDefined()
    expect(store.state.delegationRequest).toBeNull()
    expect(store.state.delegationConsented).toBe(false)
    expect(store.state.error).toBe('')
  })

  test('uses the vault notification server URL override during delegation completion', async () => {
    const bs = createMockBlockstore()
    const store = createStore(
      createMockClient({
        saveVault: async () => ({success: true}),
      }),
      bs,
      '',
      'https://notify.default.example.com',
    )
    const request = await makeSignedDelegationUrl()
    await setupDelegationState(store, request.url, bs)
    store.state.vaultData!.notificationServerUrl = 'https://notify.custom.example.com'

    await store.actions.completeDelegation()

    const redirectUrl = new URL(window.location.href)
    const callbackData = cbor.decode<{notifyServerUrl: string}>(
      await decompress(base64.decode(redirectUrl.searchParams.get('data')!)),
    )

    expect(callbackData.notifyServerUrl).toBe('https://notify.custom.example.com')
  })

  test('surfaces serialization errors and does not redirect during delegation completion', async () => {
    const bs = createMockBlockstore()
    const store = createStore(createMockClient(), bs)
    const request = await makeSignedDelegationUrl()
    await setupDelegationState(store, request.url, bs)

    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const serializeSpy = spyOn(vault, 'serialize').mockRejectedValueOnce(new Error('dag-cbor failed'))

    await store.actions.completeDelegation()

    expect(store.state.error).toContain('dag-cbor failed')
    expect(store.state.delegationRequest).not.toBeNull()
    expect(window.location.href).toBe('')
    serializeSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  test('rejects tampered proof during delegation completion', async () => {
    const bs = createMockBlockstore()
    const store = createStore(createMockClient(), bs)
    const request = await makeSignedDelegationUrl()
    request.url.searchParams.set('proof', 'bad-proof')
    await setupDelegationState(store, request.url, bs)

    await store.actions.completeDelegation()

    expect(store.state.error).toContain('Invalid proof signature encoding')
  })

  test('cancelDelegation redirects with error param', async () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())
    const sessionKeyPair = blobs.generateNobleKeyPair()

    state.delegationRequest = {
      originalUrl:
        'https://example.com/vault/delegate?client_id=https%3A%2F%2Fexample.com&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&session_key=missing&state=AAAAAAAAAAAAAAAAAAAAAA&ts=1700000000000&proof=cA',
      clientId: 'https://example.com',
      redirectUri: 'https://example.com/callback',
      sessionKeyPrincipal: blobs.principalToString(sessionKeyPair.principal),
      state: 'AAAAAAAAAAAAAAAAAAAAAA',
      requestTs: Date.now(),
      proof: 'cA',
      vaultOrigin: 'https://example.com',
    }

    actions.cancelDelegation()

    expect(window.location.href).toContain('https://example.com/callback')
    expect(window.location.href).toContain('error=access_denied')
    expect(state.delegationRequest).toBeNull()
    expect(state.delegationConsented).toBe(false)
  })
})

describe('vault connection handoff flow', () => {
  const originalFetch = globalThis.fetch
  const originalLocation = window.location

  beforeEach(() => {
    // @ts-expect-error
    delete window.location
    // @ts-expect-error
    window.location = {
      href: 'https://example.com/vault/connect',
      origin: 'https://example.com',
      pathname: '/vault/connect',
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    window.location = originalLocation as any
  })

  test('parses fragment, exchanges handoff token, and registers secret credential', async () => {
    const registerRequests: Array<{authKey: string; wrappedDEK: string}> = []
    let handoffRequestURL = ''
    let handoffRequestInit: RequestInit | undefined

    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      handoffRequestURL = String(input)
      handoffRequestInit = init
      return new Response(JSON.stringify({success: true}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const {state, actions, navigator} = createStore(
      createMockClient({
        addSecretCredential: async (req) => {
          registerRequests.push(req)
          return {success: true, credentialId: 'secret-credential'}
        },
      }),
      createMockBlockstore(),
    )
    const navigate = mock()
    navigator.setNavigate(navigate)
    const dek = new Uint8Array(64)
    dek.fill(9)
    state.decryptedDEK = dek
    state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://example.com',
      userId: 'user-123',
    }

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault/connect#token=token-123&callback=http%3A%2F%2F127.0.0.1%3A7777%2Fvault-handoff',
    )

    await actions.completeVaultConnection()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(handoffRequestURL).toBe('http://127.0.0.1:7777/vault-handoff')
    expect(handoffRequestInit).toMatchObject({
      method: 'POST',
    })
    const handoffRequest = JSON.parse((handoffRequestInit?.body as string) || '{}')
    expect(handoffRequest).toMatchObject({
      handoffToken: 'token-123',
      vaultUrl: 'https://example.com/vault',
      userId: 'user-123',
      credentialId: 'secret-credential',
    })

    expect(registerRequests.length).toBe(1)
    expect(registerRequests[0]?.authKey).toBe(
      base64.encode(await localCrypto.deriveSecretCredentialAuthKey(base64.decode(handoffRequest.secret))),
    )
    expect(typeof handoffRequest.secret).toBe('string')
    const decrypted = await localCrypto.decrypt(
      base64.decode(registerRequests[0]!.wrappedDEK),
      base64.decode(handoffRequest.secret),
    )
    expect(Array.from(decrypted)).toEqual(Array.from(dek))
    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.vaultConnectionSuccessMessage).toBe(
      'Your Seed desktop app has been linked with this remote vault successfully.',
    )
    expect(state.error).toBe('')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  test('accepts localhost handoff URL with any port', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      return new Response(JSON.stringify({success: true}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const {state, actions, navigator} = createStore(
      createMockClient({
        addSecretCredential: async () => ({success: true, credentialId: 'secret-credential'}),
      }),
      createMockBlockstore(),
    )
    const navigate = mock()
    navigator.setNavigate(navigate)
    state.decryptedDEK = new Uint8Array(64)
    state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://example.com',
      userId: 'user-123',
    }

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault/connect#token=token-abc&callback=http%3A%2F%2Flocalhost%3A43125%2Fvault-handoff',
    )

    await actions.completeVaultConnection()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:43125/vault-handoff')
    expect(state.vaultConnectionSuccessMessage).toBe(
      'Your Seed desktop app has been linked with this remote vault successfully.',
    )
    expect(state.error).toBe('')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  test('surfaces fragment validation errors', () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())

    actions.parseVaultConnectionFromUrl('https://example.com/vault#token=token-only')

    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.error).toContain('Invalid vault connection fragment')
  })

  test('rejects non-loopback callback URLs', () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault#token=token-only&callback=http%3A%2F%2Fexample.com%2Fvault-handoff',
    )

    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.error).toContain('Invalid callback URL: host must be localhost or 127.0.0.1')
  })

  test('rejects callback URLs with the wrong path', () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault#token=token-only&callback=http%3A%2F%2F127.0.0.1%3A7777%2Fproxy%2Fvault-handoff',
    )

    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.error).toContain('Invalid callback URL: path must be /vault-handoff')
  })

  test('rejects callback URLs with the wrong protocol', () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault#token=token-only&callback=https%3A%2F%2F127.0.0.1%3A7777%2Fvault-handoff',
    )

    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.error).toContain('Invalid callback URL: protocol must be http')
  })

  test('surfaces daemon vault URL mismatch errors', async () => {
    const fetchMock = mock(async () => {
      return new Response('vault URL mismatch: expected https://example.com/vault, got https://example.net/vault', {
        status: 400,
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const addSecretCredential = mock(async () => ({success: true, credentialId: 'secret-credential'}))
    const {state, actions} = createStore(
      createMockClient({
        addSecretCredential,
      }),
      createMockBlockstore(),
    )
    state.decryptedDEK = new Uint8Array(64)
    state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://example.com',
      userId: 'user-123',
    }
    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault/connect#token=token-456&callback=http%3A%2F%2F127.0.0.1%3A7777%2Fvault-handoff',
    )

    await actions.completeVaultConnection()

    expect(addSecretCredential).toHaveBeenCalledTimes(1)
    expect(state.vaultConnectionRequest).toEqual({
      handoffToken: 'token-456',
      callbackURL: 'http://127.0.0.1:7777/vault-handoff',
    })
    expect(state.error).toContain('vault URL mismatch')
  })

  test('surfaces daemon vault URL mismatch errors for same-origin path mismatches', async () => {
    // @ts-expect-error
    window.location = {
      href: 'https://example.com/vault-b/connect',
      origin: 'https://example.com',
      pathname: '/vault-b/connect',
    }

    const fetchMock = mock(async () => {
      return new Response('vault URL mismatch: expected https://example.com/vault-a, got https://example.com/vault-b', {
        status: 400,
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const addSecretCredential = mock(async () => ({success: true, credentialId: 'secret-credential'}))
    const {state, actions} = createStore(
      createMockClient({
        addSecretCredential,
      }),
      createMockBlockstore(),
    )
    state.decryptedDEK = new Uint8Array(64)
    state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://example.com',
      userId: 'user-123',
    }
    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault-b/connect#token=token-789&callback=http%3A%2F%2F127.0.0.1%3A7777%2Fvault-handoff',
    )

    await actions.completeVaultConnection()

    expect(addSecretCredential).toHaveBeenCalledTimes(1)
    expect(state.error).toContain('vault URL mismatch')
  })

  test('cancel clears the pending desktop connection flow', () => {
    const {state, actions, navigator} = createStore(createMockClient(), createMockBlockstore())
    const navigate = mock()
    navigator.setNavigate(navigate)

    actions.parseVaultConnectionFromUrl(
      'https://example.com/vault/connect#token=token-789&callback=http%3A%2F%2F127.0.0.1%3A7777%2Fvault-handoff',
    )
    actions.cancelVaultConnection()

    expect(state.vaultConnectionRequest).toBeNull()
    expect(state.error).toBe('')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  test('clears the desktop connection success message when dismissed', () => {
    const {state, actions} = createStore(createMockClient(), createMockBlockstore())
    state.vaultConnectionSuccessMessage = 'linked'

    actions.clearVaultConnectionSuccessMessage()

    expect(state.vaultConnectionSuccessMessage).toBe('')
  })
})
