import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import {Account, Profile} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import * as keyfile from '@shm/shared/keyfile'
import * as simplewebauthn from '@simplewebauthn/browser'
import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {code as rawCodec} from 'multiformats/codecs/raw'
import {CID} from 'multiformats/cid'
import * as joinedSite from '../../../frontend/packages/shared/src/publish-default-joined-site'
import {APIError} from './api-client'
import {createStore} from './store'
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

describe('Store', () => {
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
        preLogin: async () => ({exists: true, hasPassword: true}),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      state.email = 'existing@user.com'

      await actions.handlePreLogin()

      expect(navigate).toHaveBeenCalledWith('/login')
      expect(state.userHasPassword).toBe(true)
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

    test('does not redirect if authenticated but keys missing', async () => {
      const client = createMockClient({
        getSession: async () => ({
          authenticated: true,
          relyingPartyOrigin: 'https://vault.example.com',
          email: 'test@test.com',
        }),
      })
      const {state, actions, navigator} = createStore(client, createMockBlockstore())
      const navigate = mock()
      navigator.setNavigate(navigate)

      await actions.checkSession()

      expect(navigate).not.toHaveBeenCalled()
      expect(state.session?.authenticated).toBe(true)
      expect(state.sessionChecked).toBe(true)
    })

    test('does not redirect if authenticated with keys', async () => {
      const client = createMockClient({
        getSession: async () => ({
          authenticated: true,
          relyingPartyOrigin: 'https://vault.example.com',
          email: 'test@test.com',
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
        relyingPartyOrigin: 'https://vault.example.com',
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
            relyingPartyOrigin: 'https://vault.example.com',
            email: 'test@passkey.com',
          }),
        }),
        createMockBlockstore(),
      )
      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://vault.example.com',
      }

      mockStartRegistration.mockRejectedValueOnce(new Error('The operation was canceled'))

      await actions.handleSetPasskey()

      expect(state.error).toContain('try again')
      expect(state.session).not.toBeNull()

      consoleErrorSpy.mockRestore()
      mockStartRegistration.mockReset()
    })

    test('completes registration with PRF from auth fallback', async () => {
      const {state, actions} = createStore(
        createSuccessMockClient({
          getSession: async () => ({
            authenticated: true,
            relyingPartyOrigin: 'https://vault.example.com',
            email: 'test@passkey.com',
          }),
        }),
        createMockBlockstore(),
      )
      state.email = 'test@passkey.com'
      state.session = {
        authenticated: true,
        relyingPartyOrigin: 'https://vault.example.com',
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
        saveVaultData: async (req) => {
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

    test('rolls back local state without publishing when vault save fails', async () => {
      const publishDefaultJoinedSiteSpy = spyOn(joinedSite, 'publishDefaultJoinedSite').mockResolvedValue(true)
      const client = createMockClient({
        saveVaultData: async () => ({success: true}),
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
        saveVaultData: async () => {
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
        saveVaultData: async () => {
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
          saveVaultData: async () => ({success: true}),
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
  })

  describe('importAccount', () => {
    test('imports a plaintext key file into the vault', async () => {
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        saveVaultData: async (req) => {
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
      state.selectedAccountIndex = -1

      const payload = await keyfile.create({
        publicKey: blobs.principalToString(kp.principal),
        key: kp.seed,
        createTime: '2026-03-17T00:00:00.000Z',
      })

      const principal = await actions.importAccount(keyfile.stringify(payload))

      expect(principal).toBe(blobs.principalToString(kp.principal))
      expect(state.vaultData!.accounts).toHaveLength(1)
      expect(state.vaultData!.accounts[0]!.seed).toEqual(kp.seed)
      expect(state.selectedAccountIndex).toBe(0)
      expect(state.error).toBe('')
      expect(saveVaultDataCalls).toHaveLength(1)
    })

    test('imports an encrypted key file into the vault', async () => {
      const {state, actions} = createStore(
        createMockClient({
          saveVaultData: async () => ({success: true}),
        }),
        createMockBlockstore(),
      )
      const kp = blobs.generateNobleKeyPair()

      state.decryptedDEK = new Uint8Array(32)
      state.vaultData = {
        version: 2,
        accounts: [],
      }

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
          saveVaultData: async () => ({success: true}),
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
        saveVaultData: async (req) => {
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
  })

  describe('reorderAccount', () => {
    test('moves account correctly, shifts selection and delegations', async () => {
      const saveVaultDataCalls: unknown[] = []
      const client = createMockClient({
        saveVaultData: async (req) => {
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
    vaultOrigin = 'https://vault.example.com',
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
    store.state.relyingPartyOrigin = 'https://vault.example.com'
  }

  beforeEach(() => {
    // @ts-expect-error
    delete window.location
    // @ts-expect-error
    window.location = {
      href: '',
      pathname: '/',
      origin: 'https://vault.example.com',
    }
  })

  afterEach(() => {
    window.location = originalLocation as any
  })

  test('completes delegation with signed protocol request and redirects with state', async () => {
    const saveVaultDataCalls: unknown[] = []
    const client = createMockClient({
      saveVaultData: async (req) => {
        saveVaultDataCalls.push(req)
        return {success: true}
      },
    })
    const bs = createMockBlockstore()
    const store = createStore(client, bs)
    const request = await makeSignedDelegationUrl()
    await setupDelegationState(store, request.url, bs)

    await store.actions.completeDelegation()

    expect(saveVaultDataCalls.length).toBe(1)
    expect(window.location.href).toContain('https://example.com/callback')
    expect(window.location.href).toContain('data=')
    expect(window.location.href).toContain(`state=${request.state}`)
    expect(store.state.vaultData!.accounts[0]!.delegations.length).toBe(1)
    expect(store.state.vaultData!.accounts[0]!.delegations[0]!.deviceType).toBeDefined()
    expect(store.state.delegationRequest).toBeNull()
    expect(store.state.delegationConsented).toBe(false)
    expect(store.state.error).toBe('')
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
        'https://vault.example.com/delegate?client_id=https%3A%2F%2Fexample.com&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&session_key=missing&state=AAAAAAAAAAAAAAAAAAAAAA&ts=1700000000000&proof=cA',
      clientId: 'https://example.com',
      redirectUri: 'https://example.com/callback',
      sessionKeyPrincipal: blobs.principalToString(sessionKeyPair.principal),
      state: 'AAAAAAAAAAAAAAAAAAAAAA',
      requestTs: Date.now(),
      proof: 'cA',
      vaultOrigin: 'https://vault.example.com',
    }

    actions.cancelDelegation()

    expect(window.location.href).toContain('https://example.com/callback')
    expect(window.location.href).toContain('error=access_denied')
    expect(state.delegationRequest).toBeNull()
    expect(state.delegationConsented).toBe(false)
  })
})
